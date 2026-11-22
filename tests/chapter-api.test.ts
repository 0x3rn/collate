import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { createWizardDraftProject } from "@/db/queries/wizard";
import { chapters } from "@/db/schema";
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

    let launchCount = 0;
    const launcher = {
      async create() {
        launchCount++;
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
