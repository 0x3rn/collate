import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { creditLedger, paymentReversals, payments, users } from "@/db/schema";
import { createProjectForUser } from "@/db/queries/projects";
import { grantPaymentCreditsIdempotent, reserveChapterCredits } from "@/lib/billing/ledger";
import {
  applyPaymentReversal,
  getBillingHold,
  HOLD_REASONS,
  liftBillingHold,
  resolveDispute,
} from "@/lib/billing/reversals";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

describe("refunds and disputes take credits back", () => {
  let d1: InMemoryD1Context;
  let db: AppDb;
  let alerts: string[];
  const notifier = { send: async (t: string) => (alerts.push(t), true) };

  beforeEach(() => {
    d1 = createInMemoryD1();
    d1.applyMigrations();
    db = createDb(d1.d1);
    alerts = [];
  });
  afterEach(() => d1.close());

  async function buyer(id: string, provider: "paystack" | "polar", ref: string, orderId?: string) {
    const now = new Date("2026-11-20T10:00:00Z");
    await db.insert(users).values({
      id,
      email: `${id}@uni.edu.ng`,
      emailVerified: true,
      name: "Ada",
      createdAt: now,
      updatedAt: now,
    });
    const raw = JSON.stringify(
      provider === "polar"
        ? { type: "order.paid", data: { id: orderId, checkout_id: ref } }
        : { event: "charge.success", data: { reference: ref } }
    );
    await grantPaymentCreditsIdempotent(
      db,
      {
        provider,
        providerReference: ref,
        userId: id,
        currency: provider === "polar" ? "USD" : "NGN",
        amountMinor: provider === "polar" ? 3000 : 3_500_000,
        creditsGranted: 100,
        eventType: provider === "polar" ? "order.paid" : "charge.success",
      },
      raw,
      now
    );
  }
  const balance = async (id: string) =>
    (await db.select().from(users).where(eq(users.id, id)))[0]!.creditsBalance;
  const spend = (id: string, credits: number) =>
    db
      .update(users)
      .set({ creditsBalance: 100 - credits })
      .where(eq(users.id, id));

  it("takes back all credits on a full refund before use, with no hold", async () => {
    await buyer("u1", "paystack", "psk_1");
    const r = await applyPaymentReversal(
      db,
      {
        provider: "paystack",
        kind: "refund",
        providerReversalId: "rf_1",
        payment: { providerReference: "psk_1" },
        amountMinor: 3_500_000,
        currency: "NGN",
        status: "processed",
      },
      { notifier }
    );
    expect(r).toMatchObject({
      outcome: "applied",
      creditsRemoved: 100,
      creditsShort: 0,
      holdPlaced: false,
    });
    expect(await balance("u1")).toBe(0);
    expect(await getBillingHold(db, "u1")).toBeNull();
    const [p] = await db.select().from(payments);
    expect(p?.status).toBe("refunded");
    const [entry] = await db.select().from(creditLedger).where(eq(creditLedger.creditsDelta, -100));
    expect(entry?.entryType).toBe("manual_adjustment");
    expect(entry?.note).toBe("Payment refund (paystack psk_1)");
    expect(alerts[0]).toContain("Payment refunded");
  });

  it("puts the account on hold when refunded credits were already used", async () => {
    await buyer("u2", "paystack", "psk_2");
    await spend("u2", 70); // 30 left
    const r = await applyPaymentReversal(db, {
      provider: "paystack",
      kind: "refund",
      providerReversalId: "rf_2",
      payment: { providerReference: "psk_2" },
      amountMinor: 3_500_000,
      currency: "NGN",
      status: "processed",
    });
    expect(r).toMatchObject({ creditsRemoved: 30, creditsShort: 70, holdPlaced: true });
    expect(await balance("u2")).toBe(0);
    expect((await getBillingHold(db, "u2"))?.reason).toBe(HOLD_REASONS.refundAfterUse);
  });

  it("takes back a proportional share on a partial refund, once per event", async () => {
    await buyer("u3", "paystack", "psk_3");
    const ev = {
      provider: "paystack" as const,
      kind: "refund" as const,
      providerReversalId: "rf_3",
      payment: { providerReference: "psk_3" },
      amountMinor: 1_750_000,
      currency: "NGN",
      status: "processed",
    };
    expect(await applyPaymentReversal(db, ev)).toMatchObject({ creditsRemoved: 50 });
    expect(await applyPaymentReversal(db, ev)).toMatchObject({ outcome: "updated" });
    expect(await balance("u3")).toBe(50);
    const [p] = await db.select().from(payments);
    expect(p?.status).toBe("succeeded");
  });

  it("matches Polar refunds by order id, even for payments saved before the new column", async () => {
    await buyer("u4", "polar", "chk_4", "ord_4");
    const r = await applyPaymentReversal(db, {
      provider: "polar",
      kind: "refund",
      providerReversalId: "ref_4",
      payment: { providerOrderId: "ord_4" },
      amountMinor: 3000,
      currency: "usd",
      status: "succeeded",
    });
    expect(r).toMatchObject({ outcome: "applied", creditsRemoved: 100 });
  });

  it("holds the account during a dispute and gives credits back if we win", async () => {
    await buyer("u5", "paystack", "psk_5");
    await spend("u5", 40); // 60 left
    const opened = await applyPaymentReversal(
      db,
      {
        provider: "paystack",
        kind: "dispute",
        providerReversalId: "358950",
        payment: { providerReference: "psk_5" },
        amountMinor: 3_500_000,
        currency: "NGN",
        status: "awaiting-merchant-feedback",
        dueAt: new Date("2026-11-25T18:00:00Z"),
      },
      { notifier }
    );
    expect(opened).toMatchObject({ creditsRemoved: 60, creditsShort: 40, holdPlaced: true });
    expect((await getBillingHold(db, "u5"))?.reason).toBe(HOLD_REASONS.dispute);
    expect(alerts[0]).toContain("Payment dispute opened");
    expect(alerts[0]).toContain("Respond by");

    const won = await resolveDispute(
      db,
      { provider: "paystack", providerDisputeId: "358950", result: "won", status: "declined" },
      { notifier }
    );
    expect(won).toEqual({ outcome: "resolved", creditsReturned: 60 });
    expect(await balance("u5")).toBe(60);
    expect(await getBillingHold(db, "u5")).toBeNull();
    const again = await resolveDispute(db, {
      provider: "paystack",
      providerDisputeId: "358950",
      result: "won",
      status: "declined",
    });
    expect(again.outcome).toBe("already_resolved");
    expect(await balance("u5")).toBe(60);
  });

  it("keeps credits removed and the hold in place if we lose, until an admin lifts it", async () => {
    await buyer("u6", "paystack", "psk_6");
    await applyPaymentReversal(db, {
      provider: "paystack",
      kind: "dispute",
      providerReversalId: "d6",
      payment: { providerReference: "psk_6" },
      amountMinor: 3_500_000,
      currency: "NGN",
      status: "awaiting-merchant-feedback",
    });
    await resolveDispute(db, {
      provider: "paystack",
      providerDisputeId: "d6",
      result: "lost",
      status: "merchant-accepted",
    });
    expect(await balance("u6")).toBe(0);
    expect(await getBillingHold(db, "u6")).not.toBeNull();
    expect(
      await liftBillingHold(db, { adminUserId: "u6", userId: "u6", note: "Settled by email" })
    ).toBe(true);
    expect(await getBillingHold(db, "u6")).toBeNull();
  });

  it("never counts the same payment twice (dispute, then a refund to settle it)", async () => {
    await buyer("u7", "polar", "chk_7", "ord_7");
    await applyPaymentReversal(db, {
      provider: "polar",
      kind: "dispute",
      providerReversalId: "dsp_7",
      payment: { providerOrderId: "ord_7" },
      amountMinor: 3000,
      currency: "USD",
      status: "needs_response",
    });
    const refund = await applyPaymentReversal(db, {
      provider: "polar",
      kind: "refund",
      providerReversalId: "ref_7",
      payment: { providerOrderId: "ord_7" },
      amountMinor: 3000,
      currency: "USD",
      status: "succeeded",
      reason: "dispute_prevention",
    });
    expect(refund).toMatchObject({ creditsTarget: 0, creditsRemoved: 0 });
    const rows = await db.select().from(paymentReversals);
    expect(rows.reduce((n, r) => n + r.creditsTarget, 0)).toBe(100);
  });

  it("blocks spending while on hold, and allows it again once lifted", async () => {
    await buyer("u8", "paystack", "psk_8");
    await createProjectForUser(db, {
      id: "prj_8",
      userId: "u8",
      type: "project",
      title: "Topic",
      now: new Date(),
    });
    await applyPaymentReversal(db, {
      provider: "paystack",
      kind: "dispute",
      providerReversalId: "d8",
      payment: { providerReference: "psk_8" },
      amountMinor: 1_750_000, // half the payment, so 50 credits stay
      currency: "NGN",
      status: "awaiting-merchant-feedback",
    });
    expect(await balance("u8")).toBe(50);
    const spend = () =>
      reserveChapterCredits(db, {
        userId: "u8",
        projectId: "prj_8",
        credits: 10,
        idempotencyKey: `res_${Math.random()}`,
      });
    await expect(spend()).rejects.toMatchObject({ code: "ACCOUNT_ON_HOLD", status: 403 });
    expect(await balance("u8")).toBe(50);
    await liftBillingHold(db, { adminUserId: "u8", userId: "u8", note: "Resolved" });
    await expect(spend()).resolves.toMatchObject({ balanceAfter: 40 });
  });

  it("ignores refunds for payments it does not know", async () => {
    expect(
      await applyPaymentReversal(db, {
        provider: "paystack",
        kind: "refund",
        providerReversalId: "x",
        payment: { providerReference: "unknown" },
        amountMinor: 100,
        currency: "NGN",
        status: "processed",
      })
    ).toEqual({ outcome: "payment_not_found" });
  });
});
