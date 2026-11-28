import { and, asc, desc, eq, gt, gte, inArray, isNull, like, ne, sql } from "drizzle-orm";
import { BILLING_POLICY } from "@/config/pricing";
import type { AppDb } from "@/db/client";
import {
  auditLog,
  chapterVersions,
  creditLedger,
  creditReservations,
  jobsLog,
  payments,
  projects,
  researchRuns,
  sectionDrafts,
  systemControls,
  users,
} from "@/db/schema";
import type { NormalizedPaymentWebhook } from "./webhooks";

export const BILLING_HOLD_MESSAGE =
  "Your account is on hold because of a payment refund or dispute. Email support@collateresearch.app and we will sort it out.";

export type BillingErrorCode =
  | "INSUFFICIENT_CREDITS"
  | "USER_NOT_FOUND"
  | "RESERVATION_NOT_FOUND"
  | "CIRCUIT_BREAKER_OPEN"
  | "PAYMENT_MISMATCH"
  | "INVALID_AMOUNT"
  | "NOTHING_TO_DEDUCT"
  | "BALANCE_CHANGED"
  | "ACCOUNT_ON_HOLD";

export class BillingError extends Error {
  public readonly code: BillingErrorCode;
  public readonly status: number;
  public readonly availableCredits?: number;

  constructor(code: BillingErrorCode, message: string, status: number, availableCredits?: number) {
    super(message);
    this.name = "BillingError";
    this.code = code;
    this.status = status;
    this.availableCredits = availableCredits;
  }
}

/**
 * Grants credits for a verified Paystack, Polar, or Stripe payment EXACTLY ONCE.
 * Enforces server-side amount/currency/ownership parity against pending checkouts and
 * uses atomic claim updates (WHERE status='pending' / ON CONFLICT DO NOTHING) + SQL
 * balance increments so concurrent webhook deliveries can never double-credit.
 */
export async function grantPaymentCreditsIdempotent(
  db: AppDb,
  payment: NormalizedPaymentWebhook,
  rawEventJson: string,
  now: Date = new Date()
): Promise<{ alreadyProcessed: boolean; paymentId: string; newBalance: number }> {
  if (!Number.isInteger(payment.creditsGranted) || payment.creditsGranted <= 0) {
    throw new BillingError("INVALID_AMOUNT", "Invalid credit grant amount.", 400);
  }
  if (!Number.isInteger(payment.amountMinor) || payment.amountMinor <= 0) {
    throw new BillingError("INVALID_AMOUNT", "Invalid payment amount.", 400);
  }

  const [existing] = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.provider, payment.provider),
        eq(payments.providerReference, payment.providerReference)
      )
    )
    .limit(1);

  const [user] = await db.select().from(users).where(eq(users.id, payment.userId)).limit(1);
  if (!user) {
    throw new BillingError("USER_NOT_FOUND", `User ${payment.userId} not found.`, 404);
  }

  if (existing && existing.status === "succeeded") {
    return {
      alreadyProcessed: true,
      paymentId: existing.id,
      newBalance: user.creditsBalance,
    };
  }

  // Server-side parity validation against our initiated pending checkout record
  if (existing) {
    if (existing.userId !== payment.userId) {
      throw new BillingError(
        "PAYMENT_MISMATCH",
        "Webhook user does not match the initiated checkout owner.",
        400
      );
    }
    if (existing.currency.toUpperCase() !== payment.currency.toUpperCase()) {
      throw new BillingError(
        "PAYMENT_MISMATCH",
        "Webhook currency does not match the initiated checkout currency.",
        400
      );
    }
    if (existing.creditsGranted !== payment.creditsGranted) {
      throw new BillingError(
        "PAYMENT_MISMATCH",
        "Webhook credit count does not match the initiated credit pack.",
        400
      );
    }
    const effectiveOrderSubtotal =
      payment.provider === "polar"
        ? (payment.subtotalAmountMinor ?? payment.amountMinor)
        : payment.amountMinor;
    if (effectiveOrderSubtotal < existing.amountMinor) {
      throw new BillingError(
        "PAYMENT_MISMATCH",
        "Webhook payment amount is less than the initiated checkout price.",
        400
      );
    }
  }

  const creditsToGrant = existing ? existing.creditsGranted : payment.creditsGranted;
  const paymentId = existing?.id ?? `pay_${crypto.randomUUID()}`;
  const idempotencyKey = `payment:${payment.provider}:${payment.providerReference}`;

  // Atomically claim the payment before mutating creditsBalance (prevents TOCTOU double-credit).
  // Also permits a verified late payment webhook to recover a checkout marked cancelled/failed.
  if (existing) {
    const claimed = await db
      .update(payments)
      .set({
        status: "succeeded",
        rawEventJson: rawEventJson.slice(0, 8000),
        ...(payment.providerOrderId ? { providerOrderId: payment.providerOrderId } : {}),
        updatedAt: now,
      })
      .where(
        and(
          eq(payments.id, paymentId),
          inArray(payments.status, ["pending", "cancelled", "failed"])
        )
      )
      .returning({ id: payments.id });

    if (claimed.length === 0) {
      const [latestUser] = await db
        .select({ creditsBalance: users.creditsBalance })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      return {
        alreadyProcessed: true,
        paymentId,
        newBalance: latestUser?.creditsBalance ?? user.creditsBalance,
      };
    }
  } else {
    const inserted = await db
      .insert(payments)
      .values({
        id: paymentId,
        userId: payment.userId,
        provider: payment.provider,
        providerReference: payment.providerReference,
        providerOrderId: payment.providerOrderId ?? null,
        currency: payment.currency,
        amountMinor: payment.amountMinor,
        creditsGranted: creditsToGrant,
        status: "succeeded",
        rawEventJson: rawEventJson.slice(0, 8000),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: payments.id });

    if (inserted.length === 0) {
      const [latestUser] = await db
        .select({ creditsBalance: users.creditsBalance })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      return {
        alreadyProcessed: true,
        paymentId,
        newBalance: latestUser?.creditsBalance ?? user.creditsBalance,
      };
    }
  }

  // Secondary ledger uniqueness guard (in case an identical idempotency key already settled)
  const [existingLedger] = await db
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(eq(creditLedger.idempotencyKey, idempotencyKey))
    .limit(1);

  if (existingLedger) {
    const [latestUser] = await db
      .select({ creditsBalance: users.creditsBalance })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    return {
      alreadyProcessed: true,
      paymentId,
      newBalance: latestUser?.creditsBalance ?? user.creditsBalance,
    };
  }

  // Atomic SQL increment preserves concurrent debits/credits without stale overwrite
  const updatedRows = await db
    .update(users)
    .set({
      creditsBalance: sql`${users.creditsBalance} + ${creditsToGrant}`,
      updatedAt: now,
    })
    .where(eq(users.id, user.id))
    .returning({ creditsBalance: users.creditsBalance });

  const newBalance = updatedRows[0]?.creditsBalance ?? user.creditsBalance + creditsToGrant;

  await db
    .insert(creditLedger)
    .values({
      id: `led_${crypto.randomUUID()}`,
      userId: user.id,
      paymentId,
      idempotencyKey,
      entryType: "purchase",
      creditsDelta: creditsToGrant,
      balanceAfter: newBalance,
      note: `Credit pack purchase (${creditsToGrant} credits)`,
      createdAt: now,
    })
    .onConflictDoNothing();

  await db.insert(auditLog).values({
    id: `aud_${crypto.randomUUID()}`,
    actorUserId: user.id,
    action: "billing.credits_purchased",
    entityType: "payment",
    entityId: paymentId,
    metadataJson: JSON.stringify({
      provider: payment.provider,
      creditsGranted: creditsToGrant,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
    }),
    createdAt: now,
  });

  return { alreadyProcessed: false, paymentId, newBalance };
}

