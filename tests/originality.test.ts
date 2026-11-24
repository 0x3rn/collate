import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { syncCitationRegistryForProject } from "@/db/queries/citations";
import { createProjectForUser } from "@/db/queries/projects";
import {
  chapters,
  chapterVersions,
  originalityReports,
  researchRuns,
  sources,
  users,
} from "@/db/schema";
import type { CallLLMContext } from "@/lib/ai/call-llm";
import {
  buildShingleHashSet,
  checkDirectQuoteBudget,
  checkSourceShingleOverlap,
  evaluateChapterOriginality,
  runOriginalityGateWithRewrite,
} from "@/lib/originality/checker";
import {
  buildWritingProcessLog,
  generateAiDisclosureStatement,
} from "@/lib/originality/integrity-exports";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

describe("Phase 8 — Layered Originality Engine (shingle overlap, quote budget, paraphrase & cross-user)", () => {
  const sourceParagraph =
    "Decentralized photovoltaic microgrids combined with lithium iron phosphate storage substantially increased vaccine refrigerator reliability across rural primary health centers in northern Nigeria between 2021 and 2024.";

  it("catches a deliberately copied source paragraph and auto-rewrites it until it passes", async () => {
    const copiedDraft = [
      "## 1.1 Background",
      `${sourceParagraph} [@okonkwo2024]`,
      "Reliable electricity supports continuous immunization services in remote communities [@okonkwo2024].",
    ].join("\n\n");

    const passages = [{ passageId: "psg_1", sourceId: "src_1", text: sourceParagraph }];

    const directCheck = checkSourceShingleOverlap(copiedDraft, passages);
    expect(directCheck.flagged.length).toBeGreaterThanOrEqual(1);
    expect(directCheck.overlapPct).toBeGreaterThan(12);

    const ctx = createInMemoryD1();
    ctx.applyMigrations();
    const db = createDb(ctx.d1);
    const seedNow = new Date("2026-11-22T09:00:00.000Z");
    await db.insert(users).values({
      id: "usr_orig",
      email: "orig@uni.edu",
      emailVerified: true,
      name: "Orig Tester",
      creditsBalance: 10,
      createdAt: seedNow,
      updatedAt: seedNow,
    });
    await createProjectForUser(db, {
      id: "prj_orig",
      userId: "usr_orig",
      type: "thesis",
      title: "Solar Microgrid Reliability",
      now: seedNow,
    });

    const llmCtx: CallLLMContext = {
      db,
      env: {
        CLOUDFLARE_ACCOUNT_ID: "acct_1",
        CLOUDFLARE_AI_GATEWAY_ID: "gw_1",
        ANTHROPIC_API_KEY: "sk-ant-test",
        APP_ENV: "dev",
      },
      fetchFn: async () =>
        Response.json({
          id: "msg_orig_rw",
          model: "claude-sonnet-4-5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: "## 1.1 Background\n\nField studies indicate that local solar generation backed by modern battery banks keeps medical cold-chain equipment running consistently in underserved northern clinics [@okonkwo2024]. Reliable electricity supports continuous immunization services in remote communities [@okonkwo2024].",
            },
          ],
          usage: { input_tokens: 300, output_tokens: 120 },
        }),
    };

    const gated = await runOriginalityGateWithRewrite({
      workflowId: "wf_orig_1",
      projectId: "prj_orig",
      chapterTitle: "Introduction",
      draftMarkdown: copiedDraft,
      sourcePassages: passages,
      llmCtx,
    });

    ctx.close();

    expect(gated.rewritePasses).toBe(1);
    expect(gated.evaluation.passed).toBe(true);
    expect(gated.evaluation.overlapScore).toBeLessThanOrEqual(12);
    expect(gated.evaluation.flaggedSpans).toHaveLength(0);
  });

  it("enforces the 2% quote budget and flags uncited direct quotes", () => {
    const quoteHeavyDraft =
      'Clinics improved rapidly. "This is a long verbatim direct quotation spanning many words that exceeds two percent of the short chapter text" with no citation at all.';
    const check = checkDirectQuoteBudget(quoteHeavyDraft);
    expect(check.quoteSharePct).toBeGreaterThan(2);
    expect(check.flagged.some((f) => f.kind === "quote_budget")).toBe(true);
    expect(check.flagged.some((f) => f.kind === "uncited_quote")).toBe(true);
  });

  it("detects semantic close-paraphrase and cross-user similarity across two students on the same topic", async () => {
    const userAText =
      "Rural healthcare facilities in northern Nigeria face frequent national grid outages that disrupt cold-chain vaccine storage and emergency maternal care. Solar microgrid installations with lithium battery storage reduce generator diesel dependence and stabilize voltage quality across clinic departments.";

    const userBFingerprints = [
      {
        chapterVersionId: "ver_user_a",
        shingleHashes: Array.from(buildShingleHashSet(userAText)),
      },
    ];

    const identicalEval = await evaluateChapterOriginality({
      draftMarkdown: userAText,
      sourcePassages: [],
      otherUserFingerprints: userBFingerprints,
    });
    expect(identicalEval.passed).toBe(false);
    expect(identicalEval.crossUserScore).toBeGreaterThan(18);
    expect(identicalEval.flaggedSpans.some((f) => f.kind === "cross_user_similarity")).toBe(true);

    const distinctUserBText =
      "Clinic electrification initiatives across West African rural districts evaluate off-grid inverter sizing, local technician maintenance contracts, and lifecycle capital costs compared against conventional diesel supply chains.";

    const distinctEval = await evaluateChapterOriginality({
      draftMarkdown: distinctUserBText,
      sourcePassages: [],
      otherUserFingerprints: userBFingerprints,
    });
    expect(distinctEval.passed).toBe(true);
    expect(distinctEval.crossUserScore).toBeLessThanOrEqual(18);

    const paraphraseEval = await evaluateChapterOriginality({
      draftMarkdown:
        "Off-grid solar arrays with modern batteries keep clinic freezers operational day and night.",
      sourcePassages: [{ passageId: "psg_s", sourceId: "src_s", text: sourceParagraph }],
      embedder: {
        async embed(texts) {
          return texts.map(() => [0.99, 0.01, 0.0]);
        },
      },
    });
    expect(paraphraseEval.passed).toBe(false);
    expect(paraphraseEval.flaggedSpans.some((f) => f.kind === "semantic_paraphrase")).toBe(true);

    // Original cited scientific synthesis sharing unavoidable biochemical nouns (0% 5-gram overlap,
    // low 3-gram overlap) must NOT false-fail at bge-base-en-v1.5's typical 0.92 cosine band.
    const bioSource =
      "Chronic ethanol administration accelerates hepatic cytochrome P450 2E1 metabolism, generating excess reactive oxygen species that elevate malondialdehyde (MDA) and deplete reduced glutathione (GSH) in rodent liver tissue.";
    const originalBioParaphrase =
      "When rodents undergo prolonged ethanol exposure, heightened activity of the hepatic enzyme cytochrome P450 2E1 drives an overproduction of reactive oxygen species; this oxidative burden impairs cellular defences by exhausting reduced glutathione (GSH) stores while simultaneously raising liver concentrations of malondialdehyde (MDA) [@darvish2024].";

    const scientificSynthesisEval = await evaluateChapterOriginality({
      draftMarkdown: originalBioParaphrase,
      sourcePassages: [{ passageId: "psg_bio", sourceId: "src_bio", text: bioSource }],
      embedder: {
        async embed(texts) {
          // Cosine similarity ≈ 0.92 between drafted sentence and source passage
          return texts.map((t) => (t.startsWith("When rodents") ? [0.92, 0.3919, 0] : [1, 0, 0]));
        },
      },
    });
    expect(scientificSynthesisEval.overlapScore).toBe(0);
    expect(scientificSynthesisEval.passed).toBe(true);
    expect(scientificSynthesisEval.flaggedSpans).toHaveLength(0);

    // Genuine mosaic plagiarism (swap a few synonyms while keeping >= 30% of 3-word phrases) at
    // cosine 0.92 MUST still be caught even when 5-gram overlap is reduced.
    const mosaicPlagiarism =
      "Chronic ethanol administration boosts hepatic cytochrome P450 2E1 metabolism, producing excess reactive oxygen species that raise malondialdehyde (MDA) and drain reduced glutathione (GSH) in rodent liver tissue.";
    const mosaicEval = await evaluateChapterOriginality({
      draftMarkdown: mosaicPlagiarism,
      sourcePassages: [{ passageId: "psg_bio", sourceId: "src_bio", text: bioSource }],
      embedder: {
        async embed(texts) {
          return texts.map((t) => (t.includes("boosts") ? [0.92, 0.3919, 0] : [1, 0, 0]));
        },
      },
    });
    expect(mosaicEval.passed).toBe(false);
    expect(mosaicEval.flaggedSpans.some((f) => f.kind === "semantic_paraphrase")).toBe(true);
  });
});

