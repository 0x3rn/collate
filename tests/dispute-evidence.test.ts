import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { createProjectForUser } from "@/db/queries/projects";
import { auditLog, chapters, chapterVersions, payments, users } from "@/db/schema";
import { handleSignIn, handleSignUp, handleVerifyCode } from "@/lib/auth/http-handlers";
import { TERMS_VERSION } from "@/lib/billing/evidence";
import {
  buildDisputeEvidence,
  describeCheckoutAgreement,
  describeSignupAgreement,
} from "@/lib/billing/evidence-report";
import {
  type BillingHttpDeps,
  handleAdminLiftHold,
  handleCreateCheckout,
} from "@/lib/billing/http-handlers";
import { grantPaymentCreditsIdempotent, reserveChapterCredits } from "@/lib/billing/ledger";
import { applyPaymentReversal } from "@/lib/billing/reversals";
import type { EmailMessage } from "@/lib/email/mailer";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

const APP = "https://collateresearch.app";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

describe("dispute evidence", () => {
  let d1: InMemoryD1Context;
  let db: AppDb;
  let sent: EmailMessage[];
  let deps: BillingHttpDeps;

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
      paystackSecretKey: "sk_test",
      adminEmails: "boss@collateresearch.app",
      fetchFn: (async (url: string) =>
        String(url).includes("paystack")
          ? Response.json({
              status: true,
              data: { authorization_url: "https://checkout.paystack.com/x" },
            })
          : Response.json({ success: true })) as typeof fetch,
    };
  });
  afterEach(() => d1.close());

  const req = (path: string, body: unknown, cookie = "") =>
    new Request(`${APP}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: APP,
        cookie,
        "cf-connecting-ip": "102.89.34.10",
        "user-agent": IPHONE,
      },
      body: JSON.stringify(body),
    });

  async function account(email: string) {
    const password = "quiet library oak shelf";
    await handleSignUp(
      req("/api/auth/signup", {
        name: "Ada Obi",
        email,
        password,
        turnstileToken: "x",
        acceptTerms: true,
      }),
      deps
    );
    const code = sent[sent.length - 1]!.text.match(/\b(\d{6})\b/)![1]!;
    await handleVerifyCode(req("/api/auth/verify-code", { email, code }), deps);
    const res = await handleSignIn(
      req("/api/auth/signin", { email, password, turnstileToken: "x" }),
      deps
    );
    const body = (await res.json()) as { user: { id: string } };
    return { cookie: (res.headers.get("set-cookie") ?? "").split(";")[0]!, userId: body.user.id };
  }

  it("records who agreed, from where, and what they received", async () => {
    const ada = await account("ada@uni.edu.ng");

    // Sign-up and sign-in keep the IP and device.
    const [signup] = await db.select().from(auditLog).where(eq(auditLog.action, "auth.signup"));
    expect(JSON.parse(signup!.metadataJson!)).toMatchObject({
      ip: "102.89.34.10",
      termsVersion: TERMS_VERSION,
    });

    // Checkout records the agreement to the Terms.
    const checkout = await handleCreateCheckout(
      req(
        "/api/billing/checkout",
        { provider: "paystack", packId: "pack_project_60", acceptTerms: true },
        ada.cookie
      ),
      deps
    );
    expect(checkout.status).toBe(201);
    const { reference } = (await checkout.json()) as { reference: string };
    const [agreed] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "billing.checkout_started"));
    expect(JSON.parse(agreed!.metadataJson!)).toMatchObject({
      termsAccepted: true,
      termsVersion: TERMS_VERSION,
      ip: "102.89.34.10",
    });

    // Payment completes; the customer uses credits on a chapter and downloads it.
    const [pending] = await db
      .select()
      .from(payments)
      .where(eq(payments.providerReference, reference));
    await grantPaymentCreditsIdempotent(
      db,
      {
        provider: "paystack",
        providerReference: reference,
        userId: ada.userId,
        currency: "NGN",
        amountMinor: pending!.amountMinor,
        creditsGranted: pending!.creditsGranted,
        eventType: "charge.success",
      },
      "{}",
      new Date(Date.now() + 1000)
    );
    const later = new Date(Date.now() + 60_000);
    await createProjectForUser(db, {
      id: "prj_1",
      userId: ada.userId,
      type: "project",
      title: "Kola nut caffeine and exam performance",
      now: later,
    });
    await reserveChapterCredits(db, {
      userId: ada.userId,
      projectId: "prj_1",
      credits: 20,
      idempotencyKey: "res_ch1",
      now: later,
    });
    await db.insert(chapters).values({
      id: "ch_1",
      projectId: "prj_1",
      number: 1,
      title: "Introduction",
      chapterType: "introduction",
      status: "ready",
      finishedAt: later,
      createdAt: later,
      updatedAt: later,
    } as typeof chapters.$inferInsert);
    await db.insert(chapterVersions).values({
      id: "v_1",
      chapterId: "ch_1",
      version: 1,
      contentR2Key: "chapters/prj_1/v1.md",
      wordCount: 3120,
      createdAt: later,
    } as typeof chapterVersions.$inferInsert);
    await db.insert(auditLog).values({
      id: "aud_dl",
      actorUserId: ada.userId,
      action: "export.downloaded",
      entityType: "export",
      entityId: "exp_1",
      metadataJson: JSON.stringify({
        format: "pdf",
        scope: "chapter",
        ip: "102.89.34.10",
        userAgent: IPHONE,
      }),
      createdAt: later,
    });

    const ev = await buildDisputeEvidence(db, pending!.id);
    expect(ev).not.toBeNull();
    expect(ev!.checkout.termsVersion).toBe(TERMS_VERSION);
    expect(ev!.checkout.device).toContain("iPhone");
    expect(ev!.signIns.length).toBeGreaterThan(0);
    expect(ev!.creditsUsedSincePayment).toBe(20);
    expect(ev!.chaptersDelivered).toEqual([
      expect.objectContaining({ number: 1, title: "Introduction", words: 3120 }),
    ]);
    expect(ev!.downloads).toHaveLength(1);
    expect(ev!.summary).toContain("ada@uni.edu.ng");
    expect(ev!.summary).toContain(`version ${TERMS_VERSION}`);
    expect(ev!.summary).toContain("102.89.34.10");
    expect(ev!.summary).toContain("Chapter 1: Introduction (3,120 words)");
    expect(ev!.summary).toContain("spent 20 credits");
    expect(ev!.summary).toContain("Checkout cannot start without ticking this box.");
    expect(ev!.summary).toContain("an account cannot be created without it");
    expect(describeCheckoutAgreement(ev!)).toMatch(
      /^Agreed to the Terms of Service and Refund Policy .*\(users can't check out without agreeing to these terms\)$/
    );
    expect(describeSignupAgreement(ev!)).toMatch(
      /^Signed up on .*agreeing to the Terms of Service .*\(users can't sign up without agreeing to these terms\)$/
    );
    expect(ev!.summary).toContain("The service was delivered as described.");
    expect(await buildDisputeEvidence(db, "missing")).toBeNull();
  });

  it("refuses checkout while the account is on hold, and only admins can lift it", async () => {
    const ada = await account("ada@uni.edu.ng");
    const boss = await account("boss@collateresearch.app");
    await grantPaymentCreditsIdempotent(
      db,
      {
        provider: "paystack",
        providerReference: "psk_old",
        userId: ada.userId,
        currency: "NGN",
        amountMinor: 3_500_000,
        creditsGranted: 100,
        eventType: "charge.success",
      },
      "{}"
    );
    await applyPaymentReversal(db, {
      provider: "paystack",
      kind: "dispute",
      providerReversalId: "d1",
      payment: { providerReference: "psk_old" },
      amountMinor: 3_500_000,
      currency: "NGN",
      status: "awaiting-merchant-feedback",
    });

    const blocked = await handleCreateCheckout(
      req(
        "/api/billing/checkout",
        { provider: "paystack", packId: "pack_project_60", acceptTerms: true },
        ada.cookie
      ),
      deps
    );
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ code: "ACCOUNT_ON_HOLD" });

    const self = await handleAdminLiftHold(
      req(
        "/api/admin/billing-hold",
        { userId: ada.userId, note: "Lifting my own hold" },
        ada.cookie
      ),
      deps
    );
    expect(self.status).toBe(403);

    const lifted = await handleAdminLiftHold(
      req("/api/admin/billing-hold", { userId: ada.userId, note: "Settled by email" }, boss.cookie),
      deps
    );
    expect(lifted.status).toBe(200);
    const [u] = await db.select().from(users).where(eq(users.id, ada.userId));
    expect(u?.billingHoldReason).toBeNull();
    const ok = await handleCreateCheckout(
      req(
        "/api/billing/checkout",
        { provider: "paystack", packId: "pack_project_60", acceptTerms: true },
        ada.cookie
      ),
      deps
    );
    expect(ok.status).toBe(201);
  });

  it("refuses sign-up and checkout without the ticked agreement", async () => {
    const noTick = await handleSignUp(
      req("/api/auth/signup", {
        name: "No Tick",
        email: "notick@uni.edu.ng",
        password: "quiet library oak shelf",
        turnstileToken: "x",
      }),
      deps
    );
    expect(noTick.status).toBe(400);
    expect(await noTick.json()).toMatchObject({
      error: "Tick the box to agree to the Terms of Service before creating your account.",
    });
    expect(await db.select().from(users).where(eq(users.email, "notick@uni.edu.ng"))).toEqual([]);

    const ada = await account("ada@uni.edu.ng");
    for (const acceptTerms of [undefined, false, "true"]) {
      const res = await handleCreateCheckout(
        req(
          "/api/billing/checkout",
          { provider: "paystack", packId: "pack_project_60", acceptTerms },
          ada.cookie
        ),
        deps
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "TERMS_NOT_ACCEPTED" });
    }
    expect(await db.select().from(payments)).toEqual([]);
    expect(
      await db.select().from(auditLog).where(eq(auditLog.action, "billing.checkout_started"))
    ).toEqual([]);
  });
});
