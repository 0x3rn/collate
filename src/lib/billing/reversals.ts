import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import {
  auditLog,
  creditLedger,
  type PaymentProvider,
  paymentReversals,
  payments,
  type ReversalKind,
  users,
} from "@/db/schema";
import { type AdminNotifier, escapeTelegramHtml } from "@/lib/notify/admin-alerts";
import { logEvent } from "@/lib/observability/logger";

/**
 * Refunds and disputes (chargebacks). When money goes back to a customer, the matching share of
 * the credits that payment bought is taken back, never below a zero balance. Credits already
 * spent are recorded as a shortfall, and the account is put on hold (no buying or spending)
 * while a dispute is open or after a refund of credits that were already used.
 */

export const HOLD_REASONS = {
  dispute: "A payment dispute is open on this account.",
  refundAfterUse: "A payment was refunded after its credits were used.",
} as const;

export { BILLING_HOLD_MESSAGE } from "./ledger";

export interface ReversalEvent {
  provider: PaymentProvider;
  kind: ReversalKind;
  /** The refund id or dispute id at the provider. */
  providerReversalId: string;
  /** How to find the original payment. */
  payment: { providerReference?: string | null; providerOrderId?: string | null };
  /** Amount going back to the customer, in minor units (cents or kobo), tax included. */
  amountMinor: number;
  currency: string;
  status: string;
  reason?: string | null;
  dueAt?: Date | null;
}

export type ReversalOutcome =
  | { outcome: "payment_not_found" }
  | { outcome: "updated"; reversalId: string }
  | {
      outcome: "applied";
      reversalId: string;
      userId: string;
      creditsTarget: number;
      creditsRemoved: number;
      creditsShort: number;
      holdPlaced: boolean;
    };

async function findPayment(db: AppDb, ev: ReversalEvent) {
  const conditions = [];
  if (ev.payment.providerReference) {
    conditions.push(eq(payments.providerReference, ev.payment.providerReference));
  }
  if (ev.payment.providerOrderId) {
    conditions.push(eq(payments.providerOrderId, ev.payment.providerOrderId));
    // Older Polar rows: the order id only lives in the saved payment event.
    conditions.push(
      sql`(json_valid(${payments.rawEventJson}) AND json_extract(${payments.rawEventJson}, '$.data.id') = ${ev.payment.providerOrderId})`
    );
  }
  if (conditions.length === 0) return null;
  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.provider, ev.provider), or(...conditions)))
    .limit(1);
  return row ?? null;
}

/** Takes up to `credits` from a user, never below zero. Returns how many were taken. */
async function takeCredits(
  db: AppDb,
  params: { userId: string; credits: number; note: string; idempotencyKey: string; now: Date }
): Promise<number> {
  if (params.credits <= 0) return 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const [u] = await db
      .select({ balance: users.creditsBalance })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);
    if (!u) return 0;
    const take = Math.min(params.credits, u.balance);
    if (take === 0) return 0;
    const updated = await db
      .update(users)
      .set({ creditsBalance: u.balance - take, updatedAt: params.now })
      .where(and(eq(users.id, params.userId), eq(users.creditsBalance, u.balance)))
      .returning({ balance: users.creditsBalance });
    if (updated.length === 0) continue;
    await db.insert(creditLedger).values({
      id: `led_${crypto.randomUUID()}`,
      userId: params.userId,
      idempotencyKey: params.idempotencyKey,
      entryType: "manual_adjustment",
      creditsDelta: -take,
      balanceAfter: updated[0]!.balance,
      note: params.note,
      createdAt: params.now,
    });
    return take;
  }
  throw new Error("Credit balance kept changing while taking credits back.");
}

async function placeHold(db: AppDb, userId: string, reason: string, now: Date): Promise<void> {
  await db
    .update(users)
    .set({ billingHoldReason: reason, billingHoldAt: now, updatedAt: now })
    .where(eq(users.id, userId));
}

