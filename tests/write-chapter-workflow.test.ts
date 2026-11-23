import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { createProjectForUser } from "@/db/queries/projects";
import {
  chapters,
  chapterVersions,
  citations,
  claims,
  creditReservations,
  projectMemory,
  projects,
  sections,
  sourcePassages,
  sources,
  users,
} from "@/db/schema";
import type { CallLLMContext } from "@/lib/ai/call-llm";
import { reserveChapterCredits } from "@/lib/billing/ledger";
import type { BrowserRunPdfBinding, R2WritableBucket } from "@/lib/pdf/render-pdf";
import { runWriteChapterOrchestration } from "@/lib/writing/chapter-orchestrator";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

describe("Phase 7 — WriteChapterWorkflow (resumability, claim rewriting, 20-claim traceability & NN-4)", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  const now = new Date("2026-11-22T08:00:00.000Z");

  beforeEach(async () => {
    d1Ctx = createInMemoryD1();
    d1Ctx.applyMigrations();
    db = createDb(d1Ctx.d1);

    await db.insert(users).values({
      id: "usr_p7",
      email: "p7@uni.edu",
      emailVerified: true,
      name: "Chapter Author",
      creditsBalance: 30,
      createdAt: now,
      updatedAt: now,
    });

    await createProjectForUser(db, {
      id: "prj_p7",
      userId: "usr_p7",
      type: "thesis",
      title: "Solar Microgrid Reliability in Rural Clinics",
      targetPages: 60,
      now,
    });

    for (let s = 1; s <= 5; s++) {
      await db.insert(sources).values({
        id: `src_${s}`,
        projectId: "prj_p7",
        url: `https://doi.org/10.1016/j.clinic.2024.${s}`,
        canonicalUrl: `https://doi.org/10.1016/j.clinic.2024.${s}`,
        doi: `10.1016/j.clinic.2024.${s}`,
        title: `Empirical Study ${s} on Solar Microgrid Rural Clinic Reliability`,
        normalizedTitle: `empirical study ${s} on solar microgrid rural clinic reliability`,
        authorsJson: JSON.stringify([`Author${s} Okonkwo`]),
        year: 2024,
        sourceType: "peer_reviewed",
        connectorName: "crossref",
        credibilityScore: 90,
        relevanceScore: 88,
        accessStatus: "full_text",
        fetchStatus: "fetched",
        retrievedAt: now,
        createdAt: now,
      });

      for (let p = 0; p < 4; p++) {
        await db.insert(sourcePassages).values({
          id: `psg_${s}_${p}`,
          sourceId: `src_${s}`,
          projectId: "prj_p7",
          passageIndex: p,
          text: `Verified empirical evidence ${s}-${p}: solar microgrids raised clinic uptime to ${90 + p}% in rural clinics.`,
          location: `section_${p + 1}`,
          tokenCount: 20,
          createdAt: now,
        });
      }
    }
  });

  afterEach(() => {
    d1Ctx.close();
  });

  it("resumes after mid-chapter crash without re-drafting Section 1 and traces 20 verified claims to real passages", async () => {
    await db.insert(chapters).values({
      id: "chp_1",
      projectId: "prj_p7",
      number: 1,
      title: "Introduction",
      chapterType: "introduction",
      pageBudget: 2,
      wordBudget: 550,
      isAutoReferences: false,
      status: "not_started",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(sections).values([
      {
        id: "sec_1",
        chapterId: "chp_1",
        orderIndex: 1,
        heading: "Background of the study",
        wordBudget: 275,
        status: "not_started",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "sec_2",
        chapterId: "chp_1",
        orderIndex: 2,
        heading: "Statement of the problem",
        wordBudget: 275,
        status: "not_started",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const r2Files = new Map<string, string>();
    const bucket: R2WritableBucket = {
      async put(key, value) {
        r2Files.set(key, String(value));
      },
    };

    let section1DraftCalls = 0;
    let firstVerifySeen = false;
    let shouldCrashBeforeSec2 = true;

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
        const systemText = body.system ?? "";

        if (systemText.includes("fact-checker")) {
          const claimMatches = userText.match(/\[\d+\] CLAIM:/g) ?? [];
          const results = claimMatches.map((_, idx) => {
            if (!firstVerifySeen && idx === 0) {
              return { index: idx, verdict: "unsupported", notes: "Overstated percentage" };
            }
            return { index: idx, verdict: "supported", notes: "Matches passage directly" };
          });
          firstVerifySeen = true;
          return Response.json({
            id: "msg_ver",
            model: "claude-sonnet-4-5",
            stop_reason: "end_turn",
            content: [{ type: "text", text: JSON.stringify({ results }) }],
            usage: { input_tokens: 300, output_tokens: 150 },
          });
        }

        if (systemText.includes("Summarize the chapter")) {
          return Response.json({
            id: "msg_mem",
            model: "claude-haiku-4-5",
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  summary:
                    "Chapter 1 establishes rural clinic power gaps and solar microgrid evidence.",
                  glossaryTerms: [
                    { term: "Microgrid", definition: "Localized renewable power system." },
                  ],
                }),
              },
            ],
            usage: { input_tokens: 200, output_tokens: 80 },
          });
        }

        if (
          userText.includes("Background of the study") &&
          !userText.includes("flagged these claims")
        ) {
          section1DraftCalls++;
        }

        const passageRefs = Array.from(
          userText.matchAll(/\[PASSAGE:(psg_[^\s|]+)\s*\|\s*CITE:@([^\s|]+)/g)
        );
        const usableRefs =
          passageRefs.length > 0
            ? passageRefs.map((m) => ({ passageId: m[1]!, citeKey: m[2]! }))
            : [{ passageId: "psg_1_0", citeKey: "okonkwo2024" }];

        const tenClaims = Array.from({ length: 10 }, (_, idx) => {
          const ref = usableRefs[idx % usableRefs.length]!;
          return {
            text: `Verified factual finding ${idx + 1} shows solar microgrids improve rural clinic reliability [@${ref.citeKey}].`,
            citeKey: ref.citeKey,
            passageId: ref.passageId,
          };
        });

        const prose = tenClaims
          .map(
            (c) =>
              `${c.text} Empirical observations confirm consistent cold-chain performance across field clinics.`
          )
          .join(" ");

        return Response.json({
          id: "msg_draft",
          model: "claude-sonnet-4-5",
          stop_reason: "end_turn",
          content: [{ type: "text", text: JSON.stringify({ prose, claims: tenClaims }) }],
          usage: { input_tokens: 500, output_tokens: 400 },
        });
      },
    };

    const steps = {
      loadContext: <T>(fn: () => Promise<T>) => fn(),
      draftSection: async <T>(idx: number, fn: () => Promise<T>) => {
        if (idx === 1 && shouldCrashBeforeSec2) {
          throw new Error("Simulated Worker kill/redeploy mid-chapter");
        }
        return fn();
      },
      assembleAndFinalize: <T>(fn: () => Promise<T>) => fn(),
    };

    await expect(
      runWriteChapterOrchestration(
        { runId: "run_ch1", projectId: "prj_p7", chapterId: "chp_1" },
        steps,
        { db, bucket, llmCtx, nowFn: () => now }
      )
    ).rejects.toThrow("Simulated Worker kill");

    expect(section1DraftCalls).toBe(1);

    shouldCrashBeforeSec2 = false;
    const finished = await runWriteChapterOrchestration(
      { runId: "run_ch1", projectId: "prj_p7", chapterId: "chp_1" },
      steps,
      { db, bucket, llmCtx, nowFn: () => now }
    );

    expect(finished.status).toBe("ready");
    expect(finished.version).toBe(1);
    expect(section1DraftCalls).toBe(1);
    expect(r2Files.has(finished.contentR2Key)).toBe(true);

    const savedClaims = await db.select().from(claims).where(eq(claims.chapterId, "chp_1"));
    expect(savedClaims).toHaveLength(20);
    for (const clm of savedClaims) {
      expect(clm.verified).toBe(true);
      expect(clm.citationId).toBeTruthy();
      expect(clm.passageId).toBeTruthy();
      const [psg] = await db
        .select()
        .from(sourcePassages)
        .where(eq(sourcePassages.id, clm.passageId!));
      expect(psg).toBeDefined();
    }

    const [mem] = await db
      .select()
      .from(projectMemory)
      .where(eq(projectMemory.projectId, "prj_p7"));
    expect(mem?.outlineLocked).toBe(true);
    expect(mem?.chapterSummariesJson).toContain("Chapter 1");
    expect(mem?.glossaryJson).toContain("Microgrid");
  });

  it("generates a clearly labelled NN-4 Results framework when no empirical dataset is attached", async () => {
    await db.insert(chapters).values({
      id: "chp_results",
      projectId: "prj_p7",
      number: 4,
      title: "Results and Findings",
      chapterType: "results",
      pageBudget: 5,
      wordBudget: 1375,
      isAutoReferences: false,
      status: "not_started",
      createdAt: now,
      updatedAt: now,
    });

    const r2Files = new Map<string, string>();
    let llmWasCalled = false;
    const llmCtx: CallLLMContext = {
      db,
      env: {
        CLOUDFLARE_ACCOUNT_ID: "acct_1",
        CLOUDFLARE_AI_GATEWAY_ID: "gw_1",
        ANTHROPIC_API_KEY: "sk-ant-test",
        APP_ENV: "dev",
      },
      fetchFn: async () => {
        llmWasCalled = true;
        throw new Error("LLM should not fabricate Results when no dataset exists");
      },
    };

    const res = await runWriteChapterOrchestration(
      { runId: "run_ch4_nn4", projectId: "prj_p7", chapterId: "chp_results" },
      {
        loadContext: (fn) => fn(),
        draftSection: (_i, fn) => fn(),
        assembleAndFinalize: (fn) => fn(),
      },
      {
        db,
        bucket: {
          async put(key, value) {
            r2Files.set(key, String(value));
          },
        },
        llmCtx,
        nowFn: () => now,
      }
    );

    expect(llmWasCalled).toBe(false);
    expect(res.status).toBe("ready");
    const savedMd = r2Files.get(res.contentR2Key) ?? "";
    expect(savedMd).toContain("Rule NN-4");
    expect(savedMd).toContain("[ADD: Verified value]");

    const versions = await db
      .select()
      .from(chapterVersions)
      .where(eq(chapterVersions.chapterId, "chp_results"));
    expect(versions).toHaveLength(1);
  });

  it("verifies DOIs before drafting and excludes fake-DOI sources from retrieval and claims (NN-2)", async () => {
    await db.insert(sources).values({
      id: "src_fake_doi",
      projectId: "prj_p7",
      url: "https://doi.org/10.9999/hallucinated-999",
      canonicalUrl: "https://doi.org/10.9999/hallucinated-999",
      doi: "10.9999/hallucinated-999",
      title: "Invented Fake Study on Solar Microgrid Reliability",
      normalizedTitle: "invented fake study on solar microgrid reliability",
      authorsJson: JSON.stringify(["Faker Author"]),
      year: 2025,
      sourceType: "peer_reviewed",
      connectorName: "web",
      credibilityScore: 95,
      relevanceScore: 95,
      accessStatus: "full_text",
      fetchStatus: "fetched",
      retrievedAt: now,
      createdAt: now,
    });
    await db.insert(sourcePassages).values({
      id: "psg_fake_doi",
      sourceId: "src_fake_doi",
      projectId: "prj_p7",
      passageIndex: 0,
      text: "Fake passage that must never be cited because its DOI resolves to HTTP 404.",
      location: "section_1",
      tokenCount: 15,
      createdAt: now,
    });

    await db.insert(chapters).values({
      id: "chp_doi_gate",
      projectId: "prj_p7",
      number: 1,
      title: "Introduction",
      chapterType: "introduction",
      pageBudget: 1,
      wordBudget: 250,
      isAutoReferences: false,
      status: "not_started",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sections).values({
      id: "sec_doi_gate",
      chapterId: "chp_doi_gate",
      orderIndex: 1,
      heading: "Background",
      wordBudget: 250,
      status: "not_started",
      createdAt: now,
      updatedAt: now,
    });

    const seenDraftPrompts: string[] = [];
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
        if (body.system?.includes("Summarize the chapter")) {
          return Response.json({
            id: "mm",
            model: "claude-haiku-4-5",
            stop_reason: "end_turn",
            content: [
              { type: "text", text: JSON.stringify({ summary: "Summary.", glossaryTerms: [] }) },
            ],
            usage: { input_tokens: 30, output_tokens: 20 },
          });
        }
        seenDraftPrompts.push(userText);
        const match = userText.match(/\[PASSAGE:(psg_[^\s|]+)\s*\|\s*CITE:@([^\s|]+)/);
        const psgId = match?.[1] ?? "psg_1_0";
        const citeKey = match?.[2] ?? "okonkwo2024";
        const prose = `Independent empirical analysis demonstrates improved rural clinic reliability using verified solar microgrid records [@${citeKey}].`;
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

    const citationFetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("hallucinated-999")) {
        return new Response("Not found", { status: 404 });
      }
      const match = url.match(/j\.clinic\.2024\.(\d+)/);
      const num = match?.[1] ?? "1";
      return Response.json({
        message: {
          title: [`Empirical Study ${num} on Solar Microgrid Rural Clinic Reliability`],
        },
      });
    };

    const res = await runWriteChapterOrchestration(
      { runId: "run_doi_gate", projectId: "prj_p7", chapterId: "chp_doi_gate" },
      {
        loadContext: (fn) => fn(),
        draftSection: (_i, fn) => fn(),
        assembleAndFinalize: (fn) => fn(),
      },
      {
        db,
        bucket: { async put() {} },
        llmCtx,
        citationFetchFn,
        measurePagesFn: async () => 1,
        nowFn: () => now,
      }
    );

    expect(res.status).toBe("ready");
    expect(seenDraftPrompts.join("\n")).not.toContain("psg_fake_doi");
    expect(seenDraftPrompts.join("\n")).not.toContain("author2025");

    const citRows = await db.select().from(citations).where(eq(citations.projectId, "prj_p7"));
    const fakeRow = citRows.find((c) => c.sourceId === "src_fake_doi");
    expect(fakeRow?.verificationStatus).toBe("fake_or_not_found");
    const realRows = citRows.filter((c) => c.sourceId !== "src_fake_doi");
    expect(realRows.every((r) => r.verificationStatus === "verified")).toBe(true);
  });

  it("captures held credits when chapter reaches ready and automatically refunds in full if drafting fails", async () => {
    await db.insert(chapters).values({
      id: "chp_bill_ok",
      projectId: "prj_p7",
      number: 1,
      title: "Results and Findings",
      chapterType: "results",
      pageBudget: 4,
      wordBudget: 1100,
      isAutoReferences: false,
      status: "not_started",
      createdAt: now,
      updatedAt: now,
    });

    // Reserve 4 credits (30 -> 26)
    const okRes = await reserveChapterCredits(db, {
      userId: "usr_p7",
      projectId: "prj_p7",
      chapterId: "chp_bill_ok",
      credits: 4,
      idempotencyKey: "chapter:run_bill_ok",
      now,
    });
    expect(okRes.balanceAfter).toBe(26);

    const noopLlm: CallLLMContext = {
      db,
      env: {
        CLOUDFLARE_ACCOUNT_ID: "acct_1",
        CLOUDFLARE_AI_GATEWAY_ID: "gw_1",
        ANTHROPIC_API_KEY: "sk-ant-test",
        APP_ENV: "dev",
      },
      fetchFn: async () => new Response("unused", { status: 500 }),
    };

    const readyOut = await runWriteChapterOrchestration(
      {
        runId: "run_bill_ok",
        projectId: "prj_p7",
        chapterId: "chp_bill_ok",
        reservationId: okRes.reservationId,
      },
      {
        loadContext: (fn) => fn(),
        draftSection: (_i, fn) => fn(),
        assembleAndFinalize: (fn) => fn(),
      },
      { db, bucket: { async put() {} }, llmCtx: noopLlm, nowFn: () => now }
    );
    expect(readyOut.status).toBe("ready");

    const [capRow] = await db
      .select()
      .from(creditReservations)
      .where(eq(creditReservations.id, okRes.reservationId));
    expect(capRow?.status).toBe("captured");

    // Now test a failing chapter: reserve 6 credits (26 -> 20), fail mid-run -> auto-refund back to 26
    await db.insert(chapters).values({
      id: "chp_bill_fail",
      projectId: "prj_p7",
      number: 2,
      title: "Literature Review",
      chapterType: "literature_review",
      pageBudget: 6,
      wordBudget: 1650,
      isAutoReferences: false,
      status: "not_started",
      createdAt: now,
      updatedAt: now,
    });

    const failRes = await reserveChapterCredits(db, {
      userId: "usr_p7",
      projectId: "prj_p7",
      chapterId: "chp_bill_fail",
      credits: 6,
      idempotencyKey: "chapter:run_bill_fail",
      now,
    });
    expect(failRes.balanceAfter).toBe(20);

    await expect(
      runWriteChapterOrchestration(
        {
          runId: "run_bill_fail",
          projectId: "prj_p7",
          chapterId: "chp_bill_fail",
          reservationId: failRes.reservationId,
        },
        {
          loadContext: (fn) => fn(),
          draftSection: async () => {
            throw new Error("Simulated LLM timeout");
          },
          assembleAndFinalize: (fn) => fn(),
        },
        { db, bucket: { async put() {} }, llmCtx: noopLlm, nowFn: () => now }
      )
    ).rejects.toThrow("Simulated LLM timeout");

    const [usrAfterFail] = await db.select().from(users).where(eq(users.id, "usr_p7"));
    expect(usrAfterFail?.creditsBalance).toBe(26);
    const [refRow] = await db
      .select()
      .from(creditReservations)
      .where(eq(creditReservations.id, failRes.reservationId));
    expect(refRow?.status).toBe("refunded");
  });

  it("measures real PDF page count via Browser Run, emits real wordCount/pageCount/allChaptersComplete, and notifies on needs_attention", async () => {
    await db.insert(chapters).values({
      id: "chp_pdf_meas",
      projectId: "prj_p7",
      number: 1,
      title: "Introduction",
      chapterType: "introduction",
      pageBudget: 3,
      wordBudget: 825,
      isAutoReferences: false,
      status: "not_started",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sections).values({
      id: "sec_pdf_meas",
      chapterId: "chp_pdf_meas",
      orderIndex: 1,
      heading: "Background",
      wordBudget: 825,
      status: "not_started",
      createdAt: now,
      updatedAt: now,
    });

    let browserRenderCalls = 0;
    const fakeBrowser: BrowserRunPdfBinding = {
      async quickAction() {
        browserRenderCalls++;
        const doc = await PDFDocument.create();
        doc.addPage([595.28, 841.89]);
        doc.addPage([595.28, 841.89]);
        doc.addPage([595.28, 841.89]);
        const bytes = await doc.save();
        return new Response(new Uint8Array(bytes), { status: 200 });
      },
    };

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
        if (body.system?.includes("Summarize the chapter")) {
          return Response.json({
            id: "mm",
            model: "claude-haiku-4-5",
            stop_reason: "end_turn",
            content: [
              { type: "text", text: JSON.stringify({ summary: "Summary.", glossaryTerms: [] }) },
            ],
            usage: { input_tokens: 30, output_tokens: 20 },
          });
        }
        const match = userText.match(/\[PASSAGE:(psg_[^\s|]+)\s*\|\s*CITE:@([^\s|]+)/);
        const psgId = match?.[1] ?? "psg_1_0";
        const citeKey = match?.[2] ?? "okonkwo2024";
        const prose = `Rural clinics employing hybrid battery systems report measurably fewer outage events across field stations [@${citeKey}].`;
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

    const readyEvents: Array<{
      wordCount: number;
      pageCount: number;
      allChaptersComplete: boolean;
    }> = [];
    const attentionEvents: Array<{ chapterNumber: number; reason: string }> = [];

    const out = await runWriteChapterOrchestration(
      { runId: "run_pdf_meas", projectId: "prj_p7", chapterId: "chp_pdf_meas" },
      {
        loadContext: (fn) => fn(),
        draftSection: (_i, fn) => fn(),
        assembleAndFinalize: (fn) => fn(),
      },
      {
        db,
        bucket: { async put() {} },
        llmCtx,
        browser: fakeBrowser,
        nowFn: () => now,
        onChapterReady: async (info) => {
          readyEvents.push({
            wordCount: info.wordCount,
            pageCount: info.pageCount,
            allChaptersComplete: info.allChaptersComplete,
          });
        },
        onNeedsAttention: async (info) => {
          attentionEvents.push({ chapterNumber: info.chapterNumber, reason: info.reason });
        },
      }
    );

    expect(browserRenderCalls).toBeGreaterThanOrEqual(2);
    expect(out.pageCount).toBe(3);
    expect(readyEvents).toHaveLength(1);
    expect(readyEvents[0]?.pageCount).toBe(3);
    expect(readyEvents[0]?.wordCount).toBeGreaterThan(10);
    expect(readyEvents[0]?.allChaptersComplete).toBe(true);
    expect(attentionEvents).toHaveLength(0);

    const [projRow] = await db.select().from(projects).where(eq(projects.id, "prj_p7"));
    expect(projRow?.status).toBe("completed");

    // Verify onNeedsAttention fires on unexpected chapter failure
    await expect(
      runWriteChapterOrchestration(
        { runId: "run_pdf_fail", projectId: "prj_p7", chapterId: "chp_pdf_meas" },
        {
          loadContext: (fn) => fn(),
          draftSection: async () => {
            throw new Error("Simulated provider crash");
          },
          assembleAndFinalize: (fn) => fn(),
        },
        {
          db,
          bucket: { async put() {} },
          llmCtx,
          nowFn: () => now,
          onNeedsAttention: async (info) => {
            attentionEvents.push({ chapterNumber: info.chapterNumber, reason: info.reason });
          },
        }
      )
    ).rejects.toThrow("Simulated provider crash");

    expect(attentionEvents).toHaveLength(1);
    expect(attentionEvents[0]?.chapterNumber).toBe(1);
    expect(attentionEvents[0]?.reason).toContain("Simulated provider crash");
  });
});
