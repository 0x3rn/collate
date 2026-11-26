import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import { createDb, type AppDb } from "@/db/client";
import { createWizardDraftProject } from "@/db/queries/wizard";
import { chapters, notificationPreferences, payments, projectDatasets } from "@/db/schema";
import {
  handleSignIn,
  handleSignUp,
  handleVerifyEmail,
  type HttpAuthDeps,
} from "@/lib/auth/http-handlers";
import { buildDisputeEvidence, isSettledPaymentStatus } from "@/lib/billing/evidence-report";
import {
  handleAdminEvidencePdf,
  handleCancelCheckout,
  handleCreateCheckout,
  handlePaystackWebhook,
  handlePolarWebhook,
  type BillingHttpDeps,
} from "@/lib/billing/http-handlers";
import { grantPaymentCreditsIdempotent } from "@/lib/billing/ledger";
import { computeHmacBase64, computeHmacHex } from "@/lib/billing/webhooks";
import type { EmailMessage, EmailSender } from "@/lib/email/mailer";
import {
  getUserNotificationPrefs,
  shouldShowMarketingPrompt,
  updateUserNotificationPrefs,
} from "@/lib/email/notifications";
import { handleRespondMarketingPrompt } from "@/lib/email/prefs-handlers";
import {
  buildLandingJsonLd,
  GSC_VERIFICATION_TOKEN,
  serializeJsonLd,
  SITE_URL,
} from "@/lib/seo/site-metadata";
import {
  handleSaveChapterInstructions,
  handleUploadProjectDataset,
} from "@/lib/writing/http-handlers";
import { analyzeCsvDataset, resolveAuthoritativeResultsData } from "@/lib/writing/results-data";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

const APP_URL = "https://collateresearch.app";

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
  if (!match?.[1]) throw new Error("No verification token found");
  return decodeURIComponent(match[1]);
}

