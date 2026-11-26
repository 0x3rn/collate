import { and, asc, eq, lt } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { auditLog, creditLedger, users } from "@/db/schema";
import {
  handleSignIn,
  handleSignUp,
  handleVerifyEmail,
  type HttpAuthDeps,
} from "@/lib/auth/http-handlers";
import {
  handleAdminBatchCredit,
  handleAdminCircuitBreaker,
  handleAdminManualRefund,
  handleAdminOverview,
  handleCreateCheckout,
  handlePaystackWebhook,
  handlePolarWebhook,
  handleStripeWebhook,
  type BillingHttpDeps,
} from "@/lib/billing/http-handlers";
import { computeHmacBase64, computeHmacHex } from "@/lib/billing/webhooks";
import type { EmailMessage, EmailSender } from "@/lib/email/mailer";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

function createTestMailer() {
  const sent: EmailMessage[] = [];
  const mailer: EmailSender = {
    async send(msg) {
      sent.push(msg);
      return { ok: true, provider: "console", messageId: `m_${sent.length}` };
    },
  };
  return { sent, mailer };
}

function extractToken(text: string): string {
  const match = text.match(/token=([^\s&]+)/);
  if (!match?.[1]) throw new Error("No token");
  return decodeURIComponent(match[1]);
}

