import { and, eq, inArray, isNotNull, lte, or } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import {
  auditLog,
  type PaymentProvider,
  paymentReversals,
  payments,
  retainedBillingRecords,
} from "@/db/schema";
import { buildDisputeEvidence, type DisputeEvidence } from "@/lib/billing/evidence-report";

/**
 * What survives account deletion. Deleting an account erases the person's data, except a record
 * of each completed payment: otherwise someone could buy credits, use them, delete the account
 * and then charge back with nothing left to answer with, and the books would lose the sale.
 *
 * These periods are the ones stated in the Privacy Policy: change both together.
 */
export const EVIDENCE_RETENTION_DAYS = 540; // 18 months: the outer card chargeback window
export const RECORD_RETENTION_YEARS = 6;

const evidenceCutoff = (paidAt: Date) =>
  new Date(paidAt.getTime() + EVIDENCE_RETENTION_DAYS * 24 * 60 * 60 * 1000);

function recordCutoff(paidAt: Date): Date {
  const d = new Date(paidAt);
  d.setUTCFullYear(d.getUTCFullYear() + RECORD_RETENTION_YEARS);
  return d;
}

/**
 * Copies each completed payment (and, while still useful, its evidence) before the account is
 * deleted. Throws if anything cannot be saved, so the caller does not delete the account.
 * Returns how many records were kept.
 */
export async function retainBillingRecords(db: AppDb, userId: string, now: Date): Promise<number> {
  const rows = await db
    .select()
    .from(payments)
    .where(and(eq(payments.userId, userId), inArray(payments.status, ["succeeded", "refunded"])));
  let kept = 0;
  for (const p of rows) {
    if (recordCutoff(p.createdAt) <= now) continue;
    const evidence = await buildDisputeEvidence(db, p.id);
    if (!evidence) throw new Error(`No record could be built for payment ${p.id}`);
    const openDispute = evidence.reversals.some((r) => r.kind === "dispute" && !r.resolvedAt);
    const keepEvidence = openDispute || evidenceCutoff(p.createdAt) > now;
    const snapshot: DisputeEvidence = {
      ...evidence,
      accountDeletedAt: now,
      // The provider's raw message (which can hold billing details) is not kept.
      payment: { ...evidence.payment, rawEventJson: null },
      customer: { ...evidence.customer, holdReason: null },
      activeSessions: [],
      summary: `${evidence.summary} The customer deleted their account on ${now.toISOString().slice(0, 10)}.`,
    };
    await db
      .insert(retainedBillingRecords)
      .values({
        id: `ret_${crypto.randomUUID()}`,
        paymentId: p.id,
        userId,
        provider: p.provider,
        providerReference: p.providerReference,
        providerOrderId: p.providerOrderId ?? evidence.providerDetails.providerTransactionId,
        customerEmail: evidence.customer.email,
        customerName: evidence.customer.name,
        currency: p.currency,
        amountMinor: p.amountMinor,
        credits: p.creditsGranted,
        status: p.status,
        paidAt: p.createdAt,
        accountErasedAt: now,
        evidenceJson: keepEvidence ? JSON.stringify(snapshot) : null,
        evidencePurgeAfter: evidenceCutoff(p.createdAt),
        recordPurgeAfter: recordCutoff(p.createdAt),
        openDispute,
      })
      .onConflictDoNothing();
    kept++;
  }
  return kept;
}

/**
 * Removes IP addresses, devices and other details from the activity log of an account that is
 * about to be deleted. The bare entries (what happened, when) remain, tied to nobody.
 */
export async function scrubActivityDetails(db: AppDb, userId: string): Promise<void> {
  await db
    .update(auditLog)
    .set({ metadataJson: null })
    .where(
      or(
        eq(auditLog.actorUserId, userId),
        and(eq(auditLog.entityType, "user"), eq(auditLog.entityId, userId))
      )
    );
  await db
    .update(auditLog)
    .set({ entityId: "erased" })
    .where(and(eq(auditLog.entityType, "user"), eq(auditLog.entityId, userId)));
}