describe("Production polish: marketing opt-in prompt, cancelled checkouts, results precedence, SEO/AEO", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  let sent: EmailMessage[];
  let now: Date;
  let authDeps: HttpAuthDeps;

  beforeEach(() => {
    now = new Date("2026-11-26T16:00:00.000Z");
    d1Ctx = createInMemoryD1();
    d1Ctx.applyMigrations();
    db = createDb(d1Ctx.d1);
    const mail = createTestMailer();
    sent = mail.sent;
    authDeps = {
      db,
      mailer: mail.mailer,
      appUrl: APP_URL,
      appEnv: "prod",
      turnstileSecretKey: "test-secret",
      nowFn: () => now,
      fetchFn: async () => Response.json({ success: true }),
    };
  });

  afterEach(() => {
    d1Ctx.close();
  });

  async function signUpAndSignIn(name: string, email: string, password: string) {
    await handleSignUp(
      new Request(`${APP_URL}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: APP_URL },
        body: JSON.stringify({ name, email, password, turnstileToken: "ok", acceptTerms: true }),
      }),
      authDeps
    );
    const tok = extractToken(sent[sent.length - 1]!.text);
    await handleVerifyEmail(
      new Request(`${APP_URL}/api/auth/verify-email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: APP_URL },
        body: JSON.stringify({ token: tok }),
      }),
      authDeps
    );
    const res = await handleSignIn(
      new Request(`${APP_URL}/api/auth/signin`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: APP_URL },
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

  it("shows dashboard email updates prompt once per new user and persists opt-in or dismissal securely", async () => {
    const userA = await signUpAndSignIn("Amaka", "amaka@uni.edu", "quiet cedar study bench");
    const userB = await signUpAndSignIn("Tunde", "tunde@uni.edu", "quiet cedar study bench");

    expect(await shouldShowMarketingPrompt(db, userA.userId)).toBe(true);

    // Unauthenticated & CSRF blocked
    const anon = await handleRespondMarketingPrompt(
      new Request(`${APP_URL}/api/account/marketing-prompt`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: APP_URL },
        body: JSON.stringify({ optIn: true }),
      }),
      authDeps
    );
    expect(anon.status).toBe(401);

    const csrf = await handleRespondMarketingPrompt(
      new Request(`${APP_URL}/api/account/marketing-prompt`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          cookie: userA.cookie,
        },
        body: JSON.stringify({ optIn: true }),
      }),
      authDeps
    );
    expect(csrf.status).toBe(403);

    // Invalid body -> 400
    const bad = await handleRespondMarketingPrompt(
      new Request(`${APP_URL}/api/account/marketing-prompt`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: APP_URL, cookie: userA.cookie },
        body: JSON.stringify({ optIn: "yes" }),
      }),
      authDeps
    );
    expect(bad.status).toBe(400);

    // User A opts in
    const okYes = await handleRespondMarketingPrompt(
      new Request(`${APP_URL}/api/account/marketing-prompt`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: APP_URL, cookie: userA.cookie },
        body: JSON.stringify({ optIn: true }),
      }),
      authDeps
    );
    expect(okYes.status).toBe(200);
    expect(await okYes.json()).toEqual({ ok: true, emailMarketing: true });
    expect(await shouldShowMarketingPrompt(db, userA.userId)).toBe(false);
    const prefsA = await getUserNotificationPrefs(db, userA.userId);
    expect(prefsA.emailMarketing).toBe(true);
    expect(prefsA.emailChapterReady).toBe(true);

    // User B declines -> never prompted again
    const okNo = await handleRespondMarketingPrompt(
      new Request(`${APP_URL}/api/account/marketing-prompt`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: APP_URL, cookie: userB.cookie },
        body: JSON.stringify({ optIn: false }),
      }),
      authDeps
    );
    expect(okNo.status).toBe(200);
    expect(await shouldShowMarketingPrompt(db, userB.userId)).toBe(false);
    const [rowB] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userB.userId));
    expect(rowB?.emailMarketing).toBe(false);
    expect(rowB?.marketingPromptSeenAt).not.toBeNull();

    // User C saves notification preferences directly on /account -> dashboard prompt suppressed
    const userC = await signUpAndSignIn("Kemi", "kemi@uni.edu", "quiet cedar study bench");
    expect(await shouldShowMarketingPrompt(db, userC.userId)).toBe(true);
    await updateUserNotificationPrefs(
      db,
      userC.userId,
      {
        emailChapterReady: true,
        emailNeedsAttention: true,
        emailProjectComplete: true,
        emailReceipts: true,
        emailMarketing: false,
      },
      now
    );
    expect(await shouldShowMarketingPrompt(db, userC.userId)).toBe(false);
  });

  it("marks cancelled/failed checkouts terminal, blocks unpaid evidence records, and allows late verified settlement", async () => {
    const alice = await signUpAndSignIn("Alice", "alice@uni.edu", "quiet cedar study bench");
    const bob = await signUpAndSignIn("Bob", "bob@uni.edu", "quiet cedar study bench");
    const admin = await signUpAndSignIn(
      "Admin",
      "admin@collateresearch.app",
      "quiet cedar study bench"
    );

    const polarWebhookSecret = "whsec_dGVzdF9wb2xhcl9zZWNyZXQ=";
    const paystackSecretKey = "sk_test_paystack_secret";
    let polarCheckoutSeq = 0;

    const billingDeps: BillingHttpDeps & { browser: { quickAction: () => Promise<Response> } } = {
      ...authDeps,
      adminEmails: "admin@collateresearch.app",
      polarAccessToken: "polar_pat_test",
      polarWebhookSecret,
      polarProductIds: { pack_starter_25: "prod_starter_25" },
      paystackSecretKey,
      fetchFn: async (url) => {
        const u = String(url);
        if (u.includes("api.polar.sh")) {
          polarCheckoutSeq += 1;
          return Response.json({
            id: `chk_polar_${polarCheckoutSeq}`,
            url: `https://buy.polar.sh/chk_polar_${polarCheckoutSeq}`,
          });
        }
        if (u.includes("api.paystack.co")) {
          return Response.json({
            status: true,
            data: { authorization_url: "https://checkout.paystack.com/test" },
          });
        }
        return Response.json({ success: true });
      },
      browser: {
        async quickAction() {
          return new Response(new TextEncoder().encode("%PDF-1.7 ok"), { status: 200 });
        },
      },
    };

    // 1. Alice starts Polar checkout #1 -> pending
    const chk1Res = await handleCreateCheckout(
      new Request(`${APP_URL}/api/billing/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: APP_URL, cookie: alice.cookie },
        body: JSON.stringify({ provider: "polar", packId: "pack_starter_25", acceptTerms: true }),
      }),
      billingDeps
    );
    expect(chk1Res.status).toBe(201);
    const { reference: ref1 } = (await chk1Res.json()) as { reference: string };
    const [pendingRow] = await db
      .select()
      .from(payments)
      .where(eq(payments.providerReference, ref1));
    expect(pendingRow?.status).toBe("pending");

    // Pending payment MUST NOT have a dispute evidence record or PDF
    expect(isSettledPaymentStatus("pending")).toBe(false);
    expect(isSettledPaymentStatus("cancelled")).toBe(false);
    expect(isSettledPaymentStatus("failed")).toBe(false);
    expect(isSettledPaymentStatus("succeeded")).toBe(true);
    expect(isSettledPaymentStatus("refunded")).toBe(true);
    expect(await buildDisputeEvidence(db, pendingRow!.id)).toBeNull();

    const pdfPending = await handleAdminEvidencePdf(
      new Request(`${APP_URL}/api/admin/payments/${pendingRow!.id}/evidence-pdf`, {
        headers: { cookie: admin.cookie },
      }),
      pendingRow!.id,
      billingDeps
    );
    expect(pdfPending.status).toBe(409);

    // 2. Bob CANNOT cancel Alice's pending checkout
    await handleCancelCheckout(
      new Request(`${APP_URL}/api/billing/checkout/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: APP_URL, cookie: bob.cookie },
        body: JSON.stringify({ reference: ref1 }),
      }),
      billingDeps
    );
    const [stillPending] = await db.select().from(payments).where(eq(payments.id, pendingRow!.id));
    expect(stillPending?.status).toBe("pending");

    // 3. Alice cancels her own checkout via return URL -> status becomes "cancelled"
    const cancelRes = await handleCancelCheckout(
      new Request(`${APP_URL}/api/billing/checkout/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: APP_URL, cookie: alice.cookie },
        body: JSON.stringify({ reference: ref1 }),
      }),
      billingDeps
    );
    expect(cancelRes.status).toBe(200);
    const [cancelledRow] = await db.select().from(payments).where(eq(payments.id, pendingRow!.id));
    expect(cancelledRow?.status).toBe("cancelled");
    expect(await buildDisputeEvidence(db, pendingRow!.id)).toBeNull();

    // 4. Polar checkout.updated (expired) webhook marks pending checkout #2 as "cancelled"
    const chk2Res = await handleCreateCheckout(
      new Request(`${APP_URL}/api/billing/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: APP_URL, cookie: alice.cookie },
        body: JSON.stringify({ provider: "polar", packId: "pack_starter_25", acceptTerms: true }),
      }),
      billingDeps
    );
    const { reference: ref2 } = (await chk2Res.json()) as { reference: string };
    const polarBody = JSON.stringify({
      type: "checkout.updated",
      data: { id: ref2, status: "expired" },
    });
    const ts = String(Math.floor(now.getTime() / 1000));
    const msgId = "msg_polar_exp_1";
    const keyBytes = Uint8Array.from(atob("dGVzdF9wb2xhcl9zZWNyZXQ="), (c) => c.charCodeAt(0));
    const sig = await computeHmacBase64("SHA-256", keyBytes, `${msgId}.${ts}.${polarBody}`);

    const polarExpRes = await handlePolarWebhook(
      new Request(`${APP_URL}/api/webhooks/polar`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "webhook-id": msgId,
          "webhook-timestamp": ts,
          "webhook-signature": `v1,${sig}`,
        },
        body: polarBody,
      }),
      billingDeps
    );
    expect(polarExpRes.status).toBe(200);
    const [expiredRow] = await db
      .select()
      .from(payments)
      .where(eq(payments.providerReference, ref2));
    expect(expiredRow?.status).toBe("cancelled");

    // 5. Paystack charge.failed webhook marks pending checkout as "failed"
    const pskRes = await handleCreateCheckout(
      new Request(`${APP_URL}/api/billing/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: APP_URL, cookie: alice.cookie },
        body: JSON.stringify({
          provider: "paystack",
          packId: "pack_starter_25",
          acceptTerms: true,
        }),
      }),
      billingDeps
    );
    const { reference: pskRef } = (await pskRes.json()) as { reference: string };
    const pskFailBody = JSON.stringify({
      event: "charge.failed",
      data: { reference: pskRef, gateway_response: "Declined" },
    });
    const pskSig = await computeHmacHex("SHA-512", paystackSecretKey, pskFailBody);
    const pskFailRes = await handlePaystackWebhook(
      new Request(`${APP_URL}/api/webhooks/paystack`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-paystack-signature": pskSig },
        body: pskFailBody,
      }),
      billingDeps
    );
    expect(pskFailRes.status).toBe(200);
    const [failedRow] = await db
      .select()
      .from(payments)
      .where(eq(payments.providerReference, pskRef));
    expect(failedRow?.status).toBe("failed");

    // 6. Late verified payment settlement safely recovers a cancelled checkout & unlocks evidence record
    const settled = await grantPaymentCreditsIdempotent(
      db,
      {
        provider: "polar",
        providerReference: ref1,
        providerOrderId: "ord_late_1",
        userId: alice.userId,
        currency: "USD",
        amountMinor: pendingRow!.amountMinor,
        creditsGranted: pendingRow!.creditsGranted,
        eventType: "order.paid",
      },
      "{}",
      now
    );
    expect(settled.alreadyProcessed).toBe(false);
    expect(settled.newBalance).toBe(25);
    expect(await buildDisputeEvidence(db, pendingRow!.id)).not.toBeNull();
  });

  it("resolves a single authoritative Results dataset across Results card and Add instructions without duplicates", async () => {
    const user = await signUpAndSignIn("Ngozi", "ngozi@uni.edu", "quiet cedar study bench");
    const draft = await createWizardDraftProject(db, user.userId, "project", now);
    const resultsChapter = draft.chapters.find((c) => c.chapterType === "results");
    expect(resultsChapter).toBeDefined();

    const csvV1 = "Group,Score\nControl,10\nTreatment,14\n";
    const csvV2 = "Group,Score\nControl,20\nTreatment,35\n";

    // Step 1: Upload CSV v1 via chapter Add instructions
    const saveV1 = await handleSaveChapterInstructions(
      new Request(
        `${APP_URL}/api/projects/${draft.project.id}/chapters/${resultsChapter!.id}/instructions`,
        {
          method: "PUT",
          headers: { "content-type": "application/json", origin: APP_URL, cookie: user.cookie },
          body: JSON.stringify({
            instructions: "Compare Control vs Treatment outcomes carefully.",
            attachmentFilename: "trial_v1.csv",
            attachmentContent: csvV1,
          }),
        }
      ),
      draft.project.id,
      resultsChapter!.id,
      authDeps
    );
    expect(saveV1.status).toBe(200);

    // Step 2: Later upload CSV v2 via the project Results data card -> MUST sync Results chapter
    now = new Date(now.getTime() + 60_000);
    const uploadV2 = await handleUploadProjectDataset(
      new Request(`${APP_URL}/api/projects/${draft.project.id}/datasets`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: APP_URL, cookie: user.cookie },
        body: JSON.stringify({ filename: "trial_v2.csv", csvContent: csvV2 }),
      }),
      draft.project.id,
      authDeps
    );
    expect(uploadV2.status).toBe(201);

    const [updatedChapter] = await db
      .select()
      .from(chapters)
      .where(eq(chapters.id, resultsChapter!.id));
    expect(updatedChapter?.userAttachmentName).toBe("trial_v2.csv");
    expect(updatedChapter?.userDataSummaryMarkdown).toContain("27.5"); // mean of 20 and 35
    expect(updatedChapter?.userDataSummaryMarkdown).not.toContain("| 12 |"); // stale v1 mean gone

    // Pure resolver picks newer project dataset decisively even if chapter row was stale
    const analysisV1 = analyzeCsvDataset(csvV1);
    const analysisV2 = analyzeCsvDataset(csvV2);
    const resolved = resolveAuthoritativeResultsData({
      chapterDataSummaryMarkdown: analysisV1.markdownTables,
      chapterAttachmentName: "trial_v1.csv",
      chapterUpdatedAt: new Date("2026-11-26T16:00:00.000Z"),
      chapterInstructions: "Old pasted table:\n| Group | Mean |\n| --- | --- |\n| Control | 12 |",
      latestDataset: {
        filename: "trial_v2.csv",
        summaryJson: JSON.stringify(analysisV2),
        createdAt: new Date("2026-11-26T16:05:00.000Z"),
      },
    });
    expect(resolved.source).toBe("csv_dataset");
    expect(resolved.activeFilename).toBe("trial_v2.csv");
    expect(resolved.datasetMarkdown).toContain("27.5");
    expect(resolved.hasInlineNotesOverlap).toBe(true);

    // Step 3: Removing/clearing the CSV in Add instructions clears stale project_datasets rows too
    const cleared = await handleSaveChapterInstructions(
      new Request(
        `${APP_URL}/api/projects/${draft.project.id}/chapters/${resultsChapter!.id}/instructions`,
        {
          method: "PUT",
          headers: { "content-type": "application/json", origin: APP_URL, cookie: user.cookie },
          body: JSON.stringify({
            instructions: "",
            keepExistingAttachment: false,
          }),
        }
      ),
      draft.project.id,
      resultsChapter!.id,
      authDeps
    );
    expect(cleared.status).toBe(200);
    const remainingDatasets = await db
      .select()
      .from(projectDatasets)
      .where(and(eq(projectDatasets.projectId, draft.project.id)));
    expect(remainingDatasets).toHaveLength(0);
  });

  it("produces valid SEO sitemap, robots, JSON-LD structured data, GSC token, and llms.txt", () => {
    const entries = sitemap();
    const urls = entries.map((e) => e.url);
    expect(urls).toEqual([
      SITE_URL,
      `${SITE_URL}/terms`,
      `${SITE_URL}/privacy`,
      `${SITE_URL}/acceptable-use`,
      `${SITE_URL}/cookies`,
    ]);
    expect(urls.some((u) => u.includes("/admin") || u.includes("/dashboard"))).toBe(false);

    const robotsConfig = robots();
    expect(robotsConfig.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
    expect(JSON.stringify(robotsConfig)).not.toContain("/admin");
    expect(JSON.stringify(robotsConfig)).not.toContain("/api/internal");

    const graph = (buildLandingJsonLd()["@graph"] ?? []) as Array<{ "@type": string }>;
    const types = graph.map((n) => n["@type"]);
    expect(types).toContain("Organization");
    expect(types).toContain("WebSite");
    expect(types).toContain("SoftwareApplication");
    expect(types).toContain("FAQPage");

    const serialized = serializeJsonLd({ html: "</script><script>alert(1)</script>" });
    expect(serialized).not.toContain("</script>");
    expect(GSC_VERIFICATION_TOKEN.length).toBeGreaterThan(20);

    const llmsPath = path.resolve(process.cwd(), "public/llms.txt");
    const llmsText = fs.readFileSync(llmsPath, "utf8");
    expect(llmsText).toContain("https://collateresearch.app");
    expect(llmsText).toContain("APA 7");
    expect(llmsText).not.toContain("\u2014");
  });
});
