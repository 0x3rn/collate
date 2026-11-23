import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import {
  handleSignIn,
  handleSignUp,
  handleVerifyEmail,
  type HttpAuthDeps,
} from "@/lib/auth/http-handlers";
import {
  handleAdminCircuitBreaker,
  handleAdminManualRefund,
  handleAdminOverview,
  handleCreateCheckout,
  handlePaystackWebhook,
  handleStripeWebhook,
  type BillingHttpDeps,
} from "@/lib/billing/http-handlers";
import { computeHmacHex } from "@/lib/billing/webhooks";
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
  const now = new Date("2026-11-23T13:00:00.000Z");

  beforeEach(() => {
    d1Ctx = createInMemoryD1();
    d1Ctx.applyMigrations();
    db = createDb(d1Ctx.d1);
    const mail = createTestMailer();
    sent = mail.sent;
    authDeps = {
      db,
      mailer: mail.mailer,
      appUrl: "https://collate.app",
      appEnv: "prod",
      turnstileSecretKey: "test-secret",
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
        body: JSON.stringify({ name, email, password, turnstileToken: "ok" }),
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
        body: JSON.stringify({ provider: "paystack", packId: "pack_starter_25" }),
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
        body: JSON.stringify({ provider: "stripe", packId: "pack_project_60" }),
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

    // Stripe webhook adds 60 credits once -> total 85
    const strBody = JSON.stringify({
      id: "evt_s1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_001",
          amount_total: 1400,
          currency: "usd",
          payment_status: "paid",
          metadata: { userId: student.userId, credits: "60" },
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
      newBalance: 85,
    });
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
});
