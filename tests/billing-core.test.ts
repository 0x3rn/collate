import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { createProjectForUser } from "@/db/queries/projects";
import { creditLedger, creditReservations, jobsLog, users } from "@/db/schema";
import {
  captureChapterReservation,
  checkSpendCircuitBreaker,
  ensurePrematureRefundsReconciled,
  grantPaymentCreditsIdempotent,
  issueAdminManualRefund,
  reconcilePrematurelyRefundedReservations,
  refundChapterReservation,
  reserveChapterCredits,
  resetReconciliationIsolateCacheForTests,
  setGlobalCircuitBreaker,
} from "@/lib/billing/ledger";
import {
  computeHmacBase64,
  computeHmacHex,
  verifyPaystackWebhook,
  verifyPolarWebhook,
  verifyStripeWebhook,
} from "@/lib/billing/webhooks";
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

  it("verifies Polar.sh Standard Webhooks (both base64 whsec_ and legacy UTF-8), rejects tamper/replay, ignores non-paid events, and grants credits EXACTLY ONCE", async () => {
    // 1. Post-Sept 2026 Standard Webhooks format: whsec_<base64(rawKeyBytes)>
    const rawKeyBytes = new TextEncoder().encode("polar-super-secret-key-32-bytes!");
    const b64Secret = `whsec_${Buffer.from(rawKeyBytes).toString("base64")}`;
    const webhookId = "msg_polar_001";
    const ts = String(Math.floor(now.getTime() / 1000));
    const orderPaidBody = JSON.stringify({
      type: "order.paid",
      data: {
        id: "ord_polar_100",
        checkout_id: "chk_polar_100",
        paid: true,
        total_amount: 2500,
        currency: "usd",
        customer: { external_id: "usr_pay", email: "student@uni.edu.ng" },
        metadata: { userId: "usr_pay", credits: 80, packId: "pack_project_60" },
      },
    });
    const signedPayload = `${webhookId}.${ts}.${orderPaidBody}`;
    const validB64Sig = await computeHmacBase64("SHA-256", rawKeyBytes, signedPayload);

    // Tampered body must fail
    const tampered = await verifyPolarWebhook({
      rawBody: orderPaidBody.replace("80", "9999"),
      webhookId,
      webhookTimestamp: ts,
      webhookSignature: `v1,${validB64Sig}`,
      webhookSecret: b64Secret,
      nowMs: now.getTime() + 10_000,
    });
    expect(tampered.valid).toBe(false);

    // Replay outside 5-minute window must fail
    const stale = await verifyPolarWebhook({
      rawBody: orderPaidBody,
      webhookId,
      webhookTimestamp: ts,
      webhookSignature: `v1,${validB64Sig}`,
      webhookSecret: b64Secret,
      nowMs: now.getTime() + 10 * 60 * 1000,
    });
    expect(stale.valid).toBe(false);

    // Rotated header with old + valid v1 signatures succeeds
    const verifiedB64 = await verifyPolarWebhook({
      rawBody: orderPaidBody,
      webhookId,
      webhookTimestamp: ts,
      webhookSignature: `v1,invalidOldSig== v1,${validB64Sig}`,
      webhookSecret: b64Secret,
      nowMs: now.getTime() + 15_000,
    });
    expect(verifiedB64.valid).toBe(true);
    if (!verifiedB64.valid || !verifiedB64.payment) {
      throw new Error("Expected verified Polar payment");
    }
    expect(verifiedB64.payment).toMatchObject({
      provider: "polar",
      providerReference: "chk_polar_100",
      userId: "usr_pay",
      currency: "USD",
      amountMinor: 2500,
      creditsGranted: 80,
    });

    // Idempotent credit grant across duplicate deliveries -> 80 credits EXACTLY ONCE
    const p1 = await grantPaymentCreditsIdempotent(db, verifiedB64.payment, orderPaidBody, now);
    const p2 = await grantPaymentCreditsIdempotent(db, verifiedB64.payment, orderPaidBody, now);
    expect(p1).toMatchObject({ alreadyProcessed: false, newBalance: 80 });
    expect(p2).toMatchObject({ alreadyProcessed: true, newBalance: 80 });

    // 2. Legacy Polar UTF-8 secret format (literal bytes of polar_whs_... or whsec_...) + customer.external_id & packId fallback
    const legacySecret = "polar_whs_legacy_literal_secret_key";
    const legacyBody = JSON.stringify({
      type: "order.paid",
      data: {
        id: "ord_polar_200",
        checkout_id: null,
        amount: 1000,
        currency: "usd",
        customer: { external_id: "usr_pay" },
        metadata: { packId: "pack_starter_25" },
      },
    });
    const legacySig = await computeHmacBase64(
      "SHA-256",
      new TextEncoder().encode(legacySecret),
      `msg_polar_002.${ts}.${legacyBody}`
    );
    const verifiedLegacy = await verifyPolarWebhook({
      rawBody: legacyBody,
      webhookId: "msg_polar_002",
      webhookTimestamp: ts,
      webhookSignature: `v1,${legacySig}`,
      webhookSecret: legacySecret,
      nowMs: now.getTime() + 5_000,
    });
    expect(verifiedLegacy.valid).toBe(true);
    if (!verifiedLegacy.valid || !verifiedLegacy.payment) {
      throw new Error("Expected verified legacy Polar payment");
    }
    expect(verifiedLegacy.payment).toMatchObject({
      provider: "polar",
      providerReference: "ord_polar_200",
      userId: "usr_pay",
      creditsGranted: 25,
      amountMinor: 1000,
    });

    // 3. Unrelated Polar events (e.g., checkout.created) are validly ignored
    const otherBody = JSON.stringify({
      type: "checkout.created",
      data: { id: "chk_other", status: "open" },
    });
    const otherSig = await computeHmacBase64(
      "SHA-256",
      rawKeyBytes,
      `msg_polar_003.${ts}.${otherBody}`
    );
    const ignored = await verifyPolarWebhook({
      rawBody: otherBody,
      webhookId: "msg_polar_003",
      webhookTimestamp: ts,
      webhookSignature: `v1,${otherSig}`,
      webhookSecret: b64Secret,
      nowMs: now.getTime() + 5_000,
    });
    expect(ignored).toEqual({ valid: true, ignored: true });
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

    // Insufficient credits throws 402 with exact available balance attached
    await expect(
      reserveChapterCredits(db, {
        userId: "usr_pay",
        projectId: "prj_pay",
        credits: 50,
        idempotencyKey: "too_big",
        now,
      })
    ).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS", status: 402, availableCredits: 12 });

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
    expect(manualPause.globalDailySpendUsd).toBe(300);
  });

  it("trips on consecutive recent failures, auto-recovers after cooldown, and clears immediately on admin resume", async () => {
    // Insert 12 consecutive failed jobs over the last 3 minutes
    const baseMs = now.getTime();
    for (let i = 0; i < 12; i += 1) {
      await db.insert(jobsLog).values({
        id: `job_fail_${i}`,
        workflowId: "wf_burst",
        projectId: "prj_pay",
        step: "draft",
        model: "gemini-4-neon",
        status: "failed",
        tokensIn: 0,
        tokensOut: 0,
        costEstimateUsd: 0,
        error: "HTTP 429",
        createdAt: new Date(baseMs - (11 - i) * 10_000),
      });
    }

    // Immediately after the 12th failure -> tripped
    const tripped = await checkSpendCircuitBreaker(db, now);
    expect(tripped.allowed).toBe(false);
    expect(tripped.reason).toContain("consecutive AI job failures");

    // 11 minutes after the latest failure -> cooldown expired (half-open), allows next run
    const afterCooldown = await checkSpendCircuitBreaker(db, new Date(baseMs + 11 * 60 * 1000));
    expect(afterCooldown.allowed).toBe(true);

    // Explicit admin Resume during the cooldown window clears the trip immediately
    await setGlobalCircuitBreaker(db, false, "Fixed upstream provider", now);
    const afterAdminResume = await checkSpendCircuitBreaker(db, new Date(baseMs + 30_000));
    expect(afterAdminResume.allowed).toBe(true);
  });

  it("self-heals captureChapterReservation after premature DO-reset refund and reconciles completed unbilled runs exactly once", async () => {
    resetReconciliationIsolateCacheForTests();
    await db.update(users).set({ creditsBalance: 973 }).where(eq(users.id, "usr_pay"));

    // Seed 3 refunded reservations matching production DO-reset race:
    // 1) rev_ok (5 credits) -> completed after DO reset (memory_summary_ch2 succeeded)
    // 2) rev_failed (2 credits) -> genuinely failed on spend cap (must stay refunded!)
    // 3) crun_ok (7 credits) -> completed after DO reset (memory_summary_ch1 succeeded)
    const t1 = new Date(now.getTime() + 1000);
    const t2 = new Date(now.getTime() + 2000);
    const t3 = new Date(now.getTime() + 3000);

    await db.insert(creditReservations).values([
      {
        id: "res_ch2_rev_ok",
        userId: "usr_pay",
        projectId: "prj_pay",
        chapterId: null,
        idempotencyKey: "revision:rev_ch2_ok",
        creditsReserved: 5,
        status: "refunded",
        createdAt: t1,
        settledAt: new Date(t1.getTime() + 500),
      },
      {
        id: "res_ch1_rev_fail",
        userId: "usr_pay",
        projectId: "prj_pay",
        chapterId: null,
        idempotencyKey: "revision:rev_ch1_fail",
        creditsReserved: 2,
        status: "refunded",
        createdAt: t2,
        settledAt: new Date(t2.getTime() + 500),
      },
      {
        id: "res_ch1_crun_ok",
        userId: "usr_pay",
        projectId: "prj_pay",
        chapterId: null,
        idempotencyKey: "chapter:crun_ch1_ok",
        creditsReserved: 7,
        status: "refunded",
        createdAt: t3,
        settledAt: new Date(t3.getTime() + 500),
      },
    ]);

    await db.insert(jobsLog).values([
      {
        id: "job_mem_ch2",
        workflowId: "rev_ch2_ok",
        projectId: "prj_pay",
        step: "memory_summary_ch2",
        model: "deepseek-flash",
        status: "succeeded",
        tokensIn: 2000,
        tokensOut: 900,
        costEstimateUsd: 0.001,
        createdAt: new Date(t1.getTime() + 1000),
      },
      {
        id: "job_cap_ch1",
        workflowId: "rev_ch1_fail",
        projectId: "prj_pay",
        step: "draft_section:Definition",
        model: "gemini-4-neon",
        status: "failed",
        tokensIn: 0,
        tokensOut: 0,
        costEstimateUsd: 0,
        error: "Workflow rev_ch1_fail reached spend cap ($2.05 >= $2.00)",
        createdAt: new Date(t2.getTime() + 1000),
      },
      {
        id: "job_mem_ch1",
        workflowId: "crun_ch1_ok",
        projectId: "prj_pay",
        step: "memory_summary_ch1",
        model: "deepseek-flash",
        status: "succeeded",
        tokensIn: 2000,
        tokensOut: 1000,
        costEstimateUsd: 0.001,
        createdAt: new Date(t3.getTime() + 1000),
      },
    ]);

    // 1. Runtime reconciliation recaptures 5 + 7 = 12 credits (973 -> 961) and ignores failed run
    const firstPass = await reconcilePrematurelyRefundedReservations(db, now);
    expect(firstPass.reconciledCount).toBe(2);
    expect(firstPass.totalCreditsRecaptured).toBe(12);
    expect(firstPass.reservationIds).toEqual(["res_ch2_rev_ok", "res_ch1_crun_ok"]);

    const [usrAfter] = await db.select().from(users).where(eq(users.id, "usr_pay"));
    expect(usrAfter?.creditsBalance).toBe(961);

    const [failedRes] = await db
      .select()
      .from(creditReservations)
      .where(eq(creditReservations.id, "res_ch1_rev_fail"));
    expect(failedRes?.status).toBe("refunded");

    // 2. Repeating capture or reconciliation is 100% idempotent (never double-deducts!)
    const repeatCap = await captureChapterReservation(db, "res_ch1_crun_ok", now);
    expect(repeatCap).toEqual({ status: "captured", recaptured: false });
    await ensurePrematureRefundsReconciled(db, now);
    const [usrAfterRepeat] = await db.select().from(users).where(eq(users.id, "usr_pay"));
    expect(usrAfterRepeat?.creditsBalance).toBe(961);
  });

  it("SQL migration 0014 reconciles completed refunded runs atomically and stays idempotent with runtime hook", async () => {
    resetReconciliationIsolateCacheForTests();
    await db.update(users).set({ creditsBalance: 973 }).where(eq(users.id, "usr_pay"));

    const t1 = new Date(now.getTime() + 1000);
    const t2 = new Date(now.getTime() + 2000);
    await db.insert(creditReservations).values([
      {
        id: "res_sql_1",
        userId: "usr_pay",
        projectId: "prj_pay",
        chapterId: null,
        idempotencyKey: "revision:rev_sql_1",
        creditsReserved: 5,
        status: "refunded",
        createdAt: t1,
        settledAt: new Date(t1.getTime() + 500),
      },
      {
        id: "res_sql_2",
        userId: "usr_pay",
        projectId: "prj_pay",
        chapterId: null,
        idempotencyKey: "chapter:crun_sql_2",
        creditsReserved: 7,
        status: "refunded",
        createdAt: t2,
        settledAt: new Date(t2.getTime() + 500),
      },
    ]);
    await db.insert(jobsLog).values([
      {
        id: "job_sql_1",
        workflowId: "rev_sql_1",
        projectId: "prj_pay",
        step: "memory_summary_ch2",
        model: "deepseek-flash",
        status: "succeeded",
        tokensIn: 1000,
        tokensOut: 500,
        costEstimateUsd: 0.001,
        createdAt: new Date(t1.getTime() + 1000),
      },
      {
        id: "job_sql_2",
        workflowId: "crun_sql_2",
        projectId: "prj_pay",
        step: "memory_summary_ch1",
        model: "deepseek-flash",
        status: "succeeded",
        tokensIn: 1000,
        tokensOut: 500,
        costEstimateUsd: 0.001,
        createdAt: new Date(t2.getTime() + 1000),
      },
    ]);

    const sqlPath = path.resolve(process.cwd(), "drizzle/0014_reconcile_premature_refunds.sql");
    const rawSql = fs.readFileSync(sqlPath, "utf8");
    for (const stmt of rawSql.split("--> statement-breakpoint")) {
      const trimmed = stmt.trim();
      if (trimmed) {
        d1Ctx.sqlite.exec(trimmed);
      }
    }

    const [usrAfterSql] = await db.select().from(users).where(eq(users.id, "usr_pay"));
    expect(usrAfterSql?.creditsBalance).toBe(961);

    const ledgerRows = await db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.userId, "usr_pay"));
    expect(ledgerRows.map((r) => [r.creditsDelta, r.balanceAfter])).toEqual([
      [-5, 968],
      [-7, 961],
    ]);

    // Running runtime hook after SQL migration must NOT deduct again
    await ensurePrematureRefundsReconciled(db, now);
    const [usrAfterHook] = await db.select().from(users).where(eq(users.id, "usr_pay"));
    expect(usrAfterHook?.creditsBalance).toBe(961);
  });

  it("blocks payment spoofing (underpayment, currency/user/credit/product mismatch), concurrent double-credit, negative reservations, and refunding captured reservations", async () => {
    // Seed a pending Polar checkout ($25 / 80 credits) for usr_pay
    const { payments } = await import("@/db/schema");
    await db.insert(payments).values({
      id: "pay_pending_guard",
      userId: "usr_pay",
      provider: "polar",
      providerReference: "chk_guard_001",
      currency: "USD",
      amountMinor: 2500,
      creditsGranted: 80,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });

    // 1. Underpayment rejected -> balance stays 0
    await expect(
      grantPaymentCreditsIdempotent(
        db,
        {
          provider: "polar",
          providerReference: "chk_guard_001",
          userId: "usr_pay",
          currency: "USD",
          amountMinor: 100,
          creditsGranted: 80,
          eventType: "order.paid",
        },
        "{}",
        now
      )
    ).rejects.toMatchObject({ code: "PAYMENT_MISMATCH", status: 400 });

    // 2. Currency downgrade rejected -> balance stays 0
    await expect(
      grantPaymentCreditsIdempotent(
        db,
        {
          provider: "polar",
          providerReference: "chk_guard_001",
          userId: "usr_pay",
          currency: "NGN",
          amountMinor: 2500,
          creditsGranted: 80,
          eventType: "order.paid",
        },
        "{}",
        now
      )
    ).rejects.toMatchObject({ code: "PAYMENT_MISMATCH", status: 400 });

    // 3. Inflated credits mismatch rejected -> balance stays 0
    await expect(
      grantPaymentCreditsIdempotent(
        db,
        {
          provider: "polar",
          providerReference: "chk_guard_001",
          userId: "usr_pay",
          currency: "USD",
          amountMinor: 2500,
          creditsGranted: 9999,
          eventType: "order.paid",
        },
        "{}",
        now
      )
    ).rejects.toMatchObject({ code: "PAYMENT_MISMATCH", status: 400 });

    // 4. Polar product_id vs tampered metadata.credits rejected at webhook verification
    const rawKey = new TextEncoder().encode("guard-key-bytes-1234567890123456");
    const secret = `whsec_${Buffer.from(rawKey).toString("base64")}`;
    const ts = String(Math.floor(now.getTime() / 1000));
    const spoofedPolarBody = JSON.stringify({
      type: "order.paid",
      data: {
        id: "ord_spoof",
        checkout_id: "chk_guard_001",
        product_id: "prod_starter",
        total_amount: 1000,
        currency: "usd",
        metadata: { userId: "usr_pay", credits: 180 },
      },
    });
    const sig = await computeHmacBase64("SHA-256", rawKey, `wh_spoof.${ts}.${spoofedPolarBody}`);
    const spoofRes = await verifyPolarWebhook({
      rawBody: spoofedPolarBody,
      webhookId: "wh_spoof",
      webhookTimestamp: ts,
      webhookSignature: `v1,${sig}`,
      webhookSecret: secret,
      polarProductIds: { pack_starter_25: "prod_starter" },
      nowMs: now.getTime(),
    });
    expect(spoofRes.valid).toBe(false);

    // 5. Legitimate Polar discount (subtotal=2500, discount=1000, paid=1500) succeeds EXACTLY ONCE under concurrency
    const validDiscountPayment = {
      provider: "polar" as const,
      providerReference: "chk_guard_001",
      userId: "usr_pay",
      currency: "USD",
      amountMinor: 1500,
      subtotalAmountMinor: 2500,
      creditsGranted: 80,
      eventType: "order.paid",
    };
    const [r1, r2, r3] = await Promise.all([
      grantPaymentCreditsIdempotent(db, validDiscountPayment, "{}", now),
      grantPaymentCreditsIdempotent(db, validDiscountPayment, "{}", now),
      grantPaymentCreditsIdempotent(db, validDiscountPayment, "{}", now),
    ]);
    expect([r1, r2, r3].filter((r) => !r.alreadyProcessed)).toHaveLength(1);
    const [afterGrant] = await db.select().from(users).where(eq(users.id, "usr_pay"));
    expect(afterGrant?.creditsBalance).toBe(80);

    // 6. Negative or zero credit reservation rejected
    await expect(
      reserveChapterCredits(db, {
        userId: "usr_pay",
        projectId: "prj_pay",
        credits: -50,
        idempotencyKey: "neg_attack",
        now,
      })
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT", status: 400 });

    // 7. Already-captured reservation can NEVER be refunded later
    const held = await reserveChapterCredits(db, {
      userId: "usr_pay",
      projectId: "prj_pay",
      credits: 10,
      idempotencyKey: "cap_guard_1",
      now,
    });
    expect(held.balanceAfter).toBe(70);
    await captureChapterReservation(db, held.reservationId, now);

    const badRefund = await refundChapterReservation(db, held.reservationId, "Late error", now);
    expect(badRefund).toEqual({ refunded: false, balanceAfter: 70 });
    const [afterBadRefund] = await db.select().from(users).where(eq(users.id, "usr_pay"));
    expect(afterBadRefund?.creditsBalance).toBe(70);
  });
});
