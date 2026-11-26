import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { createWizardDraftProject, saveWizardStepForUser } from "@/db/queries/wizard";
import {
  chapters,
  creditReservations,
  originalityReports,
  projects,
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
import {
  handleCreateExport,
  handleDownloadExport,
  type R2ReadWriteBucket,
} from "@/lib/export/http-handlers";
import type { BrowserRunPdfBinding } from "@/lib/pdf/render-pdf";
import {
  runWriteAssignmentOrchestration,
  type WriteChapterPayload,
} from "@/lib/writing/chapter-orchestrator";
import { handleStartAssignment } from "@/lib/writing/http-handlers";
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
  if (!match?.[1]) throw new Error("No token found");
  return decodeURIComponent(match[1]);
}

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595.28, 841.89]);
  return doc.save();
}

describe("Assignment Mode End-to-End — Start API, Per-Question Drafting, Billing & PDF/DOCX Export", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  let sent: EmailMessage[];
  let authDeps: HttpAuthDeps;
  const now = new Date("2026-11-23T18:00:00.000Z");

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

  it("enforces guards, reserves credits, drafts each question from its own evidence, captures credits, and exports PDF + DOCX", async () => {
    const alice = await signUpCookie("Alice Assign", "alice.a@uni.edu", "quiet maple desk folio");
    const bob = await signUpCookie("Bob Assign", "bob.a@uni.edu", "steady harbor cedar roof");

    // Non-assignment project -> 400
    const thesisDraft = await createWizardDraftProject(db, alice.userId, "thesis", now);
    const wrongTypeRes = await handleStartAssignment(
      new Request(`https://collate.app/api/projects/${thesisDraft.project.id}/assignment/start`, {
        method: "POST",
        headers: { origin: "https://collate.app", cookie: alice.cookie },
      }),
      thesisDraft.project.id,
      authDeps
    );
    expect(wrongTypeRes.status).toBe(400);

    // Create real 2-question assignment
    const draft = await createWizardDraftProject(db, alice.userId, "assignment", now);
    const projectId = draft.project.id;

    // 0 questions -> 400
    const emptyQRes = await handleStartAssignment(
      new Request(`https://collate.app/api/projects/${projectId}/assignment/start`, {
        method: "POST",
        headers: { origin: "https://collate.app", cookie: alice.cookie },
      }),
      projectId,
      authDeps
    );
    expect(emptyQRes.status).toBe(400);

    const savedQ = await saveWizardStepForUser(
      db,
      alice.userId,
      projectId,
      {
        step: 2,
        title: "Public Finance Seminar Set",
        questions: [
          "Analyze the empirical impact of carbon taxation on industrial emissions.",
          "Evaluate how central bank reserve requirements influence commercial lending.",
        ],
      },
      now
    );
    await saveWizardStepForUser(db, alice.userId, projectId, { step: 4, targetPages: 8 }, now);

    const q1 = savedQ.questions[0]!;
    const q2 = savedQ.questions[1]!;

    // Bob cannot start Alice's assignment -> 404
    const bobRes = await handleStartAssignment(
      new Request(`https://collate.app/api/projects/${projectId}/assignment/start`, {
        method: "POST",
        headers: { origin: "https://collate.app", cookie: bob.cookie },
      }),
      projectId,
      authDeps
    );
    expect(bobRes.status).toBe(404);

    // Alice with 0 credits -> 402 and no stray chapter row left behind
    const noCredsRes = await handleStartAssignment(
      new Request(`https://collate.app/api/projects/${projectId}/assignment/start`, {
        method: "POST",
        headers: { origin: "https://collate.app", cookie: alice.cookie },
      }),
      projectId,
      authDeps
    );
    expect(noCredsRes.status).toBe(402);
    expect(await db.select().from(chapters).where(eq(chapters.projectId, projectId))).toHaveLength(
      0
    );

    // Seed distinct question-scoped sources and passages
    await db.insert(sources).values([
      {
        id: "src_q1",
        projectId,
        questionId: q1.id,
        url: "https://doi.org/10.1000/carbon-tax",
        canonicalUrl: "https://doi.org/10.1000/carbon-tax",
        doi: "10.1000/carbon-tax",
        title: "Carbon Taxation and Industrial Emissions Abatement",
        normalizedTitle: "carbon taxation and industrial emissions abatement",
        authorsJson: JSON.stringify(["Adaeze Okonkwo"]),
        year: 2024,
        venue: "Energy Economics",
        sourceType: "peer_reviewed",
        connectorName: "crossref",
        credibilityScore: 92,
        relevanceScore: 90,
        accessStatus: "full_text",
        fetchStatus: "fetched",
        retrievedAt: now,
        createdAt: now,
      },
      {
        id: "src_q2",
        projectId,
        questionId: q2.id,
        url: "https://doi.org/10.1000/central-bank",
        canonicalUrl: "https://doi.org/10.1000/central-bank",
        doi: "10.1000/central-bank",
        title: "Reserve Requirements and Commercial Bank Credit Supply",
        normalizedTitle: "reserve requirements and commercial bank credit supply",
        authorsJson: JSON.stringify(["Bamidele Mensah"]),
        year: 2023,
        venue: "Journal of Monetary Economics",
        sourceType: "peer_reviewed",
        connectorName: "crossref",
        credibilityScore: 91,
        relevanceScore: 89,
        accessStatus: "full_text",
        fetchStatus: "fetched",
        retrievedAt: now,
        createdAt: now,
      },
    ]);
    await db.insert(sourcePassages).values([
      {
        id: "psg_q1",
        sourceId: "src_q1",
        projectId,
        passageIndex: 0,
        text: "Carbon taxation lowered manufacturing CO2 intensity by 14 percent across European steel facilities.",
        location: "section_1",
        tokenCount: 15,
        createdAt: now,
      },
      {
        id: "psg_q2",
        sourceId: "src_q2",
        projectId,
        passageIndex: 0,
        text: "Higher statutory reserve requirements tightened domestic SME bank credit expansion over two quarters.",
        location: "section_1",
        tokenCount: 14,
        createdAt: now,
      },
    ]);

    // Grant 20 credits and start assignment
    await db.update(users).set({ creditsBalance: 20 }).where(eq(users.id, alice.userId));
    const launched: WriteChapterPayload[] = [];
    const startRes = await handleStartAssignment(
      new Request(`https://collate.app/api/projects/${projectId}/assignment/start`, {
        method: "POST",
        headers: { origin: "https://collate.app", cookie: alice.cookie },
      }),
      projectId,
      {
        ...authDeps,
        workflowLauncher: {
          async create(opts) {
            launched.push(opts.params);
            return { id: "wf_asgn_1" };
          },
        },
      }
    );
    expect(startRes.status).toBe(202);
    expect(launched).toHaveLength(1);
    expect(launched[0]?.mode).toBe("assignment");
    expect(launched[0]?.reservationId).toBeTruthy();

    // Double-click returns alreadyRunning: true without double-charging
    const dupRes = await handleStartAssignment(
      new Request(`https://collate.app/api/projects/${projectId}/assignment/start`, {
        method: "POST",
        headers: { origin: "https://collate.app", cookie: alice.cookie },
      }),
      projectId,
      authDeps
    );
    expect(dupRes.status).toBe(202);
    expect(((await dupRes.json()) as { alreadyRunning: boolean }).alreadyRunning).toBe(true);
    const [aliceAfterReserve] = await db.select().from(users).where(eq(users.id, alice.userId));
    expect(aliceAfterReserve?.creditsBalance).toBe(12); // 20 - 8 target pages

    // Execute assignment orchestration
    const store = new Map<string, Uint8Array>();
    const bucket: R2ReadWriteBucket = {
      async put(key, val) {
        if (typeof val === "string") store.set(key, new TextEncoder().encode(val));
        else if (val instanceof Uint8Array) store.set(key, val);
        else if (val instanceof ArrayBuffer) store.set(key, new Uint8Array(val));
      },
      async get(key) {
        const bytes = store.get(key);
        if (!bytes) return null;
        return {
          async text() {
            return new TextDecoder().decode(bytes);
          },
          async arrayBuffer() {
            const copy = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(copy).set(bytes);
            return copy;
          },
        };
      },
    };

    const promptsSeen: string[] = [];
    const llmCtx: CallLLMContext = {
      db,
      env: {
        CLOUDFLARE_ACCOUNT_ID: "acct_1",
        CLOUDFLARE_AI_GATEWAY_ID: "gw_1",
        ANTHROPIC_API_KEY: "sk-ant-test",
        APP_ENV: "dev",
      },
      fetchFn: async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          system?: string;
          messages?: Array<{ content: string }>;
        };
        const userText = body.messages?.[0]?.content ?? "";
        if (body.system?.includes("fact-checker")) {
          return Response.json({
            id: "mv",
            model: "claude-sonnet-4-5",
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  results: [{ index: 0, verdict: "supported", notes: "Verified" }],
                }),
              },
            ],
            usage: { input_tokens: 40, output_tokens: 20 },
          });
        }
        promptsSeen.push(userText);
        const match = userText.match(/\[PASSAGE:(psg_[^\s|]+)\s*\|\s*CITE:@([^\s|]+)/);
        const psgId = match?.[1] ?? "psg_q1";
        const citeKey = match?.[2] ?? "okonkwo2024";
        const prose =
          psgId === "psg_q1"
            ? `Empirical industrial reviews indicate measurable carbon intensity drops following fiscal pricing reforms [@${citeKey}].`
            : `Monetary policy studies observe moderated credit issuance after central banks tighten liquidity ratios [@${citeKey}].`;
        return Response.json({
          id: "md",
          model: "claude-sonnet-4-5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                prose,
                claims: [{ text: prose, citeKey, passageId: psgId }],
              }),
            },
          ],
          usage: { input_tokens: 60, output_tokens: 50 },
        });
      },
    };

    const browser: BrowserRunPdfBinding = {
      async quickAction() {
        const pdf = await makePdf(2);
        return new Response(new Uint8Array(pdf), { status: 200 });
      },
    };

    let completedEventReceived = false;
    const result = await runWriteAssignmentOrchestration(
      {
        runId: launched[0]!.runId,
        projectId,
        chapterId: launched[0]!.chapterId,
        reservationId: launched[0]!.reservationId,
      },
      {
        db,
        bucket,
        llmCtx,
        browser,
        nowFn: () => now,
        onChapterReady: async (info) => {
          completedEventReceived = info.allChaptersComplete && info.pageCount === 2;
        },
      }
    );

    expect(result.status).toBe("ready");
    expect(result.questionCount).toBe(2);
    expect(result.pageCount).toBe(2);
    expect(completedEventReceived).toBe(true);

    // Verify Q1 prompt only received Q1's passage and Q2 prompt only received Q2's passage
    expect(promptsSeen[0]).toContain("psg_q1");
    expect(promptsSeen[0]).not.toContain("psg_q2");
    expect(promptsSeen[1]).toContain("psg_q2");
    expect(promptsSeen[1]).not.toContain("psg_q1");

    // Reservation captured & project completed & originality report stored
    const [resRow] = await db
      .select()
      .from(creditReservations)
      .where(eq(creditReservations.id, launched[0]!.reservationId!));
    expect(resRow?.status).toBe("captured");

    const [projRow] = await db.select().from(projects).where(eq(projects.id, projectId));
    expect(projRow?.status).toBe("completed");

    const origRows = await db
      .select()
      .from(originalityReports)
      .where(eq(originalityReports.projectId, projectId));
    expect(origRows).toHaveLength(1);
    expect(origRows[0]?.passed).toBe(true);

    // Export finished assignment as both PDF and DOCX via the real export API
    const exportDeps = { ...authDeps, bucket, browser, signingSecret: "test-secret" };

    const pdfExpRes = await handleCreateExport(
      new Request(`https://collate.app/api/projects/${projectId}/exports`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: alice.cookie,
        },
        body: JSON.stringify({ scope: "full", format: "pdf" }),
      }),
      projectId,
      exportDeps
    );
    expect(pdfExpRes.status).toBe(201);
    const pdfExpJson = (await pdfExpRes.json()) as {
      export: { id: string; downloadUrl: string; pageCount: number };
    };
    expect(pdfExpJson.export.pageCount).toBeGreaterThanOrEqual(2);

    const dlPdf = await handleDownloadExport(
      new Request(`https://collate.app${pdfExpJson.export.downloadUrl}`, {
        headers: { cookie: alice.cookie },
      }),
      projectId,
      pdfExpJson.export.id,
      exportDeps
    );
    expect(dlPdf.status).toBe(200);
    expect(dlPdf.headers.get("content-type")).toBe("application/pdf");

    const docxExpRes = await handleCreateExport(
      new Request(`https://collate.app/api/projects/${projectId}/exports`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: alice.cookie,
        },
        body: JSON.stringify({ scope: "full", format: "docx" }),
      }),
      projectId,
      exportDeps
    );
    expect(docxExpRes.status).toBe(201);
  });
});