/**
 * Transitions a pending checkout row to "cancelled" or "failed" on a verified webhook
 * (e.g. Polar checkout.updated=expired/failed, Paystack charge.failed, Stripe session expired).
 * Never overwrites a payment that has already settled ("succeeded" or "refunded").
 */
export async function markPendingPaymentTerminal(
  db: AppDb,
  params: {
    provider: "paystack" | "polar" | "stripe";
    providerReference: string;
    status: "cancelled" | "failed";
    rawEventJson: string;
    now?: Date;
  }
): Promise<{ updated: boolean; paymentId: string | null }> {
  const now = params.now ?? new Date();
  const updated = await db
    .update(payments)
    .set({
      status: params.status,
      rawEventJson: params.rawEventJson.slice(0, 8000),
      updatedAt: now,
    })
    .where(
      and(
        eq(payments.provider, params.provider),
        eq(payments.providerReference, params.providerReference),
        eq(payments.status, "pending")
      )
    )
    .returning({ id: payments.id });

  return {
    updated: updated.length > 0,
    paymentId: updated[0]?.id ?? null,
  };
}

/**
 * Marks a signed-in user's own pending checkout as "cancelled" when they return from the
 * payment provider via the cancel URL (?payment=cancelled). Scoped strictly to `userId`
 * and `status = 'pending'`.
 */
export async function cancelPendingUserCheckout(
  db: AppDb,
  params: {
    userId: string;
    providerReference?: string | null;
    now?: Date;
  }
): Promise<{ updated: boolean; paymentId: string | null }> {
  const now = params.now ?? new Date();
  const ref = params.providerReference?.trim();

  if (ref) {
    const updated = await db
      .update(payments)
      .set({ status: "cancelled", updatedAt: now })
      .where(
        and(
          eq(payments.userId, params.userId),
          eq(payments.providerReference, ref),
          eq(payments.status, "pending")
        )
      )
      .returning({ id: payments.id });
    if (updated.length > 0) {
      return { updated: true, paymentId: updated[0]!.id };
    }
  }

  // Fallback when provider return_url has no reference and browser storage was cleared:
  // cancel the user's most recent pending checkout created within the last 2 hours.
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const [recentPending] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.userId, params.userId),
        eq(payments.status, "pending"),
        gte(payments.createdAt, twoHoursAgo)
      )
    )
    .orderBy(desc(payments.createdAt))
    .limit(1);

  if (!recentPending) {
    return { updated: false, paymentId: null };
  }

  const updated = await db
    .update(payments)
    .set({ status: "cancelled", updatedAt: now })
    .where(and(eq(payments.id, recentPending.id), eq(payments.status, "pending")))
    .returning({ id: payments.id });

  return {
    updated: updated.length > 0,
    paymentId: updated[0]?.id ?? null,
  };
}

