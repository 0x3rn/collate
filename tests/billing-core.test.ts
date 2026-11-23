import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { createProjectForUser } from "@/db/queries/projects";
import { jobsLog, users } from "@/db/schema";
import {
  captureChapterReservation,
  checkSpendCircuitBreaker,
  grantPaymentCreditsIdempotent,
  issueAdminManualRefund,
  refundChapterReservation,
  reserveChapterCredits,
  setGlobalCircuitBreaker,
} from "@/lib/billing/ledger";
import { computeHmacHex, verifyPaystackWebhook, verifyStripeWebhook } from "@/lib/billing/webhooks";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

describe("Phase 11 — Paystack & Stripe Webhook Verification, Idempotency & Refund Rules", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  const now = new Date("2026-11-23T12:00:00.000Z");

  beforeEach(async () => {
    d1Ctx = createInMemoryD1();
    d1Ctx.applyMigrations();
    db = createDb(d1Ctx.d1);

    await db.insert(users).values({
      id: "usr_pay",
      email: "student@uni.edu.ng",
      emailVerified: true,
      name: "Chidi Okafor",
      creditsBalance: 0,
      createdAt: now,
      updatedAt: now,
    });
    await createProjectForUser(db, {
      id: "prj_pay",
      userId: "usr_pay",
      type: "thesis",
      title: "Solar Microgrids",
      now,
    });
  });

  afterEach(() => {
    d1Ctx.close();
  });

  it("verifies Paystack HMAC-SHA512 webhook and grants credits EXACTLY ONCE across replays", async () => {
    const secret = "sk_test_paystack_secret";
    const rawBody = JSON.stringify({
      event: "charge.success",
      data: {
        reference: "PSK_REF_001",
        amount: 1_650_000,
        currency: "NGN",
        metadata: { userId: "usr_pay", credits: 60 },
      },
    });
    const validSig = await computeHmacHex("SHA-512", secret, rawBody);

    // Tampered signature rejected
    const bad = await verifyPaystackWebhook({
      rawBody,
      signatureHeader: "deadbeef",
      secretKey: secret,
    });
    expect(bad.valid).toBe(false);

    // Valid signature accepted
    const verified = await verifyPaystackWebhook({
      rawBody,
      signatureHeader: validSig,
      secretKey: secret,
    });
    expect(verified.valid).toBe(true);
    if (!verified.valid || !verified.payment) throw new Error("Expected verified Paystack payment");

    // Process the same webhook 3 times -> must grant 60 credits EXACTLY ONCE
    const g1 = await grantPaymentCreditsIdempotent(db, verified.payment, rawBody, now);
    const g2 = await grantPaymentCreditsIdempotent(db, verified.payment, rawBody, now);
    const g3 = await grantPaymentCreditsIdempotent(db, verified.payment, rawBody, now);

    expect(g1.alreadyProcessed).toBe(false);
    expect(g1.newBalance).toBe(60);
    expect(g2.alreadyProcessed).toBe(true);
    expect(g2.newBalance).toBe(60);
    expect(g3.alreadyProcessed).toBe(true);

    const [usr] = await db.select().from(users).where(eq(users.id, "usr_pay"));
    expect(usr?.creditsBalance).toBe(60);
  });

  it("verifies Stripe HMAC-SHA256 webhook with replay guard and grants credits EXACTLY ONCE", async () => {
    const secret = "whsec_test_stripe_secret";
    const rawBody = JSON.stringify({
      id: "evt_123",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_999",
          amount_total: 1400,
          currency: "usd",
          payment_status: "paid",
          metadata: { userId: "usr_pay", credits: "60" },
        },
      },
    });

    const ts = Math.floor(now.getTime() / 1000);
    const sig = await computeHmacHex("SHA-256", secret, `${ts}.${rawBody}`);
    const header = `t=${ts},v1=${sig}`;

    // Stale replay (> 5 mins old) must be rejected
    const stale = await verifyStripeWebhook({
      rawBody,
      signatureHeader: header,
      webhookSecret: secret,
      nowMs: now.getTime() + 10 * 60 * 1000,
    });
    expect(stale.valid).toBe(false);

    const verified = await verifyStripeWebhook({
      rawBody,
      signatureHeader: header,
      webhookSecret: secret,
      nowMs: now.getTime() + 15_000,
    });
    expect(verified.valid).toBe(true);
    if (!verified.valid || !verified.payment) throw new Error("Expected verified Stripe payment");

    const s1 = await grantPaymentCreditsIdempotent(db, verified.payment, rawBody, now);
    const s2 = await grantPaymentCreditsIdempotent(db, verified.payment, rawBody, now);
    expect(s1.alreadyProcessed).toBe(false);
    expect(s1.newBalance).toBe(60);
    expect(s2.alreadyProcessed).toBe(true);
    expect(s2.newBalance).toBe(60);
  });

  it("reserves credits on start, refunds 100% on failed chapter, and captures on success", async () => {
    await db.update(users).set({ creditsBalance: 20 }).where(eq(users.id, "usr_pay"));

    // Chapter 1 fails -> full refund leaves balance at 20 (failed chapter consumes 0 credits!)
    const failRes = await reserveChapterCredits(db, {
      userId: "usr_pay",
      projectId: "prj_pay",
      credits: 8,
      idempotencyKey: "ch1_run_fail",
      now,
    });
    expect(failRes.balanceAfter).toBe(12);

    const refunded1 = await refundChapterReservation(
      db,
      failRes.reservationId,
      "Workflow error",
      now
    );
    expect(refunded1.refunded).toBe(true);
    expect(refunded1.balanceAfter).toBe(20);

    // Duplicate refund call is idempotent (does not double-refund!)
    const refunded2 = await refundChapterReservation(db, failRes.reservationId, "Retry", now);
    expect(refunded2.refunded).toBe(false);
    expect(refunded2.balanceAfter).toBe(20);

    // Successful chapter captures reservation cleanly
    const okRes = await reserveChapterCredits(db, {
      userId: "usr_pay",
      projectId: "prj_pay",
      credits: 8,
      idempotencyKey: "ch1_run_ok",
      now,
    });
    expect(okRes.balanceAfter).toBe(12);
    const cap = await captureChapterReservation(db, okRes.reservationId, now);
    expect(cap.status).toBe("captured");

    // Insufficient credits throws 402
    await expect(
      reserveChapterCredits(db, {
        userId: "usr_pay",
        projectId: "prj_pay",
        credits: 50,
        idempotencyKey: "too_big",
        now,
      })
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS", status: 402 });

    // Manual admin refund works idempotently
    const manual = await issueAdminManualRefund(db, {
      adminUserId: "usr_pay",
      targetUserId: "usr_pay",
      credits: 5,
      reason: "Goodwill refund",
      idempotencyKey: "admin_ref_1",
      now,
    });
    expect(manual.balanceAfter).toBe(17);
  });

  it("trips spend circuit breaker on global daily cap or manual kill switch", async () => {
    expect((await checkSpendCircuitBreaker(db, now)).allowed).toBe(true);

    await db.insert(jobsLog).values({
      id: "job_huge",
      workflowId: "wf_runaway",
      projectId: "prj_pay",
      step: "draft",
      model: "claude-sonnet-4-5",
      status: "succeeded",
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
      costEstimateUsd: 300,
      createdAt: now,
    });

    const tripped = await checkSpendCircuitBreaker(db, now);
    expect(tripped.allowed).toBe(false);
    expect(tripped.reason).toContain("Global 24h AI spend cap");

    await setGlobalCircuitBreaker(db, true, "Maintenance pause", now);
    const manualPause = await checkSpendCircuitBreaker(db, now);
    expect(manualPause.allowed).toBe(false);
    expect(manualPause.globalKillSwitchActive).toBe(true);
  });
});