describe("Phase 8 — Writing-Process Log export & AI-Use Disclosure statement", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  const now = new Date("2026-11-22T10:00:00.000Z");

  beforeEach(async () => {
    d1Ctx = createInMemoryD1();
    d1Ctx.applyMigrations();
    db = createDb(d1Ctx.d1);

    await db.insert(users).values({
      id: "usr_int",
      email: "int@uni.edu",
      emailVerified: true,
      name: "Integrity Researcher",
      creditsBalance: 10,
      createdAt: now,
      updatedAt: now,
    });
    await createProjectForUser(db, {
      id: "prj_int",
      userId: "usr_int",
      type: "thesis",
      title: "Solar Microgrid Reliability in Rural Clinics",
      institution: "University of Ibadan",
      now,
    });
  });

  afterEach(() => {
    d1Ctx.close();
  });

  it("exports structured writing-process log and tailored AI-use disclosure statement", async () => {
    await db.insert(researchRuns).values({
      id: "run_int_1",
      projectId: "prj_int",
      status: "completed",
      sourcesFound: 18,
      sourcesFetched: 15,
      subtopicsCovered: 4,
      startedAt: now,
      finishedAt: now,
      updatedAt: now,
    });
    await db.insert(sources).values({
      id: "src_int_1",
      projectId: "prj_int",
      url: "https://doi.org/10.1016/j.int.2024",
      canonicalUrl: "https://doi.org/10.1016/j.int.2024",
      doi: "10.1016/j.int.2024",
      title: "Solar Reliability in Rural Clinics",
      normalizedTitle: "solar reliability in rural clinics",
      authorsJson: JSON.stringify(["Adaeze Okonkwo"]),
      year: 2024,
      sourceType: "peer_reviewed",
      connectorName: "crossref",
      credibilityScore: 90,
      relevanceScore: 85,
      retrievedAt: now,
      createdAt: now,
    });
    await syncCitationRegistryForProject(db, "prj_int", now);

    await db.insert(chapters).values({
      id: "chp_int_1",
      projectId: "prj_int",
      number: 1,
      title: "Introduction",
      chapterType: "introduction",
      isAutoReferences: false,
      status: "ready",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(chapterVersions).values({
      id: "ver_int_1",
      chapterId: "chp_int_1",
      version: 1,
      contentR2Key: "chapters/prj_int/chp_int_1/v1.md",
      wordCount: 820,
      pageCount: 3,
      createdBy: "ai",
      createdAt: now,
    });
    await db.insert(originalityReports).values({
      id: "org_int_1",
      chapterVersionId: "ver_int_1",
      chapterId: "chp_int_1",
      projectId: "prj_int",
      overlapScore: 3.2,
      semanticScore: 54.0,
      quoteSharePct: 0.4,
      crossUserScore: 1.1,
      passed: true,
      waived: false,
      createdAt: now,
    });

    const log = await buildWritingProcessLog(db, "prj_int", now);
    expect(log).not.toBeNull();
    expect(log?.researchHistory).toHaveLength(1);
    expect(log?.verifiedSourcesUsed).toHaveLength(1);
    expect(log?.chapterDraftingHistory[0]?.versions[0]?.originalityPassed).toBe(true);

    const disclosure = generateAiDisclosureStatement({
      authorName: "Integrity Researcher",
      institution: "University of Ibadan",
      projectTitle: log!.project.title,
      citationStyle: log!.project.citationStyle,
      verifiedSourceCount: log!.verifiedSourcesUsed.length,
    });
    expect(disclosure).toContain("University of Ibadan");
    expect(disclosure).toContain("No experimental, survey, or interview data were fabricated");
  });
});
