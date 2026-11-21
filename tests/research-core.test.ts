import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { createProjectForUser } from "@/db/queries/projects";
import { researchRuns, sourcePassages, sources, users } from "@/db/schema";
import type { CallLLMContext } from "@/lib/ai/call-llm";
import {
  canonicalizeUrl,
  computeTitleSimilarity,
  deduplicateSources,
  normalizeDoi,
} from "@/lib/research/dedupe";
import { planResearchQueries } from "@/lib/research/query-planner";
import {
  countCoveredSubtopics,
  scoreAndRankSources,
  scoreSourceCredibility,
} from "@/lib/research/scoring";
import type { RawSourceCandidate } from "@/lib/research/types";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

describe("Research deduplication (DOI, canonical URL, title similarity)", () => {
  const now = new Date("2026-11-21T18:00:00.000Z");

  it("normalizes DOIs and canonical URLs cleanly", () => {
    expect(normalizeDoi("https://doi.org/10.1016/J.RSER.2024.114001.")).toBe(
      "10.1016/j.rser.2024.114001"
    );
    expect(normalizeDoi("doi:10.1038/s41560-023-01234-5")).toBe("10.1038/s41560-023-01234-5");
    expect(normalizeDoi("not-a-doi")).toBeNull();

    expect(
      canonicalizeUrl("https://www.Nature.com/articles/s41560/?utm_source=twitter&b=2&a=1#fig1")
    ).toBe("https://nature.com/articles/s41560?a=1&b=2");
  });

  it("merges duplicates across connectors by DOI, URL, and near-identical title while keeping richest metadata", () => {
    const candidates: RawSourceCandidate[] = [
      {
        url: "https://openalex.org/W123",
        doi: "https://doi.org/10.1016/j.enpol.2024.113900",
        title: "Solar Microgrid Reliability in Rural West African Health Clinics",
        authors: ["A. Okonkwo"],
        year: 2024,
        sourceType: "peer_reviewed",
        connectorName: "openalex",
        citationCount: 18,
        abstractText: null,
        retrievedAt: now,
      },
      {
        url: "https://sciencedirect.com/article/113900?utm_campaign=search",
        doi: "10.1016/j.enpol.2024.113900",
        title: "Solar Microgrid Reliability in Rural West African Health Clinics",
        authors: ["A. Okonkwo", "B. Mensah", "C. Adeyemi"],
        year: 2024,
        publisher: "Elsevier",
        venue: "Energy Policy",
        sourceType: "peer_reviewed",
        connectorName: "crossref",
        citationCount: 25,
        abstractText:
          "Longer peer-reviewed abstract analyzing 42 rural clinics across West Africa.",
        openAccessPdfUrl: "https://repo.example/microgrid.pdf",
        retrievedAt: now,
      },
      {
        url: "https://arxiv.org/abs/2401.99999",
        doi: null,
        title: "Solar Microgrid Reliability in Rural West African Health Clinics!",
        authors: ["A. Okonkwo"],
        year: 2024,
        sourceType: "preprint",
        connectorName: "arxiv",
        retrievedAt: now,
      },
    ];

    const deduped = deduplicateSources(candidates);
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.doi).toBe("10.1016/j.enpol.2024.113900");
    expect(deduped[0]?.authors).toHaveLength(3);
    expect(deduped[0]?.citationCount).toBe(25);
    expect(deduped[0]?.publisher).toBe("Elsevier");
    expect(deduped[0]?.openAccessPdfUrl).toBe("https://repo.example/microgrid.pdf");
    expect(deduped[0]?.connectorNames).toEqual(["openalex", "crossref", "arxiv"]);
    expect(
      computeTitleSimilarity("solar microgrid clinic", "solar microgrid clinics")
    ).toBeLessThan(1);
  });
});

describe("Source credibility and relevance scoring", () => {
  const now = new Date("2026-11-21T18:00:00.000Z");

  it("ranks high-citation peer-reviewed DOI papers well above low-credibility web domains", () => {
    const peerReviewed = scoreSourceCredibility(
      {
        sourceType: "peer_reviewed",
        doi: "10.1038/s41560-024-0001",
        url: "https://nature.com/articles/s41560-024-0001",
        citationCount: 120,
        year: 2024,
        publisher: "Springer Nature",
        venue: "Nature Energy",
        authors: ["A. Musa"],
      },
      2026
    );

    const lowCredBlog = scoreSourceCredibility(
      {
        sourceType: "web",
        doi: null,
        url: "https://www.quora.com/What-is-a-solar-microgrid",
        citationCount: null,
        year: null,
        publisher: null,
        venue: null,
        authors: [],
      },
      2026
    );

    expect(peerReviewed).toBeGreaterThanOrEqual(85);
    expect(lowCredBlog).toBe(10);
  });

  it("computes relevance scores and covered subtopics accurately", () => {
    const deduped = deduplicateSources([
      {
        url: "https://who.int/reports/solar-clinics-2025",
        doi: null,
        title: "Solar microgrid reliability and vaccine cold-chain uptime in rural clinics",
        authors: ["World Health Organization"],
        year: 2025,
        sourceType: "institutional",
        connectorName: "tavily",
        abstractText:
          "Evaluates battery storage reliability and cold-chain outcomes in rural clinics.",
        retrievedAt: now,
      },
      {
        url: "https://example.org/unrelated-cooking",
        doi: null,
        title: "Traditional sourdough bread fermentation temperatures",
        authors: ["Chef Test"],
        year: 2023,
        sourceType: "web",
        connectorName: "brave",
        abstractText: "Discusses yeast and flour ratios.",
        retrievedAt: now,
      },
    ]);

    const subtopics = [
      "Solar microgrid reliability in rural clinics",
      "Vaccine cold-chain battery storage outcomes",
    ];
    const ranked = scoreAndRankSources(
      deduped,
      "Solar microgrid reliability in rural clinics",
      subtopics,
      2026
    );

    expect(ranked[0]?.url).toContain("who.int");
    expect(ranked[0]?.relevanceScore).toBeGreaterThan(ranked[1]!.relevanceScore);
    expect(countCoveredSubtopics(ranked)).toBe(2);
  });
});