describe("Phase 11 — Billing Webhooks, Checkout & Admin Authorization HTTP API", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  let sent: EmailMessage[];
  let authDeps: HttpAuthDeps;
  let adminAlerts: string[];
  const now = new Date("2026-11-23T13:00:00.000Z");

  beforeEach(() => {
    d1Ctx = createInMemoryD1();
    d1Ctx.applyMigrations();
    db = createDb(d1Ctx.d1);
    const mail = createTestMailer();
    sent = mail.sent;
    adminAlerts = [];
    authDeps = {
      db,
      mailer: mail.mailer,
      appUrl: "https://collate.app",
      appEnv: "prod",
      turnstileSecretKey: "test-secret",
      adminNotifier: {
        send: async (text) => {
          adminAlerts.push(text);
          return true;
        },
      },
      nowFn: () => now,
      fetchFn: async () => Response.json({ success: true }),
    };
  });

  afterEach(() => {
    d1Ctx.close();
  });

  async function signUpUser(name: string, email: string, password: string) {
    await handleSignUp(
      new Request("https://collate.app/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://collate.app" },
        body: JSON.stringify({ name, email, password, turnstileToken: "ok", acceptTerms: true }),
      }),
      authDeps
    );
    const tok = extractToken(sent[sent.length - 1]!.text);
    await handleVerifyEmail(
      new Request("https://collate.app/api/auth/verify-email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://collate.app" },
        body: JSON.stringify({ token: tok }),
      }),
      authDeps
    );
    const res = await handleSignIn(
      new Request("https://collate.app/api/auth/signin", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://collate.app" },
        body: JSON.stringify({ email, password, turnstileToken: "ok" }),
      }),
      authDeps
    );
    const json = (await res.json()) as { user: { id: string } };
    return {
      cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
      userId: json.user.id,
    };
  }

  it("initializes Paystack/Stripe checkouts and processes webhooks idempotently with receipts", async () => {
    const student = await signUpUser("Chidi", "chidi.pay@uni.edu.ng", "warm archival cedar wood");

    const deps: BillingHttpDeps = {
      ...authDeps,
      paystackSecretKey: "sk_test_psk",
      stripeSecretKey: "sk_test_str",
      stripeWebhookSecret: "whsec_test_str",
      fetchFn: async (url) => {
        const u = String(url);
        if (u.includes("api.paystack.co")) {
          return Response.json({
            status: true,
            data: { authorization_url: "https://checkout.paystack.com/test", reference: "psk_1" },
          });
        }
        return Response.json({
          id: "cs_test_001",
          url: "https://checkout.stripe.com/c/pay/cs_test_001",
        });
      },
    };

    const pskCheckout = await handleCreateCheckout(
      new Request("https://collate.app/api/billing/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: student.cookie,
        },
        body: JSON.stringify({
          provider: "paystack",
          packId: "pack_starter_25",
          acceptTerms: true,
        }),
      }),
      deps
    );
    expect(pskCheckout.status).toBe(201);

    const strCheckout = await handleCreateCheckout(
      new Request("https://collate.app/api/billing/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: student.cookie,
        },
        body: JSON.stringify({ provider: "stripe", packId: "pack_project_60", acceptTerms: true }),
      }),
      deps
    );
    expect(strCheckout.status).toBe(201);

    // Paystack webhook: bad sig -> 401, valid sig -> 200 (25 credits), replay -> alreadyProcessed
    const pskBody = JSON.stringify({
      event: "charge.success",
      data: {
        reference: "PSK_LIVE_100",
        amount: 750_000,
        currency: "NGN",
        metadata: { userId: student.userId, credits: 25 },
      },
    });
    const badPsk = await handlePaystackWebhook(
      new Request("https://collate.app/api/webhooks/paystack", {
        method: "POST",
        headers: { "x-paystack-signature": "wrong" },
        body: pskBody,
      }),
      deps
    );
    expect(badPsk.status).toBe(401);

    const pskSig = await computeHmacHex("SHA-512", "sk_test_psk", pskBody);
    const okPsk1 = await handlePaystackWebhook(
      new Request("https://collate.app/api/webhooks/paystack", {
        method: "POST",
        headers: { "x-paystack-signature": pskSig },
        body: pskBody,
      }),
      deps
    );
    expect(okPsk1.status).toBe(200);
    expect((await okPsk1.json()) as Record<string, unknown>).toMatchObject({
      alreadyProcessed: false,
      newBalance: 25,
    });

    const okPsk2 = await handlePaystackWebhook(
      new Request("https://collate.app/api/webhooks/paystack", {
        method: "POST",
        headers: { "x-paystack-signature": pskSig },
        body: pskBody,
      }),
      deps
    );
    expect((await okPsk2.json()) as Record<string, unknown>).toMatchObject({
      alreadyProcessed: true,
      newBalance: 25,
    });

    // Stripe webhook adds 100 credits once (matching pack_project_60) -> total 125
    const strBody = JSON.stringify({
      id: "evt_s1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_001",
          amount_total: 3000,
          currency: "usd",
          payment_status: "paid",
          metadata: { userId: student.userId, credits: "100" },
        },
      },
    });
    const ts = Math.floor(now.getTime() / 1000);
    const strSig = await computeHmacHex("SHA-256", "whsec_test_str", `${ts}.${strBody}`);
    const okStr = await handleStripeWebhook(
      new Request("https://collate.app/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": `t=${ts},v1=${strSig}` },
        body: strBody,
      }),
      deps
    );
    expect(okStr.status).toBe(200);
    expect((await okStr.json()) as Record<string, unknown>).toMatchObject({
      alreadyProcessed: false,
      newBalance: 125,
    });
  });

  it("initializes Polar.sh USD checkouts (sandbox & production) and processes order.paid webhooks idempotently", async () => {
    const student = await signUpUser("Ngozi", "ngozi.polar@uni.edu.ng", "quiet library oak shelf");
    const rawSecretBytes = new TextEncoder().encode("polar-api-test-secret-bytes-1234");
    const polarWebhookSecret = `whsec_${Buffer.from(rawSecretBytes).toString("base64")}`;
    const calls: { url: string; body: Record<string, unknown> }[] = [];

    const deps: BillingHttpDeps = {
      ...authDeps,
      polarAccessToken: "polar_oat_test_token",
      polarWebhookSecret,
      polarEnvironment: "sandbox",
      polarProductIds: {
        pack_starter_25: "prod_polar_starter",
        pack_project_60: "prod_polar_project",
      },
      fetchFn: async (url, init) => {
        const u = String(url);
        const parsedBody =
          typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
        calls.push({ url: u, body: parsedBody });
        return Response.json(
          {
            id: "chk_polar_live_001",
            url: "https://sandbox.polar.sh/checkout/chk_polar_live_001",
            status: "open",
          },
          { status: 201 }
        );
      },
    };

    // Unconfigured pack returns masked 503 cleanly (never leaks Polar/Stripe/Paystack or "not configured")
    const missingPack = await handleCreateCheckout(
      new Request("https://collate.app/api/billing/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: student.cookie,
        },
        body: JSON.stringify({ provider: "polar", packId: "pack_thesis_150", acceptTerms: true }),
      }),
      deps
    );
    expect(missingPack.status).toBe(503);
    const missingPackJson = (await missingPack.json()) as { ok: boolean; error: string };
    expect(missingPackJson.ok).toBe(false);
    expect(missingPackJson.error).not.toMatch(/polar|paystack|stripe|not configured|product/i);

    // Configured pack creates Polar sandbox checkout session
    const polarCheckout = await handleCreateCheckout(
      new Request("https://collate.app/api/billing/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: student.cookie,
        },
        body: JSON.stringify({ provider: "polar", packId: "pack_project_60", acceptTerms: true }),
      }),
      deps
    );
    expect(polarCheckout.status).toBe(201);
    expect((await polarCheckout.json()) as Record<string, unknown>).toEqual({
      ok: true,
      provider: "polar",
      reference: "chk_polar_live_001",
      checkoutUrl: "https://sandbox.polar.sh/checkout/chk_polar_live_001",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://sandbox-api.polar.sh/v1/checkouts/");
    expect(calls[0]!.body).toMatchObject({
      products: ["prod_polar_project"],
      customer_email: "ngozi.polar@uni.edu.ng",
      external_customer_id: student.userId,
      metadata: {
        userId: student.userId,
        credits: 100,
        packId: "pack_project_60",
      },
    });

    // Invalid Polar signature -> 401
    const ts = String(Math.floor(now.getTime() / 1000));
    const paidBody = JSON.stringify({
      type: "order.paid",
      data: {
        id: "ord_polar_live_001",
        checkout_id: "chk_polar_live_001",
        paid: true,
        total_amount: 3000,
        currency: "usd",
        customer: { external_id: student.userId, email: "ngozi.polar@uni.edu.ng" },
        metadata: { userId: student.userId, credits: 100, packId: "pack_project_60" },
      },
    });
    const badSigRes = await handlePolarWebhook(
      new Request("https://collate.app/api/webhooks/polar", {
        method: "POST",
        headers: {
          "webhook-id": "wh_1",
          "webhook-timestamp": ts,
          "webhook-signature": "v1,badSignature==",
        },
        body: paidBody,
      }),
      deps
    );
    expect(badSigRes.status).toBe(401);

    // Valid order.paid grants 100 credits and dispatches 1 receipt email
    const emailsBefore = sent.length;
    const validSig = await computeHmacBase64("SHA-256", rawSecretBytes, `wh_1.${ts}.${paidBody}`);
    const okPolar1 = await handlePolarWebhook(
      new Request("https://collate.app/api/webhooks/polar", {
        method: "POST",
        headers: {
          "webhook-id": "wh_1",
          "webhook-timestamp": ts,
          "webhook-signature": `v1,${validSig}`,
        },
        body: paidBody,
      }),
      deps
    );
    expect(okPolar1.status).toBe(200);
    expect((await okPolar1.json()) as Record<string, unknown>).toMatchObject({
      ok: true,
      alreadyProcessed: false,
      newBalance: 100,
    });
    expect(sent.length).toBe(emailsBefore + 1);
    // The owner gets one Telegram alert, with the customer's email masked.
    const paymentAlerts = adminAlerts.filter((a) => a.includes("Payment received"));
    expect(paymentAlerts).toHaveLength(1);
    expect(paymentAlerts[0]).toContain("USD 30.00");
    expect(paymentAlerts[0]).toContain("100 credits via Polar");
    expect(paymentAlerts[0]).toContain("Ngozi (ng***@uni.edu.ng)");
    expect(paymentAlerts[0]).not.toContain("ngozi.polar@");

    // Replay does NOT double-credit or send another receipt
    const okPolar2 = await handlePolarWebhook(
      new Request("https://collate.app/api/webhooks/polar", {
        method: "POST",
        headers: {
          "webhook-id": "wh_1",
          "webhook-timestamp": ts,
          "webhook-signature": `v1,${validSig}`,
        },
        body: paidBody,
      }),
      deps
    );
    expect(okPolar2.status).toBe(200);
    expect((await okPolar2.json()) as Record<string, unknown>).toMatchObject({
      ok: true,
      alreadyProcessed: true,
      newBalance: 100,
    });
    expect(sent.length).toBe(emailsBefore + 1);
    expect(adminAlerts.filter((a) => a.includes("Payment received"))).toHaveLength(1);
  });

  it("alerts the owner once per new sign-up, with a masked email and the account total", async () => {
    await signUpUser("Ada Obi", "ada.obi@uni.edu.ng", "quiet library oak shelf");
    await signUpUser("Tunde", "tunde@uni.edu.ng", "warm archival cedar wood");
    const signups = adminAlerts.filter((a) => a.includes("New sign-up"));
    expect(signups).toHaveLength(2);
    expect(signups[0]).toContain("Ada Obi (ad***@uni.edu.ng)");
    expect(signups[0]).toContain("Total accounts: 1");
    expect(signups[1]).toContain("Total accounts: 2");
    expect(signups.join("\n")).not.toContain("ada.obi@");
  });

  it("enforces admin role boundary (403 for normal users, 200 for allowlisted admin)", async () => {
    const admin = await signUpUser("Admin", "ops@collate.app", "quiet granite server room");
    const regular = await signUpUser("Student", "student@uni.edu", "steady coastal wooden desk");

    const deps: BillingHttpDeps = {
      ...authDeps,
      adminEmails: "ops@collate.app",
    };

    const deniedOverview = await handleAdminOverview(
      new Request("https://collate.app/api/admin/overview", {
        headers: { cookie: regular.cookie },
      }),
      deps
    );
    expect(deniedOverview.status).toBe(403);

    const deniedRefund = await handleAdminManualRefund(
      new Request("https://collate.app/api/admin/refund", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: regular.cookie,
        },
        body: JSON.stringify({ targetUserId: regular.userId, credits: 50, reason: "Self grant" }),
      }),
      deps
    );
    expect(deniedRefund.status).toBe(403);

    const okOverview = await handleAdminOverview(
      new Request("https://collate.app/api/admin/overview", { headers: { cookie: admin.cookie } }),
      deps
    );
    expect(okOverview.status).toBe(200);

    const okRefund = await handleAdminManualRefund(
      new Request("https://collate.app/api/admin/refund", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          targetUserId: regular.userId,
          credits: 15,
          reason: "Refund for interrupted chapter",
        }),
      }),
      deps
    );
    expect(okRefund.status).toBe(200);
    expect((await okRefund.json()) as Record<string, unknown>).toMatchObject({ balanceAfter: 15 });

    // Deducting: partial, then clamped at zero, then nothing left. Idempotent by key.
    const adjust = (cookie: string, body: Record<string, unknown>) =>
      handleAdminManualRefund(
        new Request("https://collate.app/api/admin/refund", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://collate.app",
            cookie,
          },
          body: JSON.stringify({ targetUserId: regular.userId, ...body }),
        }),
        deps
      );
    const deniedDeduct = await adjust(regular.cookie, {
      mode: "deduct",
      credits: 5,
      reason: "Self deduct attempt",
    });
    expect(deniedDeduct.status).toBe(403);

    const partial = await adjust(admin.cookie, {
      mode: "deduct",
      credits: 5,
      reason: "Polar refund for order 123",
      idempotencyKey: "ded_test_1",
    });
    expect(partial.status).toBe(200);
    expect(await partial.json()).toMatchObject({ deducted: 5, balanceAfter: 10 });

    const replay = await adjust(admin.cookie, {
      mode: "deduct",
      credits: 5,
      reason: "Polar refund for order 123",
      idempotencyKey: "ded_test_1",
    });
    expect(await replay.json()).toMatchObject({ alreadyProcessed: true, balanceAfter: 10 });

    const clamped = await adjust(admin.cookie, {
      mode: "deduct",
      credits: 50,
      reason: "Chargeback on Paystack",
    });
    expect(await clamped.json()).toMatchObject({ deducted: 10, balanceAfter: 0 });

    const empty = await adjust(admin.cookie, {
      mode: "deduct",
      credits: 1,
      reason: "Nothing left to take",
    });
    expect(empty.status).toBe(409);

    const tooMuchGrant = await adjust(admin.cookie, {
      credits: 5000,
      reason: "Grant above the cap",
    });
    expect(tooMuchGrant.status).toBe(400);

    const [regularRow] = await db
      .select({ creditsBalance: users.creditsBalance })
      .from(users)
      .where(eq(users.id, regular.userId));
    expect(regularRow?.creditsBalance).toBe(0);
    const deductions = await db
      .select()
      .from(creditLedger)
      .where(and(eq(creditLedger.userId, regular.userId), lt(creditLedger.creditsDelta, 0)));
    expect(deductions.map((d) => d.creditsDelta).sort()).toEqual([-10, -5]);
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "admin.manual_credit_deduction"));
    expect(audits).toHaveLength(2);

    // Put the balance back for the rest of this test.
    await adjust(admin.cookie, { credits: 15, reason: "Restore after deduction checks" });

    const okPause = await handleAdminCircuitBreaker(
      new Request("https://collate.app/api/admin/circuit-breaker", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: admin.cookie,
        },
        body: JSON.stringify({ paused: true, reason: "Spend cap drill" }),
      }),
      deps
    );
    expect(okPause.status).toBe(200);
  });

  it("credits all users in cursor-paginated idempotent batches and supports random subsets with admin auth guard", async () => {
    const admin = await signUpUser("Admin", "ops@collate.app", "quiet stone harbor lantern");
    const u1 = await signUpUser("Student 1", "s1@uni.edu", "amber paper quiet desk");
    const u2 = await signUpUser("Student 2", "s2@uni.edu", "silver cedar library oak");
    const u3 = await signUpUser("Student 3", "s3@uni.edu", "autumn glass ink journal");
    const u4 = await signUpUser("Student 4", "s4@uni.edu", "winter birch study lamp");
    const deps: BillingHttpDeps = { ...authDeps, adminEmails: "ops@collate.app" };

    // 1. Unauthenticated -> 401
    const unauth = await handleAdminBatchCredit(
      new Request("https://collate.app/api/admin/credit-batch", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://collate.app" },
        body: JSON.stringify({
          campaignId: "outage_nov_24",
          credits: 10,
          reason: "Outage goodwill credit",
        }),
      }),
      deps
    );
    expect(unauth.status).toBe(401);

    // 2. Non-admin -> 403
    const forbidden = await handleAdminBatchCredit(
      new Request("https://collate.app/api/admin/credit-batch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: u1.cookie,
        },
        body: JSON.stringify({
          campaignId: "outage_nov_24",
          credits: 10,
          reason: "Outage goodwill credit",
        }),
      }),
      deps
    );
    expect(forbidden.status).toBe(403);

    // 3. Invalid payload -> 400
    const badReq = await handleAdminBatchCredit(
      new Request("https://collate.app/api/admin/credit-batch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          campaignId: "bad id!",
          credits: 0,
          reason: "x",
        }),
      }),
      deps
    );
    expect(badReq.status).toBe(400);

    // 4. Cursor-paginated "all" mode across 5 users with batchSize=2 -> 3 batches (2 + 2 + 1)
    let cursor: string | null = null;
    let batches = 0;
    let totalCredited = 0;
    for (;;) {
      const res = await handleAdminBatchCredit(
        new Request("https://collate.app/api/admin/credit-batch", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://collate.app",
            cookie: admin.cookie,
          },
          body: JSON.stringify({
            campaignId: "outage_nov_24",
            credits: 12,
            reason: "Service outage compensation",
            mode: "all",
            batchSize: 2,
            cursorUserId: cursor,
          }),
        }),
        deps
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        ok: boolean;
        creditedInBatch: number;
        skippedInBatch: number;
        totalUsers: number;
        nextCursorUserId: string | null;
        done: boolean;
      };
      expect(data.ok).toBe(true);
      expect(data.totalUsers).toBe(5);
      batches += 1;
      totalCredited += data.creditedInBatch;
      cursor = data.nextCursorUserId;
      if (data.done) break;
    }

    expect(batches).toBe(3);
    expect(totalCredited).toBe(5);

    const allAfter = await db.select().from(users).orderBy(asc(users.id));
    expect(allAfter.map((u) => u.creditsBalance)).toEqual([12, 12, 12, 12, 12]);

    // 5. Replaying the exact same campaignId must credit 0 users (100% idempotent)
    const replayRes = await handleAdminBatchCredit(
      new Request("https://collate.app/api/admin/credit-batch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          campaignId: "outage_nov_24",
          credits: 12,
          reason: "Duplicate retry",
          mode: "all",
          batchSize: 50,
        }),
      }),
      deps
    );
    expect(replayRes.status).toBe(200);
    const replayJson = (await replayRes.json()) as {
      creditedInBatch: number;
      skippedInBatch: number;
    };
    expect(replayJson.creditedInBatch).toBe(0);
    expect(replayJson.skippedInBatch).toBe(5);

    // 6. Random subset mode credits exactly 2 distinct random users (+5 each)
    const sampleRes = await handleAdminBatchCredit(
      new Request("https://collate.app/api/admin/credit-batch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: admin.cookie,
        },
        body: JSON.stringify({
          campaignId: "promo_random_2",
          credits: 5,
          reason: "Random promotional credit giveaway",
          mode: "random_sample",
          batchSize: 50,
          remainingTargetCount: 2,
        }),
      }),
      deps
    );
    expect(sampleRes.status).toBe(200);
    const sampleJson = (await sampleRes.json()) as { creditedInBatch: number; done: boolean };
    expect(sampleJson.creditedInBatch).toBe(2);
    expect(sampleJson.done).toBe(true);

    const allAfterSample = await db.select().from(users);
    const winners = allAfterSample.filter((u) => u.creditsBalance === 17);
    expect(winners).toHaveLength(2);
    expect([u1.userId, u2.userId, u3.userId, u4.userId, admin.userId]).toContain(winners[0]!.id);
  });
});