/**
 * Reserves credits before starting a chapter run (idempotent on idempotencyKey).
 */
export async function reserveChapterCredits(
  db: AppDb,
  params: {
    userId: string;
    projectId: string;
    chapterId?: string | null;
    credits: number;
    idempotencyKey: string;
    note?: string;
    now?: Date;
  }
): Promise<{ reservationId: string; alreadyReserved: boolean; balanceAfter: number }> {
  if (!Number.isInteger(params.credits) || params.credits <= 0) {
    throw new BillingError("INVALID_AMOUNT", "Credit reservation must be a positive integer.", 400);
  }
  const now = params.now ?? new Date();
  const [user] = await db.select().from(users).where(eq(users.id, params.userId)).limit(1);
  if (!user) {
    throw new BillingError("USER_NOT_FOUND", "Account not found.", 404);
  }

  const [existing] = await db
    .select()
    .from(creditReservations)
    .where(eq(creditReservations.idempotencyKey, params.idempotencyKey))
    .limit(1);

  if (existing) {
    return {
      reservationId: existing.id,
      alreadyReserved: true,
      balanceAfter: user.creditsBalance,
    };
  }

  if (user.billingHoldReason) {
    throw new BillingError("ACCOUNT_ON_HOLD", BILLING_HOLD_MESSAGE, 403);
  }

  const updatedRows = await db
    .update(users)
    .set({
      creditsBalance: sql`${users.creditsBalance} - ${params.credits}`,
      updatedAt: now,
    })
    .where(
      and(
        eq(users.id, user.id),
        gte(users.creditsBalance, params.credits),
        // A hold placed a moment ago (dispute webhook) still blocks this spend.
        isNull(users.billingHoldReason)
      )
    )
    .returning({ creditsBalance: users.creditsBalance });

  const updatedUser = updatedRows[0];
  if (!updatedUser) {
    const [latest] = await db
      .select({ hold: users.billingHoldReason })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    if (latest?.hold) throw new BillingError("ACCOUNT_ON_HOLD", BILLING_HOLD_MESSAGE, 403);
    throw new BillingError(
      "INSUFFICIENT_CREDITS",
      `Insufficient credits: need ${params.credits}, available ${user.creditsBalance}.`,
      402,
      user.creditsBalance
    );
  }

  const newBalance = updatedUser.creditsBalance;
  const reservationId = `res_${crypto.randomUUID()}`;

  await db.insert(creditReservations).values({
    id: reservationId,
    userId: user.id,
    projectId: params.projectId,
    chapterId: params.chapterId ?? null,
    idempotencyKey: params.idempotencyKey,
    creditsReserved: params.credits,
    status: "held",
    createdAt: now,
  });

  await db.insert(creditLedger).values({
    id: `led_${crypto.randomUUID()}`,
    userId: user.id,
    projectId: params.projectId,
    chapterId: params.chapterId ?? null,
    idempotencyKey: `reserve:${params.idempotencyKey}`,
    entryType: "reserve",
    creditsDelta: -params.credits,
    balanceAfter: newBalance,
    note: params.note ?? "Reserved credits for chapter run",
    createdAt: now,
  });

  return { reservationId, alreadyReserved: false, balanceAfter: newBalance };
}

/**
 * Captures a held reservation once the chapter reaches 'ready' (idempotent).
 * Self-heals if the reservation was prematurely refunded (e.g. during a Cloudflare
 * Durable Object code-update reset) before the workflow resumed and completed:
 * re-debits the credits exactly once using idempotencyKey `recapture:${reservationId}`.
 */
