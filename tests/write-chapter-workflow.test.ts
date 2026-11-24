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
import {
  isExplicitFullChapterRewriteRequest,
  runWriteChapterOrchestration,
} from "@/lib/writing/chapter-orchestrator";
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
    expect(attentionEvents[0]?.reason).not.toContain("Simulated provider crash");
    expect(attentionEvents[0]?.reason.toLowerCase()).toContain("temporary service issue");
  });

  it("performs surgical Request changes: edits ONLY targeted section while preserving untouched section verbatim", async () => {
    await db.insert(chapters).values({
      id: "chp_surg",
      projectId: "prj_p7",
      number: 1,
      title: "Introduction",
      chapterType: "introduction",
      pageBudget: 2,
      wordBudget: 550,
      isAutoReferences: false,
      status: "ready",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(sections).values([
      {
        id: "sec_s1",
        chapterId: "chp_surg",
        orderIndex: 1,
        heading: "Background of the study",
        wordBudget: 275,
        status: "verified",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "sec_s2",
        chapterId: "chp_surg",
        orderIndex: 2,
        heading: "Statement of the problem",
        wordBudget: 275,
        status: "verified",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const r2Map = new Map<string, string>();
    const v1Key = "chapters/prj_p7/chp_surg/v1.md";
    const untouchedText =
      "Original section one prose that must remain completely untouched after revision.";
    r2Map.set(
      v1Key,
      [
        "# Chapter 1: Introduction",
        "",
        "## 1.1 Background of the study",
        "",
        untouchedText,
        "",
        "## 1.2 Statement of the problem",
        "",
        "Original problem statement before surgical update.",
      ].join("\n")
    );

    await db.insert(chapterVersions).values({
      id: "ver_s1",
      chapterId: "chp_surg",
      version: 1,
      contentR2Key: v1Key,
      wordCount: 25,
      pageCount: 1,
      createdBy: "ai",
      createdAt: now,
    });

    const draftedSections: string[] = [];
    const allRequestBodies: string[] = [];
    const llmCtx: CallLLMContext = {
      db,
      env: {
        CLOUDFLARE_ACCOUNT_ID: "acct_1",
        CLOUDFLARE_AI_GATEWAY_ID: "gw_1",
        ANTHROPIC_API_KEY: "sk-ant-test",
        APP_ENV: "dev",
      },
      fetchFn: async (_url, init) => {
        const rawBody = String(init?.body ?? "{}");
        allRequestBodies.push(rawBody);
        const body = JSON.parse(rawBody) as {
          system?: string;
          messages?: Array<{ content: string }>;
        };
        const systemText = body.system ?? "";
        const userText = body.messages?.[0]?.content ?? "";

        if (systemText.includes("fact-checker")) {
          return Response.json({
            id: "msg_v",
            model: "claude-sonnet-4-5",
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  results: [{ index: 0, verdict: "supported", notes: "Supported" }],
                }),
              },
            ],
            usage: { input_tokens: 100, output_tokens: 40 },
          });
        }
        if (systemText.includes("Summarize the chapter")) {
          return Response.json({
            id: "msg_m",
            model: "claude-haiku-4-5",
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  summary: "Surgically updated section 1.2.",
                  glossaryTerms: [],
                }),
              },
            ],
            usage: { input_tokens: 80, output_tokens: 30 },
          });
        }

        const headingMatch = userText.match(/Section heading:\s*(.+)/);
        if (headingMatch?.[1]) draftedSections.push(headingMatch[1].trim());
        expect(systemText).toContain("SURGICAL REVISION MODE");
        expect(userText).toContain("Original problem statement before surgical update.");

        return Response.json({
          id: "msg_d",
          model: "claude-sonnet-4-5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                prose:
                  "Surgically revised problem statement clarifying diesel downtime in rural clinics.",
                claims: [],
              }),
            },
          ],
          usage: { input_tokens: 200, output_tokens: 90 },
        });
      },
    };

    const out = await runWriteChapterOrchestration(
      {
        runId: "rev_surg_1",
        projectId: "prj_p7",
        chapterId: "chp_surg",
        createdBy: "revision",
        revisionNotes: "In section 1.2, clarify diesel generator downtime.",
      },
      {
        loadContext: (fn) => fn(),
        draftSection: (_idx, fn) => fn(),
        assembleAndFinalize: (fn) => fn(),
      },
      {
        db,
        bucket: {
          async put(key, val) {
            r2Map.set(key, String(val));
          },
          async get(key) {
            const val = r2Map.get(key);
            return val === undefined
              ? null
              : {
                  async text() {
                    return val;
                  },
                };
          },
        },
        llmCtx,
        measurePagesFn: async () => 2,
        waiveOriginalityGate: true,
        nowFn: () => now,
      }
    );

    expect(out.version).toBe(2);
    // ONLY Section 2 was sent to the LLM — Section 1 was preserved verbatim and NEVER sent to ANY LLM call!
    expect(draftedSections).toEqual(["Statement of the problem"]);
    expect(allRequestBodies).toHaveLength(1);
    for (const reqBody of allRequestBodies) {
      expect(reqBody).not.toContain(untouchedText);
    }
    const v2Text = r2Map.get(out.contentR2Key) ?? "";
    expect(v2Text).toContain(untouchedText);
    expect(v2Text).toContain(
      "Surgically revised problem statement clarifying diesel downtime in rural clinics."
    );
  });

  it("runs smart low-cost LLM copy-edit ONLY on sections with em-dashes (Hydrogen LOW +4096), skips clean sections, and preserves claims + figures", async () => {
    await db.insert(chapters).values({
      id: "chp_emdash",
      projectId: "prj_p7",
      number: 1,
      title: "Introduction",
      chapterType: "introduction",
      pageBudget: 2,
      wordBudget: 550,
      isAutoReferences: false,
      status: "ready",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(sections).values([
      {
        id: "sec_em1",
        chapterId: "chp_emdash",
        orderIndex: 1,
        heading: "Background of the study",
        wordBudget: 275,
        status: "verified",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "sec_em2",
        chapterId: "chp_emdash",
        orderIndex: 2,
        heading: "Statement of the problem",
        wordBudget: 275,
        status: "verified",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // Pre-existing verified claim on sec_em1 must stay intact after light copy-edit
    await db.insert(citations).values({
      id: "cit_em_1",
      projectId: "prj_p7",
      sourceId: "src_1",
      citeKey: "okonkwo2024",
      cslJson: JSON.stringify({ id: "okonkwo2024", title: "Empirical Study 1" }),
      verificationStatus: "verified",
      createdAt: now,
    });

    await db.insert(claims).values({
      id: "clm_em1_existing",
      sectionId: "sec_em1",
      chapterId: "chp_emdash",
      text: "Rural clinics rely on solar microgrids.",
      citationId: "cit_em_1",
      passageId: "psg_1_0",
      verdict: "supported",
      verified: true,
      verifierNotes: "Verified in initial draft",
      createdAt: now,
    });

    const cleanSection2 =
      "Diesel backup systems remain costly and unreliable for vaccine cold-chain storage during 2020–2024 [@okonkwo2024].";

    const r2Map = new Map<string, string>();
    const v1Key = "chapters/prj_p7/chp_emdash/v1.md";
    r2Map.set(
      v1Key,
      [
        "# Chapter 1: Introduction",
        "",
        "## 1.1 Background of the study",
        "",
        "Rural clinics — particularly off-grid facilities — rely on solar microgrids [@okonkwo2024] — however grid outages persist during 2020–2024.",
        "",
        ":::figure",
        "url: https://upload.wikimedia.org/example—image.jpg",
        "alt: Clinic solar array",
        "caption: Solar array installation",
        "attribution: Wikimedia Commons",
        "width: 800",
        "height: 600",
        ":::",
        "",
        "## 1.2 Statement of the problem",
        "",
        cleanSection2,
      ].join("\n")
    );

    await db.insert(chapterVersions).values({
      id: "ver_em1",
      chapterId: "chp_emdash",
      version: 1,
      contentR2Key: v1Key,
      wordCount: 40,
      pageCount: 1,
      createdBy: "ai",
      createdAt: now,
    });

    const recordedCalls: Array<{
      url: string;
      body: Record<string, unknown>;
    }> = [];

    const smartEditedSec1 = [
      "Rural clinics (particularly off-grid facilities) rely on solar microgrids [@okonkwo2024]; however, grid outages persist during 2020–2024.",
      "",
      ":::figure",
      "url: https://upload.wikimedia.org/example—image.jpg",
      "alt: Clinic solar array",
      "caption: Solar array installation",
      "attribution: Wikimedia Commons",
      "width: 800",
      "height: 600",
      ":::",
    ].join("\n");

    const llmCtx: CallLLMContext = {
      db,
      env: {
        GEMINI_API_KEY: "gem-test-key",
        GOOGLE_CLOUD_PROJECT: "test-gcp-proj",
        LLM_MODEL_DRAFT: "gemini-4-neon",
        LLM_MODEL_VERIFY: "gemini-4-hydrogen",
        APP_ENV: "dev",
      },
      fetchFn: async (inputUrl, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        recordedCalls.push({ url: String(inputUrl), body });
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: { role: "model", parts: [{ text: smartEditedSec1 }] },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 180,
              candidatesTokenCount: 95,
              thoughtsTokenCount: 120,
            },
            modelVersion: "gemini-4-hydrogen",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
    };

    const out = await runWriteChapterOrchestration(
      {
        runId: "rev_emdash_1",
        projectId: "prj_p7",
        chapterId: "chp_emdash",
        createdBy: "revision",
        revisionNotes: "Remove em dashes and replace with something else",
      },
      {
        loadContext: (fn) => fn(),
        draftSection: (_idx, fn) => fn(),
        assembleAndFinalize: (fn) => fn(),
      },
      {
        db,
        bucket: {
          async put(key, val) {
            r2Map.set(key, String(val));
          },
          async get(key) {
            const val = r2Map.get(key);
            return val === undefined
              ? null
              : {
                  async text() {
                    return val;
                  },
                };
          },
        },
        llmCtx,
        measurePagesFn: async () => 2,
        waiveOriginalityGate: true,
        nowFn: () => now,
      }
    );

    // Exactly ONE smart copy-edit call (Section 1 only — clean Section 2 skipped with 0 calls!)
    expect(recordedCalls).toHaveLength(1);
    expect(recordedCalls[0]!.url).toContain("gemini-4-hydrogen");
    const genCfg = recordedCalls[0]!.body.generationConfig as {
      maxOutputTokens: number;
      thinkingConfig?: { thinkingLevel?: string };
    };
    expect(genCfg.thinkingConfig?.thinkingLevel).toBe("LOW");
    // Base copyEditMaxTokens (>= 800) + GOOGLE_LOW_THINKING_HEADROOM (4096)
    expect(genCfg.maxOutputTokens).toBe(800 + 4096);
    // Compact copy-edit prompt never dumps VERIFIED EVIDENCE PASSAGES or untouched Section 2
    const serializedBody = JSON.stringify(recordedCalls[0]!.body);
    expect(serializedBody).not.toContain("VERIFIED EVIDENCE PASSAGES");
    expect(serializedBody).not.toContain(cleanSection2);

    expect(out.version).toBe(2);
    const v2 = r2Map.get(out.contentR2Key) ?? "";
    expect(v2).toContain(
      "Rural clinics (particularly off-grid facilities) rely on solar microgrids [@okonkwo2024]; however, grid outages persist during 2020–2024."
    );
    // Clean Section 2 remains byte-for-byte untouched
    expect(v2).toContain(cleanSection2);
    // Fenced figure URL remains completely untouched
    expect(v2).toContain("url: https://upload.wikimedia.org/example—image.jpg");

    // Pre-existing verified claim row in D1 was preserved (not wiped!)
    const remainingClaims = await db.select().from(claims).where(eq(claims.sectionId, "sec_em1"));
    expect(remainingClaims).toHaveLength(1);
    expect(remainingClaims[0]!.id).toBe("clm_em1_existing");
  });

  it("does not falsely refund credits or mark needs_attention on Cloudflare Durable Object code-update reset", async () => {
    await db.insert(chapters).values({
      id: "chp_do_reset",
      projectId: "prj_p7",
      number: 1,
      title: "Introduction",
      chapterType: "introduction",
      pageBudget: 7,
      wordBudget: 1925,
      isAutoReferences: false,
      status: "writing",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sections).values({
      id: "sec_do_1",
      chapterId: "chp_do_reset",
      orderIndex: 1,
      heading: "Background of the study",
      wordBudget: 500,
      status: "not_started",
      createdAt: now,
      updatedAt: now,
    });

    const reserved = await reserveChapterCredits(db, {
      userId: "usr_p7",
      projectId: "prj_p7",
      chapterId: "chp_do_reset",
      credits: 7,
      idempotencyKey: "chapter:run_do_reset",
      now,
    });

    const llmCtx: CallLLMContext = {
      db,
      env: { ANTHROPIC_API_KEY: "sk-ant-test", APP_ENV: "dev" },
    };

    await expect(
      runWriteChapterOrchestration(
        {
          runId: "run_do_reset",
          projectId: "prj_p7",
          chapterId: "chp_do_reset",
          reservationId: reserved.reservationId,
        },
        {
          loadContext: (fn) => fn(),
          draftSection: async () => {
            throw new Error("Durable Object reset because its code was updated.");
          },
          assembleAndFinalize: (fn) => fn(),
        },
        { db, bucket: { async put() {} }, llmCtx, nowFn: () => now }
      )
    ).rejects.toThrow("Durable Object reset");

    // Reservation must remain HELD (not refunded!) and chapter must remain WRITING (not needs_attention!)
    const [resRow] = await db
      .select()
      .from(creditReservations)
      .where(eq(creditReservations.id, reserved.reservationId));
    expect(resRow?.status).toBe("held");

    const [chRow] = await db.select().from(chapters).where(eq(chapters.id, "chp_do_reset"));
    expect(chRow?.status).toBe("writing");
  });

  it("only triggers whole-chapter rewrite/length passes when explicitly requested", () => {
    expect(isExplicitFullChapterRewriteRequest("Remove em dashes from this chapter")).toBe(false);
    expect(isExplicitFullChapterRewriteRequest("Tighten passive voice in section 1.2")).toBe(false);
    expect(isExplicitFullChapterRewriteRequest("Clarify methodology headings")).toBe(false);
    expect(isExplicitFullChapterRewriteRequest("Redo the entire chapter with fresh framing")).toBe(
      true
    );
    expect(isExplicitFullChapterRewriteRequest("Expand the chapter to add more pages")).toBe(true);
  });
});
