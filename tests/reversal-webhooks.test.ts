import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { paymentReversals, payments, users } from "@/db/schema";
import {
  type BillingHttpDeps,
  handlePaystackWebhook,
  handlePolarWebhook,
} from "@/lib/billing/http-handlers";
import { grantPaymentCreditsIdempotent } from "@/lib/billing/ledger";
import { computeHmacBase64, computeHmacHex } from "@/lib/billing/webhooks";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

/** Signed refund and dispute webhooks from Paystack and Polar, end to end. */

const PSK_SECRET = "sk_test_psk";
const polarRaw = new TextEncoder().encode("polar-api-test-secret-bytes-1234");
const POLAR_SECRET = `whsec_${Buffer.from(polarRaw).toString("base64")}`;
const now = new Date("2026-11-26T10:00:00Z");

describe("refund and dispute webhooks", () => {
  let d1: InMemoryD1Context;
  let db: AppDb;
  let alerts: string[];
  let deps: BillingHttpDeps;

  beforeEach(async () => {
    d1 = createInMemoryD1();
    d1.applyMigrations();
    db = createDb(d1.d1);
    alerts = [];
    deps = {
      db,
      mailer: { send: async () => ({ ok: true, provider: "console" }) },
      appUrl: "https://collateresearch.app",
      appEnv: "prod",
      paystackSecretKey: PSK_SECRET,
      polarWebhookSecret: POLAR_SECRET,
      adminNotifier: { send: async (t) => (alerts.push(t), true) },
      nowFn: () => now,
    };
    await db.insert(users).values({
      id: "usr_ada",
      email: "ada@uni.edu.ng",
      emailVerified: true,
      name: "Ada",
      createdAt: now,
      updatedAt: now,
    });
    await grantPaymentCreditsIdempotent(
      db,
      {
        provider: "paystack",
        providerReference: "psk_ref_1",
        userId: "usr_ada",
        currency: "NGN",
        amountMinor: 3_500_000,
        creditsGranted: 100,
        eventType: "charge.success",
      },
      "{}",
      now
    );
    await grantPaymentCreditsIdempotent(
      db,
      {
        provider: "polar",
        providerReference: "chk_1",
        providerOrderId: "ord_1",
        userId: "usr_ada",
        currency: "USD",
        amountMinor: 3000,
        creditsGranted: 100,
        eventType: "order.paid",
      },
      "{}",
      now
    );
  });
  afterEach(() => d1.close());

  const balance = async () => (await db.select().from(users).where(eq(users.id, "usr_ada")))[0]!;

  async function paystack(body: unknown, signature?: string) {
    const raw = JSON.stringify(body);
    return handlePaystackWebhook(
      new Request("https://collateresearch.app/api/webhooks/paystack", {
        method: "POST",
        headers: {
          "x-paystack-signature": signature ?? (await computeHmacHex("SHA-512", PSK_SECRET, raw)),
        },
        body: raw,
      }),
      deps
    );
  }

  async function polar(body: unknown, id: string) {
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(now.getTime() / 1000));
    const sig = await computeHmacBase64("SHA-256", polarRaw, `${id}.${ts}.${raw}`);
    return handlePolarWebhook(
      new Request("https://collateresearch.app/api/webhooks/polar", {
        method: "POST",
        headers: { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` },
        body: raw,
      }),
      deps
    );
  }

  it("refuses unsigned refund events", async () => {
    const res = await paystack(
      {
        event: "refund.processed",
        data: { transaction_reference: "psk_ref_1", amount: "3500000" },
      },
      "forged"
    );
    expect(res.status).toBe(401);
    expect((await balance()).creditsBalance).toBe(200);
  });

  it("takes credits back on a Paystack refund (amount sent as a kobo string)", async () => {
    const res = await paystack({
      event: "refund.processed",
      data: {
        status: "processed",
        transaction_reference: "psk_ref_1",
        refund_reference: "132013318360",
        amount: "3500000",
        currency: "NGN",
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "applied", creditsRemoved: 100 });
    expect((await balance()).creditsBalance).toBe(100);
    // Pending refunds change nothing.
    const pending = await paystack({
      event: "refund.pending",
      data: { status: "pending", transaction_reference: "psk_ref_1", amount: "3500000" },
    });
    expect(await pending.json()).toMatchObject({ ignored: true });
  });

  it("holds the account on a Paystack chargeback and lifts it when we win", async () => {
    const dispute = {
      id: 358950,
      refund_amount: 3_500_000,
      currency: "NGN",
      status: "awaiting-merchant-feedback",
      resolution: null,
      transaction: { reference: "psk_ref_1", amount: 3_500_000 },
      category: "chargeback",
      messages: [{ body: "Customer complained about debit without value" }],
      dueAt: "2026-11-28T18:00:00.000Z",
    };
    const opened = await paystack({ event: "charge.dispute.create", data: dispute });
    expect(await opened.json()).toMatchObject({ outcome: "applied", holdPlaced: true });
    let u = await balance();
    expect(u.creditsBalance).toBe(100);
    expect(u.billingHoldReason).toContain("dispute");
    const [rev] = await db.select().from(paymentReversals);
    expect(rev?.dueAt?.toISOString()).toBe("2026-11-28T18:00:00.000Z");
    expect(rev?.reason).toBe("chargeback: Customer complained about debit without value");

    const reminder = await paystack({ event: "charge.dispute.remind", data: dispute });
    expect(await reminder.json()).toMatchObject({ outcome: "updated" });

    const resolved = await paystack({
      event: "charge.dispute.resolve",
      data: { ...dispute, status: "resolved", resolution: "declined" },
    });
    expect(await resolved.json()).toMatchObject({ outcome: "resolved", creditsReturned: 100 });
    u = await balance();
    expect(u.creditsBalance).toBe(200);
    expect(u.billingHoldReason).toBeNull();
  });

  it("records a lost dispute even if the opening event was missed", async () => {
    const res = await paystack({
      event: "charge.dispute.resolve",
      data: {
        id: 9,
        refund_amount: 3_500_000,
        currency: "NGN",
        status: "resolved",
        resolution: "auto-accepted",
        transaction: { reference: "psk_ref_1", amount: 3_500_000 },
      },
    });
    expect(await res.json()).toMatchObject({ outcome: "resolved" });
    const u = await balance();
    expect(u.creditsBalance).toBe(100);
    expect(u.billingHoldReason).not.toBeNull();
  });

  it("takes credits back when a Polar refund succeeds, not before", async () => {
    const refund = {
      id: "ref_1",
      order_id: "ord_1",
      amount: 2800,
      tax_amount: 200,
      currency: "usd",
      reason: "customer_request",
    };
    const pending = await polar(
      { type: "refund.created", data: { ...refund, status: "pending" } },
      "wh_a"
    );
    expect(await pending.json()).toMatchObject({ ignored: true });
    expect((await balance()).creditsBalance).toBe(200);

    const done = await polar(
      { type: "refund.updated", data: { ...refund, status: "succeeded" } },
      "wh_b"
    );
    expect(await done.json()).toMatchObject({ outcome: "applied", creditsRemoved: 100 });
    expect((await balance()).creditsBalance).toBe(100);
    const [p] = await db.select().from(payments).where(eq(payments.providerOrderId, "ord_1"));
    expect(p?.status).toBe("refunded");
    expect(alerts.some((a) => a.includes("Payment refunded"))).toBe(true);
  });
});