export async function captureChapterReservation(
  db: AppDb,
  reservationId: string,
  now: Date = new Date()
): Promise<{ status: "captured" | "refunded"; recaptured?: boolean }> {
  const [res] = await db
    .select()
    .from(creditReservations)
    .where(eq(creditReservations.id, reservationId))
    .limit(1);

  if (!res) {
    throw new BillingError("RESERVATION_NOT_FOUND", "Credit reservation not found.", 404);
  }
  if (res.status === "captured") {
    return { status: "captured", recaptured: false };
  }

  if (res.status === "refunded") {
    const recaptureKey = `recapture:${res.id}`;
    const [existingRecapture] = await db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.idempotencyKey, recaptureKey))
      .limit(1);

    if (existingRecapture) {
      await db
        .update(creditReservations)
        .set({ status: "captured", settledAt: now })
        .where(eq(creditReservations.id, res.id));
      return { status: "captured", recaptured: false };
    }

    const [user] = await db.select().from(users).where(eq(users.id, res.userId)).limit(1);
    if (!user) {
      throw new BillingError("USER_NOT_FOUND", "Account not found.", 404);
    }

    const debit = Math.min(user.creditsBalance, res.creditsReserved);
    const updatedRows = await db
      .update(users)
      .set({
        creditsBalance: sql`max(0, ${users.creditsBalance} - ${debit})`,
        updatedAt: now,
      })
      .where(eq(users.id, user.id))
      .returning({ creditsBalance: users.creditsBalance });

    const newBalance = updatedRows[0]?.creditsBalance ?? Math.max(0, user.creditsBalance - debit);

    await db.insert(creditLedger).values({
      id: `led_${crypto.randomUUID()}`,
      userId: user.id,
      projectId: res.projectId,
      chapterId: res.chapterId,
      idempotencyKey: recaptureKey,
      entryType: "capture",
      creditsDelta: -debit,
      balanceAfter: newBalance,
      note: "Credits for completed chapter",
      createdAt: now,
    });

    await db
      .update(creditReservations)
      .set({ status: "captured", settledAt: now })
      .where(eq(creditReservations.id, res.id));

    return { status: "captured", recaptured: true };
  }

  await db
    .update(creditReservations)
    .set({ status: "captured", settledAt: now })
    .where(eq(creditReservations.id, res.id));

  return { status: "captured", recaptured: false };
}

function extractRunIdFromReservationKey(idempotencyKey: string): {
  kind: "chapter" | "revision" | "assignment" | null;
  runId: string | null;
} {
  const colonIdx = idempotencyKey.indexOf(":");
  if (colonIdx <= 0) return { kind: null, runId: null };
  const prefix = idempotencyKey.slice(0, colonIdx);
  const runId = idempotencyKey.slice(colonIdx + 1).trim();
  if (!runId) return { kind: null, runId: null };
  if (prefix === "chapter" || prefix === "revision" || prefix === "assignment") {
    return { kind: prefix, runId };
  }
  return { kind: null, runId: null };
}

/**
 * Reconciles any credit reservations that were prematurely refunded during a transient
 * Cloudflare Workflows Durable Object reset even though the workflow subsequently resumed,
 * completed, and persisted a finished chapter version. Strictly idempotent.
 */
export async function reconcilePrematurelyRefundedReservations(
  db: AppDb,
  now: Date = new Date()
): Promise<{ reconciledCount: number; totalCreditsRecaptured: number; reservationIds: string[] }> {
  const refundedRows = await db
    .select()
    .from(creditReservations)
    .where(eq(creditReservations.status, "refunded"))
    .orderBy(asc(creditReservations.createdAt), asc(creditReservations.id));

  let reconciledCount = 0;
  let totalCreditsRecaptured = 0;
  const reservationIds: string[] = [];

  for (const res of refundedRows) {
    const { kind, runId } = extractRunIdFromReservationKey(res.idempotencyKey);
    if (!kind || !runId) continue;

    // Proof 1: The exact runId executed assembleAndFinalize -> memory_summary_ch* succeeded
    const [summaryJob] = await db
      .select({ id: jobsLog.id })
      .from(jobsLog)
      .where(
        and(
          eq(jobsLog.workflowId, runId),
          eq(jobsLog.status, "succeeded"),
          like(jobsLog.step, "memory_summary_ch%")
        )
      )
      .limit(1);

    let completedAfterRefund = Boolean(summaryJob);

    // Proof 2 (fallback for runs that skip memory summary, e.g. targeted revisions/assignments):
    // verified section_drafts exist for this exact runId, zero failed jobs exist for this runId,
    // and a matching chapter_versions row was written strictly after the premature refund.
    if (!completedAfterRefund && res.chapterId && res.settledAt) {
      const [draftRow] = await db
        .select({ id: sectionDrafts.id })
        .from(sectionDrafts)
        .where(and(eq(sectionDrafts.runId, runId), eq(sectionDrafts.status, "verified")))
        .limit(1);

      if (draftRow) {
        const [failedJob] = await db
          .select({ id: jobsLog.id })
          .from(jobsLog)
          .where(and(eq(jobsLog.workflowId, runId), eq(jobsLog.status, "failed")))
          .limit(1);

        if (!failedJob) {
          const expectedCreator = kind === "revision" ? "revision" : "ai";
          const [verRow] = await db
            .select({ id: chapterVersions.id })
            .from(chapterVersions)
            .where(
              and(
                eq(chapterVersions.chapterId, res.chapterId),
                eq(chapterVersions.createdBy, expectedCreator),
                gte(chapterVersions.createdAt, res.settledAt)
              )
            )
            .limit(1);
          completedAfterRefund = Boolean(verRow);
        }
      }
    }

    if (!completedAfterRefund) continue;

    const outcome = await captureChapterReservation(db, res.id, now);
    if (outcome.recaptured) {
      reconciledCount += 1;
      totalCreditsRecaptured += res.creditsReserved;
      reservationIds.push(res.id);
    }
  }

  return { reconciledCount, totalCreditsRecaptured, reservationIds };
}