describe("Query planner + D1 research tables constraints", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  const now = new Date("2026-11-21T18:00:00.000Z");

  beforeEach(async () => {
    d1Ctx = createInMemoryD1();
    d1Ctx.applyMigrations();
    db = createDb(d1Ctx.d1);

    await db.insert(users).values({
      id: "usr_res",
      email: "res@uni.edu",
      emailVerified: true,
      name: "Researcher",
      creditsBalance: 10,
      createdAt: now,
      updatedAt: now,
    });
    await createProjectForUser(db, {
      id: "prj_res",
      userId: "usr_res",
      type: "thesis",
      title: "Solar Microgrid Reliability in Rural Clinics",
      now,
    });
  });

  afterEach(() => {
    d1Ctx.close();
  });

  it("plans 15–40 diverse queries via callLLM() and supplements if LLM returns too few", async () => {
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
          id: "msg_qp",
          model: "claude-haiku-4-5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                subtopics: [
                  "Microgrid battery storage reliability",
                  "Rural clinic cold-chain power continuity",
                  "Lifecycle cost economics in sub-Saharan Africa",
                ],
                keyTerms: ["solar microgrid", "rural clinic", "battery storage", "uptime"],
                synonyms: ["photovoltaic minigrid", "primary healthcare facility"],
                queries: [
                  {
                    query: "systematic review of solar microgrid reliability healthcare",
                    intent: "systematic_review",
                    subtopic: "Microgrid battery storage reliability",
                  },
                  {
                    query: "case study solar minigrid rural clinic Nigeria",
                    intent: "case_study",
                    subtopic: "Rural clinic cold-chain power continuity",
                  },
                ],
              }),
            },
          ],
          usage: { input_tokens: 400, output_tokens: 220 },
        }),
    };

    const { plan, usedFallback } = await planResearchQueries(
      {
        workflowId: "wf_plan_1",
        projectId: "prj_res",
        topic: "Solar Microgrid Reliability in Rural Clinics",
        projectType: "thesis",
        field: "Renewable Energy",
      },
      llmCtx
    );

    expect(usedFallback).toBe(false);
    expect(plan.queries.length).toBeGreaterThanOrEqual(15);
    expect(plan.queries.length).toBeLessThanOrEqual(40);
    expect(plan.queries.some((q) => q.intent === "systematic_review")).toBe(true);
    expect(plan.queries.some((q) => q.intent === "statistics")).toBe(true);
  });

  it("enforces research_runs, sources, and source_passages DB constraints", async () => {
    await db.insert(researchRuns).values({
      id: "run_1",
      projectId: "prj_res",
      status: "searching",
      startedAt: now,
      updatedAt: now,
    });

    await db.insert(sources).values({
      id: "src_1",
      projectId: "prj_res",
      researchRunId: "run_1",
      url: "https://nature.com/articles/1",
      canonicalUrl: "https://nature.com/articles/1",
      doi: "10.1038/test-1",
      title: "Valid Source",
      normalizedTitle: "valid source",
      connectorName: "openalex",
      credibilityScore: 90,
      relevanceScore: 85,
      retrievedAt: now,
      createdAt: now,
    });

    // Out-of-range credibilityScore must fail CHECK constraint
    await expect(
      db.insert(sources).values({
        id: "src_bad",
        projectId: "prj_res",
        url: "https://example.com",
        canonicalUrl: "https://example.com",
        title: "Bad Score",
        normalizedTitle: "bad score",
        connectorName: "web",
        credibilityScore: 150,
        relevanceScore: 50,
        retrievedAt: now,
        createdAt: now,
      })
    ).rejects.toThrow();

    await db.insert(sourcePassages).values({
      id: "psg_1",
      sourceId: "src_1",
      projectId: "prj_res",
      passageIndex: 0,
      text: "First verified passage.",
      tokenCount: 4,
      createdAt: now,
    });

    // Duplicate (sourceId, passageIndex) must fail UNIQUE constraint
    await expect(
      db.insert(sourcePassages).values({
        id: "psg_dup",
        sourceId: "src_1",
        projectId: "prj_res",
        passageIndex: 0,
        text: "Duplicate index",
        tokenCount: 2,
        createdAt: now,
      })
    ).rejects.toThrow();
  });
});