/** True while the account may not buy or spend credits. */
export async function getBillingHold(
  db: AppDb,
  userId: string
): Promise<{ reason: string; since: Date } | null> {
  const [u] = await db
    .select({ reason: users.billingHoldReason, at: users.billingHoldAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u?.reason ? { reason: u.reason, since: u.at ?? new Date(0) } : null;
}

function money(currency: string, minor: number): string {
  return `${currency.toUpperCase()} ${(minor / 100).toFixed(2)}`;
}

/**
 * Records a refund or dispute and takes back the matching credits. Safe to call again for the
 * same event (retries, status updates): credits are only taken the first time.
 */
export async function applyPaymentReversal(
  db: AppDb,
  ev: ReversalEvent,
  deps: { now?: Date; notifier?: AdminNotifier | null } = {}
): Promise<ReversalOutcome> {
  const now = deps.now ?? new Date();
  const payment = await findPayment(db, ev);
  if (!payment) {
    logEvent("warn", "billing.reversal_payment_not_found", {
      data: { provider: ev.provider, kind: ev.kind, id: ev.providerReversalId },
    });
    return { outcome: "payment_not_found" };
  }

  const [existing] = await db
    .select()
    .from(paymentReversals)
    .where(
      and(
        eq(paymentReversals.provider, ev.provider),
        eq(paymentReversals.kind, ev.kind),
        eq(paymentReversals.providerReversalId, ev.providerReversalId)
      )
    )
    .limit(1);
  if (existing) {
    if (existing.status !== ev.status || (ev.dueAt && !existing.dueAt)) {
      await db
        .update(paymentReversals)
        .set({ status: ev.status, dueAt: ev.dueAt ?? existing.dueAt, updatedAt: now })
        .where(eq(paymentReversals.id, existing.id));
    }
    return { outcome: "updated", reversalId: existing.id };
  }

  // This reversal's share of the credits, minus what earlier reversals of the same payment
  // already accounted for (a refund issued to stop a dispute must not be counted twice).
  const share = Math.ceil(
    (payment.creditsGranted * Math.min(ev.amountMinor, payment.amountMinor)) /
      Math.max(payment.amountMinor, 1)
  );
  const [prior] = await db
    .select({ total: sql<number>`coalesce(sum(${paymentReversals.creditsTarget}), 0)` })
    .from(paymentReversals)
    .where(eq(paymentReversals.paymentId, payment.id));
  const creditsTarget = Math.max(
    0,
    Math.min(share, payment.creditsGranted - Number(prior?.total ?? 0))
  );

  const reversalId = `rev_${crypto.randomUUID()}`;
  // Claim the event first (unique index), so two deliveries at once cannot both take credits.
  const claimed = await db
    .insert(paymentReversals)
    .values({
      id: reversalId,
      paymentId: payment.id,
      userId: payment.userId,
      provider: ev.provider,
      kind: ev.kind,
      providerReversalId: ev.providerReversalId,
      status: ev.status,
      reason: ev.reason ?? null,
      amountMinor: ev.amountMinor,
      currency: ev.currency.toUpperCase(),
      creditsTarget,
      dueAt: ev.dueAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: paymentReversals.id });
  if (claimed.length === 0) return { outcome: "updated", reversalId };

  const label = ev.kind === "dispute" ? "Payment dispute" : "Payment refund";
  const creditsRemoved = await takeCredits(db, {
    userId: payment.userId,
    credits: creditsTarget,
    note: `${label} (reference ${payment.providerReference})`,
    idempotencyKey: `reversal:${reversalId}`,
    now,
  });
  const creditsShort = creditsTarget - creditsRemoved;

  const holdReason =
    ev.kind === "dispute"
      ? HOLD_REASONS.dispute
      : creditsShort > 0
        ? HOLD_REASONS.refundAfterUse
        : null;
  if (holdReason) await placeHold(db, payment.userId, holdReason, now);

  await db
    .update(paymentReversals)
    .set({ creditsRemoved, creditsShort, updatedAt: now })
    .where(eq(paymentReversals.id, reversalId));

  const [{ reversed } = { reversed: 0 }] = await db
    .select({ reversed: sql<number>`coalesce(sum(${paymentReversals.creditsTarget}), 0)` })
    .from(paymentReversals)
    .where(eq(paymentReversals.paymentId, payment.id));
  if (Number(reversed) >= payment.creditsGranted) {
    await db
      .update(payments)
      .set({ status: "refunded", updatedAt: now })
      .where(eq(payments.id, payment.id));
  }

  await db.insert(auditLog).values({
    id: `aud_${crypto.randomUUID()}`,
    actorUserId: null,
    action: ev.kind === "dispute" ? "billing.dispute_opened" : "billing.refunded",
    entityType: "payment",
    entityId: payment.id,
    metadataJson: JSON.stringify({
      provider: ev.provider,
      providerReversalId: ev.providerReversalId,
      amountMinor: ev.amountMinor,
      currency: ev.currency,
      status: ev.status,
      reason: ev.reason ?? null,
      creditsTarget,
      creditsRemoved,
      creditsShort,
      holdPlaced: Boolean(holdReason),
    }),
    createdAt: now,
  });

  if (deps.notifier) {
    const [u] = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, payment.userId))
      .limit(1);
    await deps.notifier.send(
      [
        ev.kind === "dispute" ? "⚠️ <b>Payment dispute opened</b>" : "↩️ <b>Payment refunded</b>",
        `Customer: ${escapeTelegramHtml(u ? `${u.name} <${u.email}>` : payment.userId)}`,
        `Amount: ${escapeTelegramHtml(money(ev.currency, ev.amountMinor))} via ${ev.provider}`,
        `Credits taken back: ${creditsRemoved}${creditsShort ? ` (${creditsShort} already used)` : ""}`,
        holdReason ? "Account put on hold." : "",
        ev.dueAt ? `Respond by: ${escapeTelegramHtml(ev.dueAt.toUTCString())}` : "",
        ev.kind === "dispute" ? "Open Admin → Recent payments → Record." : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return {
    outcome: "applied",
    reversalId,
    userId: payment.userId,
    creditsTarget,
    creditsRemoved,
    creditsShort,
    holdPlaced: Boolean(holdReason),
  };
}

/**
 * A dispute has a final result. If we won, the credits taken back are returned and the hold is
 * lifted (unless something else keeps it). If we lost, the credits stay removed and the hold
 * stays until an admin lifts it.
 */
export async function resolveDispute(
  db: AppDb,
  params: {
    provider: PaymentProvider;
    providerDisputeId: string;
    result: "won" | "lost";
    status: string;
  },
  deps: { now?: Date; notifier?: AdminNotifier | null } = {}
): Promise<{ outcome: "not_found" | "already_resolved" | "resolved"; creditsReturned: number }> {
  const now = deps.now ?? new Date();
  const [rev] = await db
    .select()
    .from(paymentReversals)
    .where(
      and(
        eq(paymentReversals.provider, params.provider),
        eq(paymentReversals.kind, "dispute"),
        eq(paymentReversals.providerReversalId, params.providerDisputeId)
      )
    )
    .limit(1);
  if (!rev) return { outcome: "not_found", creditsReturned: 0 };
  if (rev.resolvedAt) return { outcome: "already_resolved", creditsReturned: 0 };

  const marked = await db
    .update(paymentReversals)
    .set({ status: params.status, resolvedAt: now, updatedAt: now })
    .where(and(eq(paymentReversals.id, rev.id), isNull(paymentReversals.resolvedAt)))
    .returning({ id: paymentReversals.id });
  if (marked.length === 0) return { outcome: "already_resolved", creditsReturned: 0 };

  let creditsReturned = 0;
  if (params.result === "won") {
    if (rev.creditsRemoved > 0) {
      const updated = await db
        .update(users)
        .set({
          creditsBalance: sql`${users.creditsBalance} + ${rev.creditsRemoved}`,
          updatedAt: now,
        })
        .where(eq(users.id, rev.userId))
        .returning({ balance: users.creditsBalance });
      if (updated[0]) {
        creditsReturned = rev.creditsRemoved;
        await db.insert(creditLedger).values({
          id: `led_${crypto.randomUUID()}`,
          userId: rev.userId,
          idempotencyKey: `reversal_won:${rev.id}`,
          entryType: "manual_adjustment",
          creditsDelta: rev.creditsRemoved,
          balanceAfter: updated[0].balance,
          note: "Payment dispute closed in our favour; credits returned",
          createdAt: now,
        });
      }
    }
    // The payment stands again, so its credits no longer count as reversed.
    await db
      .update(paymentReversals)
      .set({ creditsTarget: 0, updatedAt: now })
      .where(eq(paymentReversals.id, rev.id));
    await db
      .update(payments)
      .set({ status: "succeeded", updatedAt: now })
      .where(and(eq(payments.id, rev.paymentId), eq(payments.status, "refunded")));

    const openDisputes = await db
      .select({ id: paymentReversals.id })
      .from(paymentReversals)
      .where(
        and(
          eq(paymentReversals.userId, rev.userId),
          eq(paymentReversals.kind, "dispute"),
          isNull(paymentReversals.resolvedAt)
        )
      )
      .limit(1);
    if (openDisputes.length === 0) {
      await db
        .update(users)
        .set({ billingHoldReason: null, billingHoldAt: null, updatedAt: now })
        .where(and(eq(users.id, rev.userId), eq(users.billingHoldReason, HOLD_REASONS.dispute)));
    }
  }

  await db.insert(auditLog).values({
    id: `aud_${crypto.randomUUID()}`,
    actorUserId: null,
    action: params.result === "won" ? "billing.dispute_won" : "billing.dispute_lost",
    entityType: "payment",
    entityId: rev.paymentId,
    metadataJson: JSON.stringify({
      provider: params.provider,
      providerDisputeId: params.providerDisputeId,
      status: params.status,
      creditsReturned,
    }),
    createdAt: now,
  });
  await deps.notifier?.send(
    params.result === "won"
      ? `✅ <b>Dispute won</b> (${params.provider}). ${creditsReturned} credits returned to the customer.`
      : `❌ <b>Dispute lost</b> (${params.provider}). Credits stay removed; the account stays on hold until you lift it.`
  );
  return { outcome: "resolved", creditsReturned };
}

/** Admin: lift an account hold. */
export async function liftBillingHold(
  db: AppDb,
  params: { adminUserId: string; userId: string; note: string; now?: Date }
): Promise<boolean> {
  const now = params.now ?? new Date();
  const updated = await db
    .update(users)
    .set({ billingHoldReason: null, billingHoldAt: null, updatedAt: now })
    .where(eq(users.id, params.userId))
    .returning({ id: users.id });
  if (updated.length === 0) return false;
  await db.insert(auditLog).values({
    id: `aud_${crypto.randomUUID()}`,
    actorUserId: params.adminUserId,
    action: "admin.billing_hold_lifted",
    entityType: "user",
    entityId: params.userId,
    metadataJson: JSON.stringify({ note: params.note }),
    createdAt: now,
  });
  return true;
}

/** Reversals for a set of payments, for admin views. */
export async function listReversalsForPayments(db: AppDb, paymentIds: string[]) {
  if (paymentIds.length === 0) return [];
  return db.select().from(paymentReversals).where(inArray(paymentReversals.paymentId, paymentIds));
}