const DO_RESET_RECONCILIATION_CONTROL_KEY = "reconciliation_do_reset_v1";
let didReconcileInIsolate = false;

export function resetReconciliationIsolateCacheForTests(): void {
  didReconcileInIsolate = false;
}

/**
 * One-time idempotent startup hook so pushing to production automatically reconciles any
 * accounts affected by the earlier Durable Object reset refund race on the first request,
 * even if the deploy pipeline does not execute SQL migrations separately.
 */
export async function ensurePrematureRefundsReconciled(
  db: AppDb,
  now: Date = new Date()
): Promise<void> {
  if (didReconcileInIsolate) return;

  const [existingControl] = await db
    .select()
    .from(systemControls)
    .where(eq(systemControls.key, DO_RESET_RECONCILIATION_CONTROL_KEY))
    .limit(1);

  if (existingControl) {
    didReconcileInIsolate = true;
    return;
  }

  const summary = await reconcilePrematurelyRefundedReservations(db, now);

  await db
    .insert(systemControls)
    .values({
      key: DO_RESET_RECONCILIATION_CONTROL_KEY,
      valueJson: JSON.stringify({
        completedAt: now.toISOString(),
        ...summary,
      }),
      updatedAt: now,
    })
    .onConflictDoNothing();

  didReconcileInIsolate = true;
}

/**
 * Refunds a held reservation in full when a chapter fails or a run is infeasible (idempotent).
 * Ensures a failed chapter NEVER consumes user credits.
 */
export async function refundChapterReservation(
  db: AppDb,
  reservationId: string,
  reason: string,
  now: Date = new Date()
): Promise<{ refunded: boolean; balanceAfter: number }> {
  const [res] = await db
    .select()
    .from(creditReservations)
    .where(eq(creditReservations.id, reservationId))
    .limit(1);

  if (!res) {
    throw new BillingError("RESERVATION_NOT_FOUND", "Credit reservation not found.", 404);
  }

  const [user] = await db.select().from(users).where(eq(users.id, res.userId)).limit(1);
  if (!user) {
    throw new BillingError("USER_NOT_FOUND", "Account not found.", 404);
  }

  if (res.status !== "held") {
    return { refunded: false, balanceAfter: user.creditsBalance };
  }

  const refundKey = `refund:${res.id}`;
  const [existingRefund] = await db
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(eq(creditLedger.idempotencyKey, refundKey))
    .limit(1);

  if (existingRefund) {
    return { refunded: false, balanceAfter: user.creditsBalance };
  }

  // Atomically claim the held -> refunded transition before incrementing user credits
  const claimed = await db
    .update(creditReservations)
    .set({ status: "refunded", settledAt: now })
    .where(and(eq(creditReservations.id, res.id), eq(creditReservations.status, "held")))
    .returning({ id: creditReservations.id });

  if (claimed.length === 0) {
    const [latestUser] = await db
      .select({ creditsBalance: users.creditsBalance })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    return { refunded: false, balanceAfter: latestUser?.creditsBalance ?? user.creditsBalance };
  }

  const updatedRows = await db
    .update(users)
    .set({
      creditsBalance: sql`${users.creditsBalance} + ${res.creditsReserved}`,
      updatedAt: now,
    })
    .where(eq(users.id, user.id))
    .returning({ creditsBalance: users.creditsBalance });

  const newBalance = updatedRows[0]?.creditsBalance ?? user.creditsBalance + res.creditsReserved;

  await db
    .insert(creditLedger)
    .values({
      id: `led_${crypto.randomUUID()}`,
      userId: user.id,
      projectId: res.projectId,
      chapterId: res.chapterId,
      idempotencyKey: refundKey,
      entryType: "refund",
      creditsDelta: res.creditsReserved,
      balanceAfter: newBalance,
      note: `Automatic refund: ${reason}`,
      createdAt: now,
    })
    .onConflictDoNothing();

  return { refunded: true, balanceAfter: newBalance };
}

/**
 * Counts non-failed research sweeps already started or completed by a user across all projects.
 * Failed sweeps never count against the user's free feasibility sweep quota.
 */
export async function countUserNonFailedSweeps(db: AppDb, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(researchRuns)
    .innerJoin(projects, eq(researchRuns.projectId, projects.id))
    .where(and(eq(projects.userId, userId), ne(researchRuns.status, "failed")));

  return Number(row?.count ?? 0);
}

