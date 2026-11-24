import { and, asc, desc, eq, gt, gte, inArray, like, ne, sql } from "drizzle-orm";
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

export class BillingError extends Error {
  public readonly code:
    "INSUFFICIENT_CREDITS" | "USER_NOT_FOUND" | "RESERVATION_NOT_FOUND" | "CIRCUIT_BREAKER_OPEN";
  public readonly status: number;
  public readonly availableCredits?: number;

  constructor(
    code:
      "INSUFFICIENT_CREDITS" | "USER_NOT_FOUND" | "RESERVATION_NOT_FOUND" | "CIRCUIT_BREAKER_OPEN",
    message: string,
    status: number,
    availableCredits?: number
  ) {
    super(message);
    this.name = "BillingError";
    this.code = code;
    this.status = status;
    this.availableCredits = availableCredits;
  }
}

/**
 * Grants credits for a verified Paystack or Stripe payment EXACTLY ONCE.
 * Replayed webhooks return alreadyProcessed=true without touching the user's balance again.
 */
export async function grantPaymentCreditsIdempotent(
  db: AppDb,
  payment: NormalizedPaymentWebhook,
  rawEventJson: string,
  now: Date = new Date()
): Promise<{ alreadyProcessed: boolean; paymentId: string; newBalance: number }> {
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

  const paymentId = existing?.id ?? `pay_${crypto.randomUUID()}`;
  const idempotencyKey = `payment:${payment.provider}:${payment.providerReference}`;

  if (existing) {
    await db
      .update(payments)
      .set({
        status: "succeeded",
        rawEventJson: rawEventJson.slice(0, 8000),
        updatedAt: now,
      })
      .where(eq(payments.id, paymentId));
  } else {
    await db.insert(payments).values({
      id: paymentId,
      userId: payment.userId,
      provider: payment.provider,
      providerReference: payment.providerReference,
      currency: payment.currency,
      amountMinor: payment.amountMinor,
      creditsGranted: payment.creditsGranted,
      status: "succeeded",
      rawEventJson: rawEventJson.slice(0, 8000),
      createdAt: now,
      updatedAt: now,
    });
  }

  const [existingLedger] = await db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.idempotencyKey, idempotencyKey))
    .limit(1);

  if (existingLedger) {
    return {
      alreadyProcessed: true,
      paymentId,
      newBalance: user.creditsBalance,
    };
  }

  const newBalance = user.creditsBalance + payment.creditsGranted;
  await db
    .update(users)
    .set({ creditsBalance: newBalance, updatedAt: now })
    .where(eq(users.id, user.id));

  await db.insert(creditLedger).values({
    id: `led_${crypto.randomUUID()}`,
    userId: user.id,
    paymentId,
    idempotencyKey,
    entryType: "purchase",
    creditsDelta: payment.creditsGranted,
    balanceAfter: newBalance,
    note: `${payment.provider.toUpperCase()} payment ${payment.providerReference}`,
    createdAt: now,
  });

  await db.insert(auditLog).values({
    id: `aud_${crypto.randomUUID()}`,
    actorUserId: user.id,
    action: "billing.credits_purchased",
    entityType: "payment",
    entityId: paymentId,
    metadataJson: JSON.stringify({
      provider: payment.provider,
      creditsGranted: payment.creditsGranted,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
    }),
    createdAt: now,
  });

  return { alreadyProcessed: false, paymentId, newBalance };
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

  const updatedRows = await db
    .update(users)
    .set({
      creditsBalance: sql`${users.creditsBalance} - ${params.credits}`,
      updatedAt: now,
    })
    .where(and(eq(users.id, user.id), gte(users.creditsBalance, params.credits)))
    .returning({ creditsBalance: users.creditsBalance });

  const updatedUser = updatedRows[0];
  if (!updatedUser) {
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
      note: "Captured credits for completed chapter after premature workflow-reset refund",
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

  if (res.status === "refunded") {
    return { refunded: false, balanceAfter: user.creditsBalance };
  }

  const refundKey = `refund:${res.id}`;
  const [existingRefund] = await db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.idempotencyKey, refundKey))
    .limit(1);

  if (existingRefund) {
    return { refunded: false, balanceAfter: user.creditsBalance };
  }

  const newBalance = user.creditsBalance + res.creditsReserved;
  await db
    .update(users)
    .set({ creditsBalance: newBalance, updatedAt: now })
    .where(eq(users.id, user.id));

  await db
    .update(creditReservations)
    .set({ status: "refunded", settledAt: now })
    .where(eq(creditReservations.id, res.id));

  await db.insert(creditLedger).values({
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
  });

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
  const now = params.now ?? new Date();
  const [target] = await db.select().from(users).where(eq(users.id, params.targetUserId)).limit(1);
  if (!target) {
    throw new BillingError("USER_NOT_FOUND", "Target user not found.", 404);
  }

  const [existing] = await db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.idempotencyKey, params.idempotencyKey))
    .limit(1);
  if (existing) {
    return { alreadyProcessed: true, balanceAfter: target.creditsBalance };
  }

  const newBalance = Math.max(0, target.creditsBalance + params.credits);
  await db
    .update(users)
    .set({ creditsBalance: newBalance, updatedAt: now })
    .where(eq(users.id, target.id));

  await db.insert(creditLedger).values({
    id: `led_${crypto.randomUUID()}`,
    userId: target.id,
    idempotencyKey: params.idempotencyKey,
    entryType: "manual_adjustment",
    creditsDelta: params.credits,
    balanceAfter: newBalance,
    note: `Admin refund/adjustment: ${params.reason}`,
    createdAt: now,
  });

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