/** Deletes what has reached the end of its retention period (run on a schedule). */
export async function purgeExpiredRecords(
  db: AppDb,
  now: Date
): Promise<{ evidenceCleared: number; recordsDeleted: number }> {
  const deleted = await db
    .delete(retainedBillingRecords)
    .where(
      and(
        lte(retainedBillingRecords.recordPurgeAfter, now),
        eq(retainedBillingRecords.openDispute, false)
      )
    )
    .returning({ id: retainedBillingRecords.id });
  const cleared = await db
    .update(retainedBillingRecords)
    .set({ evidenceJson: null })
    .where(
      and(
        lte(retainedBillingRecords.evidencePurgeAfter, now),
        eq(retainedBillingRecords.openDispute, false),
        isNotNull(retainedBillingRecords.evidenceJson)
      )
    )
    .returning({ id: retainedBillingRecords.id });
  return { evidenceCleared: cleared.length, recordsDeleted: deleted.length };
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** The stored record as a DisputeEvidence, so the record page and PDF work unchanged. */
export function reviveRecord(row: typeof retainedBillingRecords.$inferSelect): DisputeEvidence {
  if (row.evidenceJson) {
    return JSON.parse(row.evidenceJson, (_key, value: unknown) =>
      typeof value === "string" && ISO.test(value) ? new Date(value) : value
    ) as DisputeEvidence;
  }
  // The detailed evidence has been purged: only the transaction itself remains.
  const provider = row.provider === "polar" ? "Polar" : "Paystack";
  return {
    accountDeletedAt: row.accountErasedAt,
    payment: {
      id: row.paymentId,
      userId: row.userId,
      provider: row.provider,
      providerReference: row.providerReference,
      providerOrderId: row.providerOrderId,
      currency: row.currency,
      amountMinor: row.amountMinor,
      creditsGranted: row.credits,
      status: row.status as typeof payments.$inferSelect.status,
      rawEventJson: null,
      createdAt: row.paidAt,
      updatedAt: row.paidAt,
    },
    providerDetails: {
      providerTransactionId: row.providerOrderId,
      providerTransactionIdLabel: row.providerOrderId ? `${provider} transaction ID` : null,
      paymentMethod: null,
      gatewayResponse: null,
      providerCustomerId: null,
      environment: null,
      paidAt: row.paidAt,
    },
    customer: {
      id: row.userId,
      name: row.customerName,
      email: row.customerEmail,
      emailVerified: true,
      createdAt: row.paidAt,
      holdReason: null,
    },
    reversals: [],
    otherPayments: [],
    checkout: {
      at: row.paidAt,
      what: "Started checkout",
      ip: null,
      device: null,
      location: null,
      termsVersion: null,
      termsAccepted: false,
      packId: null,
    },
    accountCreated: null,
    emailVerifiedAt: null,
    signIns: [],
    activeSessions: [],
    creditsUsedSincePayment: 0,
    chaptersDelivered: [],
    downloads: [],
    exportsCreated: 0,
    supportThreads: [],
    ipAddressesSeen: [],
    summary: `${row.customerName} (${row.customerEmail}) paid ${row.currency} ${(row.amountMinor / 100).toFixed(2)} via ${provider} (reference ${row.providerReference}) for ${row.credits} credits. The customer later deleted their account; the detailed activity records have passed their retention period.`,
  };
}

export async function findRetainedByPaymentId(
  db: AppDb,
  paymentId: string
): Promise<typeof retainedBillingRecords.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(retainedBillingRecords)
    .where(eq(retainedBillingRecords.paymentId, paymentId))
    .limit(1);
  return row ?? null;
}

/**
 * A refund or dispute that arrives after the account is gone. There are no credits left to take
 * back; the record is updated (an open dispute also stops it being purged). Returns null when
 * no kept record matches.
 */
export async function noteReversalOnRetained(
  db: AppDb,
  ev: {
    provider: PaymentProvider;
    kind: "refund" | "dispute";
    providerReversalId: string;
    payment: { providerReference?: string | null; providerOrderId?: string | null };
    amountMinor: number;
    currency: string;
    status: string;
    reason?: string | null;
    dueAt?: Date | null;
  },
  options: { now: Date }
): Promise<{ paymentId: string; customerEmail: string; isNew: boolean } | null> {
  const match = [];
  if (ev.payment.providerReference) {
    match.push(eq(retainedBillingRecords.providerReference, ev.payment.providerReference));
  }
  if (ev.payment.providerOrderId) {
    match.push(eq(retainedBillingRecords.providerOrderId, ev.payment.providerOrderId));
  }
  if (match.length === 0) return null;
  const [row] = await db
    .select()
    .from(retainedBillingRecords)
    .where(and(eq(retainedBillingRecords.provider, ev.provider), or(...match)))
    .limit(1);
  if (!row) return null;

  // Always keep the event on the record, even if the detailed evidence was already purged
  // (the next purge clears it again once no dispute is open).
  const record = reviveRecord(row);
  const existing = record.reversals.find(
    (r) => r.kind === ev.kind && r.providerReversalId === ev.providerReversalId
  );
  if (existing) {
    existing.status = ev.status;
    existing.updatedAt = options.now;
  } else {
    const added: typeof paymentReversals.$inferSelect = {
      id: `rev_${crypto.randomUUID()}`,
      paymentId: row.paymentId,
      userId: row.userId,
      provider: ev.provider,
      kind: ev.kind,
      providerReversalId: ev.providerReversalId,
      status: ev.status,
      reason: ev.reason ?? null,
      amountMinor: ev.amountMinor,
      currency: ev.currency.toUpperCase(),
      creditsTarget: 0,
      creditsRemoved: 0,
      creditsShort: 0,
      dueAt: ev.dueAt ?? null,
      resolvedAt: null,
      createdAt: options.now,
      updatedAt: options.now,
    };
    record.reversals.unshift(added);
  }
  const isNew = !existing;
  const evidenceJson = JSON.stringify(record);

  await db
    .update(retainedBillingRecords)
    .set({
      evidenceJson,
      openDispute: record.reversals.some((r) => r.kind === "dispute" && !r.resolvedAt),
      status: ev.kind === "refund" ? "refunded" : row.status,
    })
    .where(eq(retainedBillingRecords.id, row.id));
  return { paymentId: row.paymentId, customerEmail: row.customerEmail, isNew };
}

/** A dispute on a deleted account has its final result. Returns false if no record has it. */
export async function closeRetainedDispute(
  db: AppDb,
  params: { provider: PaymentProvider; providerDisputeId: string; status: string; now: Date }
): Promise<boolean> {
  const rows = await db
    .select()
    .from(retainedBillingRecords)
    .where(
      and(
        eq(retainedBillingRecords.provider, params.provider),
        eq(retainedBillingRecords.openDispute, true)
      )
    );
  for (const row of rows) {
    const record = reviveRecord(row);
    const dispute = record.reversals.find(
      (r) => r.kind === "dispute" && r.providerReversalId === params.providerDisputeId
    );
    if (!dispute) continue;
    dispute.status = params.status;
    dispute.resolvedAt = params.now;
    dispute.updatedAt = params.now;
    await db
      .update(retainedBillingRecords)
      .set({
        evidenceJson: JSON.stringify(record),
        openDispute: record.reversals.some((r) => r.kind === "dispute" && !r.resolvedAt),
      })
      .where(eq(retainedBillingRecords.id, row.id));
    return true;
  }
  return false;
}