export async function issueAdminManualRefund(
  db: AppDb,
  params: {
    adminUserId: string;
    targetUserId: string;
    credits: number;
    reason: string;
    idempotencyKey: string;
    now?: Date;
  }
): Promise<{ alreadyProcessed: boolean; balanceAfter: number }> {
  if (!Number.isInteger(params.credits) || params.credits <= 0) {
    throw new BillingError(
      "INVALID_AMOUNT",
      "Manual refund credits must be a positive integer.",
      400
    );
  }
  const now = params.now ?? new Date();
  const [target] = await db.select().from(users).where(eq(users.id, params.targetUserId)).limit(1);
  if (!target) {
    throw new BillingError("USER_NOT_FOUND", "Target user not found.", 404);
  }

  const claimed = await db
    .insert(creditLedger)
    .values({
      id: `led_${crypto.randomUUID()}`,
      userId: target.id,
      idempotencyKey: params.idempotencyKey,
      entryType: "manual_adjustment",
      creditsDelta: params.credits,
      balanceAfter: target.creditsBalance + params.credits,
      note: `Admin refund/adjustment: ${params.reason}`,
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: creditLedger.id });

  if (claimed.length === 0) {
    return { alreadyProcessed: true, balanceAfter: target.creditsBalance };
  }

  const updatedRows = await db
    .update(users)
    .set({
      creditsBalance: sql`${users.creditsBalance} + ${params.credits}`,
      updatedAt: now,
    })
    .where(eq(users.id, target.id))
    .returning({ creditsBalance: users.creditsBalance });

  const newBalance = updatedRows[0]?.creditsBalance ?? target.creditsBalance + params.credits;

  await db
    .update(creditLedger)
    .set({ balanceAfter: newBalance })
    .where(eq(creditLedger.id, claimed[0]!.id));

  await db.insert(auditLog).values({
    id: `aud_${crypto.randomUUID()}`,
    actorUserId: params.adminUserId,
    action: "admin.manual_credit_refund",
    entityType: "user",
    entityId: target.id,
    metadataJson: JSON.stringify({ credits: params.credits, reason: params.reason }),
    createdAt: now,
  });

  return { alreadyProcessed: false, balanceAfter: newBalance };
}

/**
 * Takes credits back from a user, for example after a refund or chargeback through Polar or
 * Paystack, or a grant made by mistake. Never takes the balance below zero: if the user has
 * already spent some, only what is left is removed, and the result says how much that was.
 */
export async function issueAdminCreditDeduction(
  db: AppDb,
  params: {
    adminUserId: string;
    targetUserId: string;
    credits: number;
    reason: string;
    idempotencyKey: string;
    now?: Date;
  }
): Promise<{ alreadyProcessed: boolean; deducted: number; balanceAfter: number }> {
  if (!Number.isInteger(params.credits) || params.credits <= 0) {
    throw new BillingError("INVALID_AMOUNT", "Credits to deduct must be a positive integer.", 400);
  }
  const now = params.now ?? new Date();

  const [previous] = await db
    .select({ creditsDelta: creditLedger.creditsDelta, balanceAfter: creditLedger.balanceAfter })
    .from(creditLedger)
    .where(eq(creditLedger.idempotencyKey, params.idempotencyKey))
    .limit(1);
  if (previous) {
    return {
      alreadyProcessed: true,
      deducted: Math.abs(previous.creditsDelta),
      balanceAfter: previous.balanceAfter,
    };
  }

  // Up to 3 tries: the balance can change between reading it and updating it (a chapter
  // reserving credits at the same moment); the update only applies if it is unchanged.
  for (let attempt = 0; attempt < 3; attempt++) {
    const [target] = await db
      .select({ id: users.id, creditsBalance: users.creditsBalance })
      .from(users)
      .where(eq(users.id, params.targetUserId))
      .limit(1);
    if (!target) throw new BillingError("USER_NOT_FOUND", "Target user not found.", 404);
    if (target.creditsBalance <= 0) {
      throw new BillingError("NOTHING_TO_DEDUCT", "This user has no credits to deduct.", 409);
    }

    const deducted = Math.min(params.credits, target.creditsBalance);
    const updated = await db
      .update(users)
      .set({ creditsBalance: target.creditsBalance - deducted, updatedAt: now })
      .where(and(eq(users.id, target.id), eq(users.creditsBalance, target.creditsBalance)))
      .returning({ creditsBalance: users.creditsBalance });
    if (updated.length === 0) continue;

    const balanceAfter = updated[0]!.creditsBalance;
    await db.insert(creditLedger).values({
      id: `led_${crypto.randomUUID()}`,
      userId: target.id,
      idempotencyKey: params.idempotencyKey,
      entryType: "manual_adjustment",
      creditsDelta: -deducted,
      balanceAfter,
      note: `Admin deduction: ${params.reason}`,
      createdAt: now,
    });
    await db.insert(auditLog).values({
      id: `aud_${crypto.randomUUID()}`,
      actorUserId: params.adminUserId,
      action: "admin.manual_credit_deduction",
      entityType: "user",
      entityId: target.id,
      metadataJson: JSON.stringify({
        requested: params.credits,
        deducted,
        reason: params.reason,
      }),
      createdAt: now,
    });
    return { alreadyProcessed: false, deducted, balanceAfter };
  }
  throw new BillingError("BALANCE_CHANGED", "The balance changed while deducting. Try again.", 409);
}

export interface AdminBatchCreditParams {
  adminUserId: string;
  campaignId: string;
  credits: number;
  reason: string;
  mode: "all" | "random_sample";
  cursorUserId?: string | null;
  batchSize?: number;
  remainingTargetCount?: number;
  now?: Date;
}

