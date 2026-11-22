import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { syncCitationRegistryForProject } from "@/db/queries/citations";
import { createWizardDraftProject } from "@/db/queries/wizard";
import { chapterVersions, projectMemory, sources } from "@/db/schema";
import {
  handleSignIn,
  handleSignUp,
  handleVerifyEmail,
  type HttpAuthDeps,
} from "@/lib/auth/http-handlers";
import type { EmailMessage, EmailSender } from "@/lib/email/mailer";
import {
  buildChapterNeedsAttentionEmail,
  buildChapterReadyEmail,
  buildPaymentReceiptEmail,
  buildProjectCompleteEmail,
  dispatchUserNotification,
} from "@/lib/email/notifications";
import {
  handleGetNotificationPrefs,
  handleUpdateNotificationPrefs,
} from "@/lib/email/prefs-handlers";
import type { R2ReadWriteBucket } from "@/lib/export/http-handlers";
import {
  handleGetChapterReader,
  handleSaveChapterLightEdit,
} from "@/lib/writing/chapter-reader-handlers";
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

describe("Phase 10 — Transactional Emails, Notification Preferences & Chapter Reader/Editor API", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  let sent: EmailMessage[];
  let authDeps: HttpAuthDeps;
  const now = new Date("2026-11-22T13:00:00.000Z");

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

  it("renders all 4 transactional email templates with safe HTML and respects notification preferences", async () => {
    const alice = await signUpUser("Alice", "alice.notif@uni.edu", "quiet cedar library desk");
    const initialSentCount = sent.length;

    const firstSend = await dispatchUserNotification(db, authDeps.mailer, {
      userId: alice.userId,
      kind: "chapter_ready",
      message: buildChapterReadyEmail({
        name: "Alice",
        projectTitle: "Solar Microgrids",
        chapterNumber: 1,
        chapterTitle: "Introduction",
        chapterUrl: "https://collate.app/projects/p1/chapters/c1",
        wordCount: 1200,
        pageCount: 4,
      }),
    });
    expect(firstSend.sent).toBe(true);
    expect(sent.length).toBe(initialSentCount + 1);
    expect(sent[sent.length - 1]?.text).toContain("https://collate.app/projects/p1/chapters/c1");

    const putPrefs = await handleUpdateNotificationPrefs(
      new Request("https://collate.app/api/account/notifications", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: alice.cookie,
        },
        body: JSON.stringify({
          emailChapterReady: false,
          emailNeedsAttention: true,
          emailProjectComplete: true,
          emailReceipts: true,
        }),
      }),
      authDeps
    );
    expect(putPrefs.status).toBe(200);

    const getPrefs = await handleGetNotificationPrefs(
      new Request("https://collate.app/api/account/notifications", {
        headers: { cookie: alice.cookie },
      }),
      authDeps
    );
    const prefsJson = (await getPrefs.json()) as {
      preferences: { emailChapterReady: boolean; emailReceipts: boolean };
    };
    expect(prefsJson.preferences.emailChapterReady).toBe(false);

    const skippedSend = await dispatchUserNotification(db, authDeps.mailer, {
      userId: alice.userId,
      kind: "chapter_ready",
      message: buildChapterReadyEmail({
        name: "Alice",
        projectTitle: "Solar Microgrids",
        chapterNumber: 2,
        chapterTitle: "Literature Review",
        chapterUrl: "https://collate.app/projects/p1/chapters/c2",
        wordCount: 2500,
        pageCount: 9,
      }),
    });
    expect(skippedSend.sent).toBe(false);
    expect(skippedSend.skippedByPreference).toBe(true);

    expect(
      buildChapterNeedsAttentionEmail({
        name: "Alice",
        projectTitle: "Solar <script>",
        chapterNumber: 1,
        chapterTitle: "Intro",
        projectUrl: "https://collate.app/projects/p1",
        reason: "Originality review needed",
      }).html
    ).not.toContain("<script>");

    expect(
      buildProjectCompleteEmail({
        name: "Alice",
        projectTitle: "Solar Microgrids",
        projectUrl: "https://collate.app/projects/p1",
      }).subject
    ).toContain("ready to download");

    expect(
      buildPaymentReceiptEmail({
        name: "Alice",
        amountFormatted: "NGN 15,000",
        creditsAdded: 60,
        reference: "pay_ref_001",
        accountUrl: "https://collate.app/account",
      }).text
    ).toContain("pay_ref_001");
  });

  it("loads chapter reader payload, saves light user edit as v2 into project_memory, and blocks other users", async () => {
    const alice = await signUpUser("Alice", "alice.edit@uni.edu", "warm archival oak cabinet");
    const bob = await signUpUser("Bob", "bob.edit@uni.edu", "steady coastal stone harbor");

    const draft = await createWizardDraftProject(db, alice.userId, "thesis", now);
    const projectId = draft.project.id;
    const ch1 = draft.chapters.find((c) => c.number === 1)!;

    await db.insert(sources).values({
      id: "src_r1",
      projectId,
      url: "https://doi.org/10.1000/r1",
      canonicalUrl: "https://doi.org/10.1000/r1",
      doi: "10.1000/r1",
      title: "Rural Clinic Power Uptime",
      normalizedTitle: "rural clinic power uptime",
      authorsJson: JSON.stringify(["Adaeze Okonkwo"]),
      year: 2024,
      venue: "Energy Policy",
      sourceType: "peer_reviewed",
      connectorName: "crossref",
      credibilityScore: 92,
      relevanceScore: 88,
      retrievedAt: now,
      createdAt: now,
    });
    await syncCitationRegistryForProject(db, projectId, now);

    const store = new Map<string, string>();
    const bucket: R2ReadWriteBucket = {
      async put(key, val) {
        store.set(key, String(val));
      },
      async get(key) {
        const text = store.get(key);
        if (text === undefined) return null;
        return {
          async text() {
            return text;
          },
          async arrayBuffer() {
            return new TextEncoder().encode(text).buffer;
          },
        };
      },
    };

    const v1Key = `chapters/${projectId}/${ch1.id}/v1.md`;
    await bucket.put(
      v1Key,
      "# Chapter 1: Introduction\n\n## 1.1 Background\n\nSolar clinics improved uptime [@okonkwo2024]."
    );
    await db.insert(chapterVersions).values({
      id: "ver_r1",
      chapterId: ch1.id,
      version: 1,
      contentR2Key: v1Key,
      wordCount: 14,
      pageCount: 1,
      createdBy: "ai",
      createdAt: now,
    });

    const readerDeps = { ...authDeps, bucket };

    const bobGet = await handleGetChapterReader(
      new Request(`https://collate.app/api/projects/${projectId}/chapters/${ch1.id}`, {
        headers: { cookie: bob.cookie },
      }),
      projectId,
      ch1.id,
      readerDeps
    );
    expect(bobGet.status).toBe(404);

    const getRes = await handleGetChapterReader(
      new Request(`https://collate.app/api/projects/${projectId}/chapters/${ch1.id}`, {
        headers: { cookie: alice.cookie },
      }),
      projectId,
      ch1.id,
      readerDeps
    );
    expect(getRes.status).toBe(200);
    const readJson = (await getRes.json()) as {
      headings: Array<{ text: string }>;
      citations: Array<{ citeKey: string; doi: string | null }>;
    };
    expect(readJson.headings[0]?.text).toBe("1.1 Background");
    expect(readJson.citations[0]?.citeKey).toBe("okonkwo2024");
    expect(readJson.citations[0]?.doi).toBe("10.1000/r1");

    const editRes = await handleSaveChapterLightEdit(
      new Request(`https://collate.app/api/projects/${projectId}/chapters/${ch1.id}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: alice.cookie,
        },
        body: JSON.stringify({
          markdown:
            "# Chapter 1: Introduction\n\n## 1.1 Background\n\nAuthor refined paragraph citing northern clinic reliability [@okonkwo2024].",
          editSummary: "Clarified regional scope",
        }),
      }),
      projectId,
      ch1.id,
      readerDeps
    );
    expect(editRes.status).toBe(201);
    const editJson = (await editRes.json()) as { version: { version: number; createdBy: string } };
    expect(editJson.version.version).toBe(2);
    expect(editJson.version.createdBy).toBe("user");

    const [mem] = await db
      .select()
      .from(projectMemory)
      .where(eq(projectMemory.projectId, projectId));
    expect(mem?.chapterSummariesJson).toContain("Clarified regional scope");
  });
});
