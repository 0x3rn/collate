import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { auditLog, payments, retainedBillingRecords, users } from "@/db/schema";
import { handleDeleteAccount } from "@/lib/account/delete-account";
import { purgeExpiredRecords } from "@/lib/account/retention";
import {
  handleSignIn,
  handleSignUp,
  handleVerifyCode,
  type HttpAuthDeps,
} from "@/lib/auth/http-handlers";
import { loadAdminPayments } from "@/lib/billing/admin-payments";
import { renderEvidenceHtml } from "@/lib/billing/evidence-pdf";
import { buildDisputeEvidence } from "@/lib/billing/evidence-report";
import { grantPaymentCreditsIdempotent } from "@/lib/billing/ledger";
import { applyPaymentReversal, resolveDispute } from "@/lib/billing/reversals";
import type { EmailMessage } from "@/lib/email/mailer";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

const APP = "https://collateresearch.app";
const IP = "102.89.34.10";
const PASSWORD = "quiet library oak shelf";
const days = (from: Date, n: number) => new Date(from.getTime() + n * 86_400_000);

describe("deleting an account keeps the payment record and nothing else identifying", () => {
  let d1: InMemoryD1Context;
  let db: AppDb;
  let sent: EmailMessage[];
  let deps: HttpAuthDeps;

  beforeEach(() => {
    d1 = createInMemoryD1();
    d1.applyMigrations();
    db = createDb(d1.d1);
    sent = [];
    deps = {
      db,
      mailer: { send: async (m) => (sent.push(m), { ok: true, provider: "console" }) },
      appUrl: APP,
      appEnv: "prod",
      turnstileSecretKey: "t",
      fetchFn: (async () => Response.json({ success: true })) as typeof fetch,
    };
  });
  afterEach(() => d1.close());

  const req = (path: string, body: unknown, cookie = "") =>
    new Request(`${APP}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP, cookie, "cf-connecting-ip": IP },
      body: JSON.stringify(body),
    });

  async function buyer(email = "gone@uni.edu.ng") {
    await handleSignUp(
      req("/api/auth/signup", {
        name: "Gone Soon",
        email,
        password: PASSWORD,
        turnstileToken: "x",
        acceptTerms: true,
      }),
      deps
    );
    const code = sent.at(-1)!.text.match(/\b(\d{6})\b/)![1]!;
    await handleVerifyCode(req("/api/auth/verify-code", { email, code }), deps);
    const res = await handleSignIn(
      req("/api/auth/signin", { email, password: PASSWORD, turnstileToken: "x" }),
      deps
    );
    const userId = ((await res.json()) as { user: { id: string } }).user.id;
    return { userId, cookie: res.headers.get("set-cookie")!.split(";")[0]! };
  }

  const pay = (userId: string, reference = "psk_gone") =>
    grantPaymentCreditsIdempotent(
      db,
      {
        provider: "paystack",
        providerReference: reference,
        userId,
        currency: "NGN",
        amountMinor: 3_500_000,
        creditsGranted: 100,
        eventType: "charge.success",
      },
      JSON.stringify({ data: { authorization: { last4: "4081" } } })
    );

  const remove = (cookie: string) =>
    handleDeleteAccount(
      req("/api/account/delete", { password: PASSWORD, confirmation: "DELETE MY ACCOUNT" }, cookie),
      deps
    );

  it("keeps the record, strips activity logs, and still serves the record and search", async () => {
    const a = await buyer();
    const { paymentId } = await pay(a.userId);
    expect((await remove(a.cookie)).status).toBe(200);

    expect(await db.select().from(users).where(eq(users.id, a.userId))).toEqual([]);
    expect(await db.select().from(payments)).toEqual([]);
    const [kept] = await db.select().from(retainedBillingRecords);
    expect(kept).toMatchObject({
      paymentId,
      customerEmail: "gone@uni.edu.ng",
      providerReference: "psk_gone",
      amountMinor: 3_500_000,
      credits: 100,
      openDispute: false,
    });

    // No log row still points at the person or carries their IP address.
    const logs = await db.select().from(auditLog);
    expect(logs.length).toBeGreaterThan(1);
    expect(logs.filter((l) => l.entityId === a.userId || l.actorUserId === a.userId)).toEqual([]);
    expect(logs.filter((l) => l.metadataJson?.includes(IP))).toEqual([]);

    const record = (await buildDisputeEvidence(db, paymentId))!;
    expect(record.accountDeletedAt).toBeInstanceOf(Date);
    expect(record.payment.createdAt).toBeInstanceOf(Date);
    expect(record.payment.rawEventJson).toBeNull();
    expect(record.signIns[0]?.ip).toBe(IP);
    expect(record.summary).toContain("deleted their account");
    expect(renderEvidenceHtml(record, new Date())).toContain("Account deleted");

    for (const query of ["gone@uni", "psk_gone", ""]) {
      const rows = await loadAdminPayments(db, { query });
      expect(rows).toEqual([expect.objectContaining({ id: paymentId, accountDeleted: true })]);
    }
  });

  it("keeps nothing for an account that never paid", async () => {
    const a = await buyer();
    expect((await remove(a.cookie)).status).toBe(200);
    expect(await db.select().from(retainedBillingRecords)).toEqual([]);
  });

  it("records a dispute filed after deletion, alerts once, and holds the record until closed", async () => {
    const a = await buyer();
    const { paymentId } = await pay(a.userId);
    await remove(a.cookie);
    const alerts: string[] = [];
    const notifier = { send: async (t: string) => (alerts.push(t), true) };
    const dispute = {
      provider: "paystack" as const,
      kind: "dispute" as const,
      providerReversalId: "d_late",
      payment: { providerReference: "psk_gone" },
      amountMinor: 3_500_000,
      currency: "NGN",
      status: "awaiting-merchant-feedback",
    };
    expect(await applyPaymentReversal(db, dispute, { notifier })).toEqual({
      outcome: "retained_record",
      paymentId,
    });
    await applyPaymentReversal(db, dispute, { notifier });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("deleted account");

    const sevenYears = days(new Date(), 365 * 7);
    await purgeExpiredRecords(db, sevenYears);
    expect(await db.select().from(retainedBillingRecords)).toHaveLength(1);
    expect((await buildDisputeEvidence(db, paymentId))!.reversals).toHaveLength(1);
    expect((await loadAdminPayments(db))[0]?.openDispute).toBe(true);

    expect(
      await resolveDispute(db, {
        provider: "paystack",
        providerDisputeId: "d_late",
        result: "won",
        status: "declined",
      })
    ).toEqual({ outcome: "resolved", creditsReturned: 0 });
    expect((await loadAdminPayments(db))[0]?.openDispute).toBe(false);
    await purgeExpiredRecords(db, sevenYears);
    expect(await db.select().from(retainedBillingRecords)).toEqual([]);
  });

  it("drops the detailed evidence after 18 months and the whole record after 6 years", async () => {
    const a = await buyer();
    const { paymentId } = await pay(a.userId);
    await remove(a.cookie);
    const now = new Date();

    expect(await purgeExpiredRecords(db, days(now, 500))).toEqual({
      evidenceCleared: 0,
      recordsDeleted: 0,
    });
    expect(await purgeExpiredRecords(db, days(now, 545))).toEqual({
      evidenceCleared: 1,
      recordsDeleted: 0,
    });
    const basic = (await buildDisputeEvidence(db, paymentId))!;
    expect(basic.signIns).toEqual([]);
    expect(basic.ipAddressesSeen).toEqual([]);
    expect(basic.customer.email).toBe("gone@uni.edu.ng");
    expect(renderEvidenceHtml(basic, now)).toContain("psk_gone");

    expect(await purgeExpiredRecords(db, days(now, 365 * 6 + 5))).toEqual({
      evidenceCleared: 0,
      recordsDeleted: 1,
    });
    expect(await buildDisputeEvidence(db, paymentId)).toBeNull();
  });

  it("does not delete the account if the record cannot be saved", async () => {
    const a = await buyer();
    await pay(a.userId);
    d1.d1.prepare("DROP TABLE retained_billing_records").run();
    const res = await remove(a.cookie);
    expect(res.status).toBe(500);
    expect(await db.select().from(users).where(eq(users.id, a.userId))).toHaveLength(1);
    expect(await db.select().from(payments)).toHaveLength(1);
  });
});