export interface AdminBatchCreditResult {
  campaignId: string;
  mode: "all" | "random_sample";
  creditsPerUser: number;
  creditedInBatch: number;
  skippedInBatch: number;
  totalUsers: number;
  nextCursorUserId: string | null;
  done: boolean;
}

/**
 * Credits users in cursor-paginated, atomic, strictly idempotent batches so bulk outage
 * compensation or promotional grants scale cleanly to 100,000+ users within Cloudflare
 * Workers & D1 limits (staying well under D1's 100 bound-parameter per-statement cap).
 */
export async function issueAdminBatchCredits(
  db: AppDb,
  params: AdminBatchCreditParams
): Promise<AdminBatchCreditResult> {
  const now = params.now ?? new Date();
  const safeBatchSize = Math.max(1, Math.min(80, Math.floor(params.batchSize ?? 50)));
  const cleanCampaign = params.campaignId.trim();

  const [countRow] = await db.select({ count: sql<number>`count(*)` }).from(users);
  const totalUsers = Number(countRow?.count ?? 0);

  let candidates: Array<{ id: string; creditsBalance: number }> = [];
  let hasMore = false;
  let nextCursorUserId: string | null = null;

  if (params.mode === "random_sample") {
    const remaining = Math.max(0, Math.floor(params.remainingTargetCount ?? safeBatchSize));
    const take = Math.min(safeBatchSize, remaining);
    if (take > 0) {
      const keyPrefix = `batch:${cleanCampaign}:`;
      candidates = await db
        .select({ id: users.id, creditsBalance: users.creditsBalance })
        .from(users)
        .where(
          sql`NOT EXISTS (SELECT 1 FROM ${creditLedger} WHERE ${creditLedger.idempotencyKey} = ${keyPrefix} || ${users.id})`
        )
        .orderBy(sql`RANDOM()`)
        .limit(take);
      hasMore = candidates.length >= take && remaining - candidates.length > 0;
    }
  } else {
    const fetched = await db
      .select({ id: users.id, creditsBalance: users.creditsBalance })
      .from(users)
      .where(params.cursorUserId ? gt(users.id, params.cursorUserId) : undefined)
      .orderBy(asc(users.id))
      .limit(safeBatchSize + 1);

    hasMore = fetched.length > safeBatchSize;
    candidates = hasMore ? fetched.slice(0, safeBatchSize) : fetched;
    nextCursorUserId =
      hasMore && candidates.length > 0 ? (candidates[candidates.length - 1]?.id ?? null) : null;
  }

  if (candidates.length === 0) {
    return {
      campaignId: cleanCampaign,
      mode: params.mode,
      creditsPerUser: params.credits,
      creditedInBatch: 0,
      skippedInBatch: 0,
      totalUsers,
      nextCursorUserId: null,
      done: true,
    };
  }

  // Idempotency check: skip any user already credited under this campaignId
  const candidateKeys = candidates.map((u) => `batch:${cleanCampaign}:${u.id}`);
  const existingKeySet = new Set<string>();
  for (let i = 0; i < candidateKeys.length; i += 40) {
    const slice = candidateKeys.slice(i, i + 40);
    const existingRows = await db
      .select({ idempotencyKey: creditLedger.idempotencyKey })
      .from(creditLedger)
      .where(inArray(creditLedger.idempotencyKey, slice));
    for (const row of existingRows) {
      existingKeySet.add(row.idempotencyKey);
    }
  }

  const eligible = candidates.filter((u) => !existingKeySet.has(`batch:${cleanCampaign}:${u.id}`));
  const skippedInBatch = candidates.length - eligible.length;

  if (eligible.length > 0) {
    // Chunk SQL statements strictly below Cloudflare D1's 100 bound-parameter limit
    // and execute all updates + ledger writes + audit log atomically in a single db.batch().
    const batchOps: Array<Parameters<typeof db.batch>[0][number]> = [];

    for (let i = 0; i < eligible.length; i += 40) {
      const idChunk = eligible.slice(i, i + 40).map((u) => u.id);
      batchOps.push(
        db
          .update(users)
          .set({
            creditsBalance: sql`${users.creditsBalance} + ${params.credits}`,
            updatedAt: now,
          })
          .where(inArray(users.id, idChunk))
      );
    }

    const ledgerValues = eligible.map((u) => ({
      id: `led_${crypto.randomUUID()}`,
      userId: u.id,
      idempotencyKey: `batch:${cleanCampaign}:${u.id}`,
      entryType: "manual_adjustment" as const,
      creditsDelta: params.credits,
      balanceAfter: u.creditsBalance + params.credits,
      note: `Batch credit (${cleanCampaign}): ${params.reason}`,
      createdAt: now,
    }));

    // 8 rows * 11 cols = 88 bound params (safely below D1's 100-variable ceiling)
    for (let i = 0; i < ledgerValues.length; i += 8) {
      batchOps.push(db.insert(creditLedger).values(ledgerValues.slice(i, i + 8)));
    }

    batchOps.push(
      db.insert(auditLog).values({
        id: `aud_${crypto.randomUUID()}`,
        actorUserId: params.adminUserId,
        action: "admin.batch_credit_grant",
        entityType: "campaign",
        entityId: cleanCampaign,
        metadataJson: JSON.stringify({
          mode: params.mode,
          creditsPerUser: params.credits,
          creditedInBatch: eligible.length,
          skippedInBatch,
          reason: params.reason,
        }),
        createdAt: now,
      })
    );

    await db.batch(
      batchOps as [
        Parameters<typeof db.batch>[0][number],
        ...Array<Parameters<typeof db.batch>[0][number]>,
      ]
    );
  }

  return {
    campaignId: cleanCampaign,
    mode: params.mode,
    creditsPerUser: params.credits,
    creditedInBatch: eligible.length,
    skippedInBatch,
    totalUsers,
    nextCursorUserId,
    done: !hasMore,
  };
}

