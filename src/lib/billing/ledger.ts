import { and, desc, eq, gte, sql } from "drizzle-orm";
import { BILLING_POLICY } from "@/config/pricing";
import type { AppDb } from "@/db/client";
import {
  auditLog,
  creditLedger,
  creditReservations,
  jobsLog,
  payments,
  systemControls,
  users,
} from "@/db/schema";
import type { NormalizedPaymentWebhook } from "./webhooks";

export class BillingError extends Error {
  public readonly code:
    "INSUFFICIENT_CREDITS" | "USER_NOT_FOUND" | "RESERVATION_NOT_FOUND" | "CIRCUIT_BREAKER_OPEN";
  public readonly status: number;

  constructor(
    code:
      "INSUFFICIENT_CREDITS" | "USER_NOT_FOUND" | "RESERVATION_NOT_FOUND" | "CIRCUIT_BREAKER_OPEN",
    message: string,
    status: number
  ) {
    super(message);
    this.name = "BillingError";
    this.code = code;
    this.status = status;
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

  if (user.creditsBalance < params.credits) {
    throw new BillingError(
      "INSUFFICIENT_CREDITS",
      `Insufficient credits: need ${params.credits}, available ${user.creditsBalance}.`,
      402
    );
  }

  const newBalance = user.creditsBalance - params.credits;
  const reservationId = `res_${crypto.randomUUID()}`;

  await db
    .update(users)
    .set({ creditsBalance: newBalance, updatedAt: now })
    .where(eq(users.id, user.id));

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
 */
export async function captureChapterReservation(
  db: AppDb,
  reservationId: string,
  now: Date = new Date()
): Promise<{ status: "captured" | "refunded" }> {
  const [res] = await db
    .select()
    .from(creditReservations)
    .where(eq(creditReservations.id, reservationId))
    .limit(1);

  if (!res) {
    throw new BillingError("RESERVATION_NOT_FOUND", "Credit reservation not found.", 404);
  }
  if (res.status !== "held") {
    return { status: res.status };
  }

  await db
    .update(creditReservations)
    .set({ status: "captured", settledAt: now })
    .where(eq(creditReservations.id, res.id));

  return { status: "captured" };
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
  const [control] = await db
    .select()
    .from(systemControls)
    .where(eq(systemControls.key, "global_circuit_breaker"))
    .limit(1);

  if (control) {
    try {
      const parsed = JSON.parse(control.valueJson) as { paused?: boolean; reason?: string };
      if (parsed.paused) {
        return {
          allowed: false,
          reason: parsed.reason || "Global AI spend circuit breaker is active.",
          globalDailySpendUsd: 0,
          globalKillSwitchActive: true,
        };
      }
    } catch {
      // Ignore corrupt control JSON
    }
  }

  const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [sumRow] = await db
    .select({
      total: sql<number>`coalesce(sum(${jobsLog.costEstimateUsd}), 0)`,
    })
    .from(jobsLog)
    .where(gte(jobsLog.createdAt, dayStart));

  const globalDailySpendUsd = Number(sumRow?.total ?? 0);
  if (globalDailySpendUsd >= BILLING_POLICY.spendCaps.globalDailyUsd) {
    return {
      allowed: false,
      reason: `Global 24h AI spend cap ($${BILLING_POLICY.spendCaps.globalDailyUsd}) reached.`,
      globalDailySpendUsd,
      globalKillSwitchActive: false,
    };
  }

  const recentJobs = await db
    .select({ status: jobsLog.status })
    .from(jobsLog)
    .orderBy(desc(jobsLog.createdAt))
    .limit(BILLING_POLICY.spendCaps.maxConsecutiveFailedJobsBeforeTrip);

  if (
    recentJobs.length >= BILLING_POLICY.spendCaps.maxConsecutiveFailedJobsBeforeTrip &&
    recentJobs.every((j) => j.status === "failed")
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
