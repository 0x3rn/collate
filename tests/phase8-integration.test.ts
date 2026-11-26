import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { createProjectForUser } from "@/db/queries/projects";
import {
  chapterFingerprints,
  chapters,
  originalityReports,
  sections,
  sourcePassages,
  sources,
  users,
} from "@/db/schema";
import type { CallLLMContext } from "@/lib/ai/call-llm";
import {
  handleSignIn,
  handleSignUp,
  handleVerifyEmail,
  type HttpAuthDeps,
} from "@/lib/auth/http-handlers";
import type { EmailMessage, EmailSender } from "@/lib/email/mailer";
import { handleGetProjectIntegrity } from "@/lib/originality/http-handlers";
import { runWriteChapterOrchestration } from "@/lib/writing/chapter-orchestrator";
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

describe("Phase 8 — NN-6 Originality Gate wired into WriteChapterWorkflow & Integrity API", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  let sent: EmailMessage[];
  let authDeps: HttpAuthDeps;
  const now = new Date("2026-11-22T11:00:00.000Z");

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

  it("blocks a chapter from becoming 'ready' (marks needs_attention) if copied text fails NN-6 after max rewrites", async () => {
    await db.insert(users).values({
      id: "usr_nn6",
      email: "nn6@uni.edu",
      emailVerified: true,
      name: "NN6 Tester",
      creditsBalance: 10,
      createdAt: now,
      updatedAt: now,
    });
    await createProjectForUser(db, {
      id: "prj_nn6",
      userId: "usr_nn6",
      type: "research",
      title: "Grid Storage Reliability",
      now,
    });
    await db.insert(sources).values({
      id: "src_nn6",
      projectId: "prj_nn6",
      url: "https://doi.org/10.1000/nn6",
      canonicalUrl: "https://doi.org/10.1000/nn6",
      doi: "10.1000/nn6",
      title: "Grid Storage Paper",
      normalizedTitle: "grid storage paper",
      authorsJson: JSON.stringify(["Adaeze Okonkwo"]),
      year: 2024,
      sourceType: "peer_reviewed",
      connectorName: "crossref",
      credibilityScore: 90,
      relevanceScore: 90,
      retrievedAt: now,
      createdAt: now,
    });

    const verbatimSource =
      "Lithium iron phosphate battery arrays dramatically improve rural clinic voltage stability across sub-Saharan distribution feeders.";
    await db.insert(sourcePassages).values({
      id: "psg_nn6",
      sourceId: "src_nn6",
      projectId: "prj_nn6",
      passageIndex: 0,
      text: verbatimSource,
      location: "section_1",
      tokenCount: 18,
      createdAt: now,
    });

    await db.insert(chapters).values({
      id: "chp_nn6",
      projectId: "prj_nn6",
      number: 1,
      title: "Introduction",
      chapterType: "introduction",
      pageBudget: 1,
      wordBudget: 200,
      isAutoReferences: false,
      status: "not_started",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sections).values({
      id: "sec_nn6",
      chapterId: "chp_nn6",
      orderIndex: 1,
      heading: "Background",
      wordBudget: 200,
      status: "not_started",
      createdAt: now,
      updatedAt: now,
    });

    const llmCtx: CallLLMContext = {
      db,
      env: {
        CLOUDFLARE_ACCOUNT_ID: "acct_1",
        CLOUDFLARE_AI_GATEWAY_ID: "gw_1",
        ANTHROPIC_API_KEY: "sk-ant-test",
        APP_ENV: "dev",
      },
      fetchFn: async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { system?: string };
        if (body.system?.includes("fact-checker")) {
          return Response.json({
            id: "m_v",
            model: "claude-sonnet-4-5",
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  results: [{ index: 0, verdict: "supported", notes: "ok" }],
                }),
              },
            ],
            usage: { input_tokens: 50, output_tokens: 30 },
          });
        }
        if (body.system?.includes("Summarize the chapter")) {
          return Response.json({
            id: "m_s",
            model: "claude-haiku-4-5",
            stop_reason: "end_turn",
            content: [
              { type: "text", text: JSON.stringify({ summary: "Summary.", glossaryTerms: [] }) },
            ],
            usage: { input_tokens: 50, output_tokens: 30 },
          });
        }
        if (body.system?.includes("integrity editor")) {
          return Response.json({
            id: "m_r",
            model: "claude-sonnet-4-5",
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: `# Chapter 1: Introduction\n\n${verbatimSource} [@okonkwo2024]`,
              },
            ],
            usage: { input_tokens: 50, output_tokens: 50 },
          });
        }
        return Response.json({
          id: "m_d",
          model: "claude-sonnet-4-5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                prose: `${verbatimSource} [@okonkwo2024]`,
                claims: [{ text: verbatimSource, citeKey: "okonkwo2024", passageId: "psg_nn6" }],
              }),
            },
          ],
          usage: { input_tokens: 80, output_tokens: 80 },
        });
      },
    };

    const out = await runWriteChapterOrchestration(
      { runId: "run_nn6", projectId: "prj_nn6", chapterId: "chp_nn6" },
      {
        loadContext: (fn) => fn(),
        draftSection: (_i, fn) => fn(),
        assembleAndFinalize: (fn) => fn(),
      },
      {
        db,
        bucket: { async put() {} },
        llmCtx,
        measurePagesFn: async () => 1,
        nowFn: () => now,
      }
    );

    expect(out.status).toBe("needs_attention");
    const [rep] = await db
      .select()
      .from(originalityReports)
      .where(eq(originalityReports.chapterId, "chp_nn6"));
    expect(rep?.passed).toBe(false);
    expect(rep?.overlapScore).toBeGreaterThan(12);

    const fps = await db
      .select()
      .from(chapterFingerprints)
      .where(eq(chapterFingerprints.projectId, "prj_nn6"));
    expect(fps).toHaveLength(1);
  });

  it("serves writing-process log, AI disclosure, and similarity reports to owner and 404 to others", async () => {
    const alice = await signUpUser("Alice", "alice.int@uni.edu", "quiet cedar library table");
    const bob = await signUpUser("Bob", "bob.int@uni.edu", "steady coastal stone pier");

    await createProjectForUser(db, {
      id: "prj_alice_int",
      userId: alice.userId,
      type: "thesis",
      title: "Clean Energy Access",
      now,
    });

    const aliceRes = await handleGetProjectIntegrity(
      new Request("https://collate.app/api/projects/prj_alice_int/integrity", {
        headers: { cookie: alice.cookie },
      }),
      "prj_alice_int",
      authDeps
    );
    expect(aliceRes.status).toBe(200);
    const data = (await aliceRes.json()) as {
      ok: boolean;
      disclosureStatement: string;
      processLog: { project: { title: string } };
    };
    expect(data.ok).toBe(true);
    expect(data.processLog.project.title).toBe("Clean Energy Access");
    expect(data.disclosureStatement).toContain("Clean Energy Access");

    const txtRes = await handleGetProjectIntegrity(
      new Request("https://collate.app/api/projects/prj_alice_int/integrity?format=txt", {
        headers: { cookie: alice.cookie },
      }),
      "prj_alice_int",
      authDeps
    );
    expect(txtRes.status).toBe(200);
    expect(txtRes.headers.get("content-type")).toContain("text/plain");
    expect(txtRes.headers.get("content-disposition")).toContain(
      "clean-energy-access-writing-log.txt"
    );
    const txtBody = await txtRes.text();
    expect(txtBody).toContain("WRITING PROCESS LOG");
    expect(txtBody).toContain("Clean Energy Access");
    expect(txtBody).toContain("AI-Use Disclosure Statement");

    const mdRes = await handleGetProjectIntegrity(
      new Request("https://collate.app/api/projects/prj_alice_int/integrity?format=md", {
        headers: { cookie: alice.cookie },
      }),
      "prj_alice_int",
      authDeps
    );
    expect(mdRes.status).toBe(200);
    expect(mdRes.headers.get("content-type")).toContain("text/markdown");
    expect(mdRes.headers.get("content-disposition")).toContain(
      "clean-energy-access-writing-log.md"
    );
    const mdBody = await mdRes.text();
    expect(mdBody).toContain("# Writing Process Log");
    expect(mdBody).toContain("## 1. Research and Source Verification History");

    const pdfRes = await handleGetProjectIntegrity(
      new Request("https://collate.app/api/projects/prj_alice_int/integrity?format=pdf", {
        headers: { cookie: alice.cookie },
      }),
      "prj_alice_int",
      authDeps
    );
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get("content-type")).toBe("application/pdf");
    expect(pdfRes.headers.get("content-disposition")).toContain(
      "clean-energy-access-writing-log.pdf"
    );
    const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());
    expect(pdfBytes.byteLength).toBeGreaterThan(500);
    expect(String.fromCharCode(...pdfBytes.slice(0, 5))).toBe("%PDF-");

    const bobRes = await handleGetProjectIntegrity(
      new Request("https://collate.app/api/projects/prj_alice_int/integrity", {
        headers: { cookie: bob.cookie },
      }),
      "prj_alice_int",
      authDeps
    );
    expect(bobRes.status).toBe(404);
  });
});