export const PUBLIC_WRITING_PAUSED_MESSAGE =
  "Writing is temporarily unavailable while we resolve a brief service interruption. Please try again in a few minutes.";

export const PUBLIC_RESEARCH_PAUSED_MESSAGE =
  "Research is temporarily unavailable while we resolve a brief service interruption. Please try again in a few minutes.";

export interface CircuitBreakerStatus {
  allowed: boolean;
  reason?: string;
  globalDailySpendUsd: number;
  globalKillSwitchActive: boolean;
}

export async function setGlobalCircuitBreaker(
  db: AppDb,
  paused: boolean,
  reason: string,
  now: Date = new Date()
): Promise<void> {
  await db
    .insert(systemControls)
    .values({
      key: "global_circuit_breaker",
      valueJson: JSON.stringify({ paused, reason }),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: systemControls.key,
      set: {
        valueJson: JSON.stringify({ paused, reason }),
        updatedAt: now,
      },
    });
}

export async function checkSpendCircuitBreaker(
  db: AppDb,
  now: Date = new Date()
): Promise<CircuitBreakerStatus> {
  const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [[control], [sumRow]] = await Promise.all([
    db
      .select()
      .from(systemControls)
      .where(eq(systemControls.key, "global_circuit_breaker"))
      .limit(1),
    db
      .select({
        total: sql<number>`coalesce(sum(${jobsLog.costEstimateUsd}), 0)`,
      })
      .from(jobsLog)
      .where(gte(jobsLog.createdAt, dayStart)),
  ]);

  const globalDailySpendUsd = Number(sumRow?.total ?? 0);

  let lastAdminResumeAt: Date | null = null;
  if (control) {
    try {
      const parsed = JSON.parse(control.valueJson) as { paused?: boolean; reason?: string };
      if (parsed.paused) {
        return {
          allowed: false,
          reason: parsed.reason || "Global AI spend circuit breaker is active.",
          globalDailySpendUsd,
          globalKillSwitchActive: true,
        };
      }
      lastAdminResumeAt = control.updatedAt;
    } catch {
      // Ignore corrupt control JSON
    }
  }

  if (globalDailySpendUsd >= BILLING_POLICY.spendCaps.globalDailyUsd) {
    return {
      allowed: false,
      reason: `Global 24h AI spend cap ($${BILLING_POLICY.spendCaps.globalDailyUsd}) reached.`,
      globalDailySpendUsd,
      globalKillSwitchActive: false,
    };
  }

  // Only inspect recent jobs inside the rolling failure window (and strictly after any manual
  // admin Resume), and automatically transition to half-open once the cooldown expires so a
  // prior failure burst can never permanently deadlock the app.
  const failureWindowStart = new Date(
    now.getTime() - BILLING_POLICY.spendCaps.failureTripWindowMinutes * 60 * 1000
  );
  const cooldownCutoff = new Date(
    now.getTime() - BILLING_POLICY.spendCaps.failureTripCooldownMinutes * 60 * 1000
  );
  const recentFilter =
    lastAdminResumeAt && lastAdminResumeAt.getTime() >= failureWindowStart.getTime()
      ? gt(jobsLog.createdAt, lastAdminResumeAt)
      : gte(jobsLog.createdAt, failureWindowStart);

  const recentJobs = await db
    .select({ status: jobsLog.status, createdAt: jobsLog.createdAt })
    .from(jobsLog)
    .where(recentFilter)
    .orderBy(desc(jobsLog.createdAt))
    .limit(BILLING_POLICY.spendCaps.maxConsecutiveFailedJobsBeforeTrip);

  const latestJobAt = recentJobs[0]?.createdAt;
  if (
    recentJobs.length >= BILLING_POLICY.spendCaps.maxConsecutiveFailedJobsBeforeTrip &&
    recentJobs.every((j) => j.status === "failed") &&
    latestJobAt &&
    latestJobAt.getTime() >= cooldownCutoff.getTime()
  ) {
    return {
      allowed: false,
      reason: "Circuit breaker tripped after consecutive AI job failures.",
      globalDailySpendUsd,
      globalKillSwitchActive: false,
    };
  }

  return {
    allowed: true,
    globalDailySpendUsd,
    globalKillSwitchActive: false,
  };
}
