import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  estimateChapterCredits,
  estimateRevisionCredits,
  estimateSingleSectionRevisionCredits,
} from "@/config/pricing";
import { createDb, type AppDb } from "@/db/client";
import { createWizardDraftProject } from "@/db/queries/wizard";
import { chapters, creditReservations, sections, users } from "@/db/schema";
import {
  handleSignIn,
  handleSignUp,
  handleVerifyEmail,
  type HttpAuthDeps,
} from "@/lib/auth/http-handlers";
import type { EmailMessage, EmailSender } from "@/lib/email/mailer";
import {
  handleApproveChapter,
  handleRequestChapterChanges,
  handleStartChapter,
  handleUploadProjectDataset,
} from "@/lib/writing/http-handlers";
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
  if (!match?.[1]) throw new Error("Token not found");
  return decodeURIComponent(match[1]);
}

describe("Phase 7 — Chapter & CSV Dataset HTTP API (NN-8 gating, idempotency & IDOR)", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  let sent: EmailMessage[];
  let authDeps: HttpAuthDeps;
  const now = new Date("2026-11-22T09:00:00.000Z");

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

  async function signUpCookie(name: string, email: string, password: string) {
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

  it("enforces NN-8 sequential gating, double-click idempotency, revisions, CSV upload & two-user isolation", async () => {
    const alice = await signUpCookie("Alice", "alice.ch@uni.edu", "quiet autumn paper desk");
    const bob = await signUpCookie("Bob", "bob.ch@uni.edu", "steady winter stone arch");

    const draft = await createWizardDraftProject(db, alice.userId, "thesis", now);
    const projectId = draft.project.id;
    const ch1 = draft.chapters.find((c) => c.number === 1)!;
    const ch2 = draft.chapters.find((c) => c.number === 2)!;

    const launchedParams: Array<Record<string, unknown>> = [];
    let launchCount = 0;
    const launcher = {
      async create(opts: { params: Record<string, unknown> }) {
        launchCount++;
        launchedParams.push(opts.params);
        return { id: `wf_ch_${launchCount}` };
      },
    };
    const storedCsv = new Map<string, string>();
    const bucket = {
      async put(key: string, val: unknown) {
        storedCsv.set(key, String(val));
      },
    };

    const deps = { ...authDeps, workflowLauncher: launcher, bucket };

    const bobStart = await handleStartChapter(
      new Request(`https://collate.app/api/projects/${projectId}/chapters/${ch1.id}/start`, {
        method: "POST",
        headers: { origin: "https://collate.app", cookie: bob.cookie },
      }),
      projectId,
      ch1.id,
      deps
    );
    expect(bobStart.status).toBe(404);

    const ch2Early = await handleStartChapter(
      new Request(`https://collate.app/api/projects/${projectId}/chapters/${ch2.id}/start`, {
        method: "POST",
        headers: { origin: "https://collate.app", cookie: alice.cookie },
      }),
      projectId,
      ch2.id,
      deps
    );
    expect(ch2Early.status).toBe(409);

    // Zero credits -> 402 Payment Required and workflow never launches
    const noCreditsStart = await handleStartChapter(
      new Request(`https://collate.app/api/projects/${projectId}/chapters/${ch1.id}/start`, {
        method: "POST",
        headers: { origin: "https://collate.app", cookie: alice.cookie },
      }),
      projectId,
      ch1.id,
      deps
    );
    expect(noCreditsStart.status).toBe(402);
    expect(launchCount).toBe(0);

    // Grant Alice 100 credits
    await db.update(users).set({ creditsBalance: 100 }).where(eq(users.id, alice.userId));

    const ch1Start1 = await handleStartChapter(
      new Request(`https://collate.app/api/projects/${projectId}/chapters/${ch1.id}/start`, {
        method: "POST",
        headers: { origin: "https://collate.app", cookie: alice.cookie },
      }),
      projectId,
      ch1.id,
      deps
    );
    expect(ch1Start1.status).toBe(202);
    expect(launchCount).toBe(1);
    expect(launchedParams[0]?.reservationId).toBeTruthy();

    const ch1Cost = estimateChapterCredits(ch1.pageBudget);
    const [aliceAfterCh1] = await db.select().from(users).where(eq(users.id, alice.userId));
    expect(aliceAfterCh1?.creditsBalance).toBe(100 - ch1Cost);

    const ch1Start2 = await handleStartChapter(
      new Request(`https://collate.app/api/projects/${projectId}/chapters/${ch1.id}/start`, {
        method: "POST",
        headers: { origin: "https://collate.app", cookie: alice.cookie },
      }),
      projectId,
      ch1.id,
      deps
    );
    const dupJson = (await ch1Start2.json()) as { alreadyRunning: boolean };
    expect(dupJson.alreadyRunning).toBe(true);
    expect(launchCount).toBe(1);
    // Double-click must NOT deduct credits again
    const [aliceAfterDup] = await db.select().from(users).where(eq(users.id, alice.userId));
    expect(aliceAfterDup?.creditsBalance).toBe(100 - ch1Cost);

    await db.update(chapters).set({ status: "ready" }).where(eq(chapters.id, ch1.id));

    const approveRes = await handleApproveChapter(
      new Request(`https://collate.app/api/projects/${projectId}/chapters/${ch1.id}/approve`, {
        method: "POST",
        headers: { origin: "https://collate.app", cookie: alice.cookie },
      }),
      projectId,
      ch1.id,
      deps
    );
    expect(approveRes.status).toBe(200);

    const ch2Start = await handleStartChapter(
      new Request(`https://collate.app/api/projects/${projectId}/chapters/${ch2.id}/start`, {
        method: "POST",
        headers: { origin: "https://collate.app", cookie: alice.cookie },
      }),
      projectId,
      ch2.id,
      deps
    );
    expect(ch2Start.status).toBe(202);
    expect(launchCount).toBe(2);

    const reviseRes = await handleRequestChapterChanges(
      new Request(`https://collate.app/api/projects/${projectId}/chapters/${ch1.id}/revise`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: alice.cookie,
        },
        body: JSON.stringify({ instructions: "Add stronger empirical comparisons in section 2." }),
      }),
      projectId,
      ch1.id,
      deps
    );
    expect(reviseRes.status).toBe(202);
    expect(launchCount).toBe(3);

    const ch2Cost = estimateChapterCredits(ch2.pageBudget);
    const revCost = estimateRevisionCredits(ch1.pageBudget);
    expect(revCost).toBe(ch1Cost);
    const [aliceAfterRev] = await db.select().from(users).where(eq(users.id, alice.userId));
    expect(aliceAfterRev?.creditsBalance).toBe(100 - ch1Cost - ch2Cost - revCost);

    // Targeted single-section revision deducts strictly fewer proportional credits & lower spendCapUsd
    await db
      .update(chapters)
      .set({ status: "ready", pageBudget: 8 })
      .where(eq(chapters.id, ch1.id));
    await db.insert(sections).values([
      {
        id: "sec_api_1",
        chapterId: ch1.id,
        orderIndex: 1,
        heading: "Background of the study",
        wordBudget: 500,
        status: "verified",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "sec_api_2",
        chapterId: ch1.id,
        orderIndex: 2,
        heading: "Statement of the problem",
        wordBudget: 500,
        status: "verified",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "sec_api_3",
        chapterId: ch1.id,
        orderIndex: 3,
        heading: "Aim and objectives",
        wordBudget: 500,
        status: "verified",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "sec_api_4",
        chapterId: ch1.id,
        orderIndex: 4,
        heading: "Scope and delimitations",
        wordBudget: 500,
        status: "verified",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const balBeforeSecRev = aliceAfterRev!.creditsBalance;
    const secRevRes = await handleRequestChapterChanges(
      new Request(`https://collate.app/api/projects/${projectId}/chapters/${ch1.id}/revise`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: alice.cookie,
        },
        body: JSON.stringify({
          instructions: "Clarify sampling scope in this section.",
          targetSectionHeadings: ["Scope and delimitations"],
        }),
      }),
      projectId,
      ch1.id,
      deps
    );
    expect(secRevRes.status).toBe(202);
    const expectedSecCost = estimateSingleSectionRevisionCredits(8, 4);
    expect(expectedSecCost).toBe(2);
    expect(expectedSecCost).toBeLessThan(estimateChapterCredits(8));
    expect(launchedParams[launchCount - 1]?.spendCapUsd).toBe(0.75);
    const [aliceAfterSecRev] = await db.select().from(users).where(eq(users.id, alice.userId));
    expect(aliceAfterSecRev?.creditsBalance).toBe(balBeforeSecRev - expectedSecCost);

    // Active workflow instance guard: if chapter was marked needs_attention while its workflow
    // is still running in Cloudflare, Resume must NOT launch a second concurrent workflow
    await db
      .update(chapters)
      .set({ status: "needs_attention", workflowInstanceId: "wf_still_running" })
      .where(eq(chapters.id, ch1.id));
    const countBeforeGuard = launchCount;
    const guardRes = await handleStartChapter(
      new Request(`https://collate.app/api/projects/${projectId}/chapters/${ch1.id}/start`, {
        method: "POST",
        headers: { origin: "https://collate.app", cookie: alice.cookie },
      }),
      projectId,
      ch1.id,
      {
        ...deps,
        workflowLauncher: {
          ...launcher,
          async get() {
            return {
              async status() {
                return { status: "running" };
              },
            };
          },
        },
      }
    );
    expect(guardRes.status).toBe(202);
    const guardJson = (await guardRes.json()) as { alreadyRunning: boolean };
    expect(guardJson.alreadyRunning).toBe(true);
    expect(launchCount).toBe(countBeforeGuard);
    await db
      .update(chapters)
      .set({ status: "approved", workflowInstanceId: null })
      .where(eq(chapters.id, ch1.id));

    // If workflow launcher fails, reservation is immediately refunded and chapter status reverts
    await db.update(chapters).set({ status: "ready" }).where(eq(chapters.id, ch2.id));
    const ch3 = draft.chapters.find((c) => c.number === 3)!;
    const balanceBeforeLaunchCrash = aliceAfterSecRev!.creditsBalance;
    const failingRes = await handleStartChapter(
      new Request(`https://collate.app/api/projects/${projectId}/chapters/${ch3.id}/start`, {
        method: "POST",
        headers: { origin: "https://collate.app", cookie: alice.cookie },
      }),
      projectId,
      ch3.id,
      {
        ...deps,
        workflowLauncher: {
          async create() {
            throw new Error("Simulated Cloudflare Workflows outage");
          },
        },
      }
    );
    expect(failingRes.status).toBe(500);
    const [aliceAfterRefund] = await db.select().from(users).where(eq(users.id, alice.userId));
    expect(aliceAfterRefund?.creditsBalance).toBe(balanceBeforeLaunchCrash);
    const [ch3Row] = await db.select().from(chapters).where(eq(chapters.id, ch3.id));
    expect(ch3Row?.status).toBe("not_started");
    const refundedRows = await db
      .select()
      .from(creditReservations)
      .where(eq(creditReservations.chapterId, ch3.id));
    expect(refundedRows[0]?.status).toBe("refunded");

    const uploadRes = await handleUploadProjectDataset(
      new Request(`https://collate.app/api/projects/${projectId}/datasets`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: alice.cookie,
        },
        body: JSON.stringify({
          filename: "clinic_uptime.csv",
          csvContent: "region,uptime\nKano,96\nLagos,98\n",
        }),
      }),
      projectId,
      deps
    );
    expect(uploadRes.status).toBe(201);
    expect(storedCsv.size).toBe(1);

    const badUpload = await handleUploadProjectDataset(
      new Request(`https://collate.app/api/projects/${projectId}/datasets`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: alice.cookie,
        },
        body: JSON.stringify({ filename: "evil.exe", csvContent: "a,b\n1,2" }),
      }),
      projectId,
      deps
    );
    expect(badUpload.status).toBe(400);
  });
});
