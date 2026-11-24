import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { syncCitationRegistryForProject, verifyProjectCitations } from "@/db/queries/citations";
import { createProjectForUser } from "@/db/queries/projects";
import {
  chapters,
  chapterVersions,
  claims,
  sections,
  sourcePassages,
  sources,
  users,
} from "@/db/schema";
import { retrieveEvidencePassages } from "@/lib/writing/retrieval";
import { analyzeCsvDataset, buildLabelledResultsFramework } from "@/lib/writing/results-data";
import { draftAndVerifySection, normalizeCiteKey } from "@/lib/writing/section-pipeline";
import {
  matchExplicitRevisionTargets,
  parseExistingChapterSections,
} from "@/lib/writing/section-revision";
import {
  assertChapterTransition,
  canStartChapter,
  isChapterTimedOut,
  type ChapterGateSummary,
} from "@/lib/writing/state-machine";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

describe("Phase 7 — Chapter state machine (NN-8 & 24h ceiling)", () => {
  it("blocks Chapter N+1 until Chapter N is ready or approved, and blocks auto-References", () => {
    const chList: ChapterGateSummary[] = [
      { number: 1, title: "Introduction", status: "not_started" as const, isAutoReferences: false },
      {
        number: 2,
        title: "Literature Review",
        status: "not_started" as const,
        isAutoReferences: false,
      },
      { number: 3, title: "References", status: "not_started" as const, isAutoReferences: true },
    ];

    expect(canStartChapter(chList, 1).allowed).toBe(true);
    expect(canStartChapter(chList, 2).allowed).toBe(false);
    expect(canStartChapter(chList, 3).allowed).toBe(false);

    chList[0]!.status = "writing";
    expect(canStartChapter(chList, 2).allowed).toBe(false);
    expect(canStartChapter(chList, 1).allowed).toBe(false);

    const readyList = [
      { number: 1, title: "Introduction", status: "ready" as const, isAutoReferences: false },
      {
        number: 2,
        title: "Literature Review",
        status: "not_started" as const,
        isAutoReferences: false,
      },
    ];
    expect(canStartChapter(readyList, 2).allowed).toBe(true);
  });

  it("enforces valid transitions and detects 24-hour chapter ceiling", () => {
    expect(() => assertChapterTransition("not_started", "queued")).not.toThrow();
    expect(() => assertChapterTransition("not_started", "approved")).toThrow();

    const start = new Date("2026-11-20T10:00:00.000Z");
    expect(isChapterTimedOut(start, new Date("2026-11-21T09:59:00.000Z"))).toBe(false);
    expect(isChapterTimedOut(start, new Date("2026-11-21T10:01:00.000Z"))).toBe(true);
  });
});

describe("Phase 7 — NN-4 CSV Dataset Analyzer & Labelled Results Framework", () => {
  it("computes exact descriptive statistics and categorical distributions from user CSV", () => {
    const csv = [
      "clinic_region,uptime_pct,battery_years",
      "Kano,96,5",
      "Kano,92,4",
      "Lagos,98,6",
      "Enugu,94,5",
    ].join("\n");

    const result = analyzeCsvDataset(csv);
    expect(result.rowCount).toBe(4);
    expect(result.columnCount).toBe(3);

    const uptime = result.columns.find((c) => c.column === "uptime_pct");
    expect(uptime?.kind).toBe("numeric");
    if (uptime?.kind === "numeric") {
      expect(uptime.mean).toBe(95);
      expect(uptime.median).toBe(95);
      expect(uptime.min).toBe(92);
      expect(uptime.max).toBe(98);
      expect(uptime.stdDev).toBeCloseTo(2.58, 2);
    }

    const region = result.columns.find((c) => c.column === "clinic_region");
    expect(region?.kind).toBe("categorical");
    if (region?.kind === "categorical") {
      expect(region.topCategories[0]).toEqual({ value: "Kano", count: 2, percent: 50 });
    }

    expect(result.markdownTables).toContain("Descriptive Statistics");
    expect(result.markdownTables).toContain("Kano");
  });

  it("rejects empty CSV and builds clearly labelled NN-4 results framework when no data exists", () => {
    expect(() => analyzeCsvDataset("header_only")).toThrow("at least one data row");

    const framework = buildLabelledResultsFramework({
      chapterTitle: "Results and Findings",
      topic: "Rural clinic solar uptime",
      sectionHeadings: ["Data description", "Analysis by research question"],
    });
    expect(framework).toContain("Rule NN-4");
    expect(framework).toContain("[ADD: Verified value]");
  });
});

describe("Phase 7 — Verified Evidence Passage Retrieval & D1 Writing Constraints", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  const now = new Date("2026-11-21T23:30:00.000Z");

  beforeEach(async () => {
    d1Ctx = createInMemoryD1();
    d1Ctx.applyMigrations();
    db = createDb(d1Ctx.d1);

    await db.insert(users).values({
      id: "usr_w",
      email: "writer@uni.edu",
      emailVerified: true,
      name: "Writer",
      creditsBalance: 20,
      createdAt: now,
      updatedAt: now,
    });
    await createProjectForUser(db, {
      id: "prj_w",
      userId: "usr_w",
      type: "thesis",
      title: "Solar Microgrid Uptime",
      now,
    });
  });

  afterEach(() => {
    d1Ctx.close();
  });

  it("retrieves only passages linked to non-rejected citations and enforces version/claim tables", async () => {
    await db.insert(sources).values([
      {
        id: "src_good",
        projectId: "prj_w",
        url: "https://doi.org/10.1016/j.good.2024",
        canonicalUrl: "https://doi.org/10.1016/j.good.2024",
        doi: "10.1016/j.good.2024",
        title: "Solar Microgrid Vaccine Cold Chain Study",
        normalizedTitle: "solar microgrid vaccine cold chain study",
        authorsJson: JSON.stringify(["Adaeze Okonkwo"]),
        year: 2024,
        sourceType: "peer_reviewed",
        connectorName: "crossref",
        credibilityScore: 92,
        relevanceScore: 88,
        retrievedAt: now,
        createdAt: now,
      },
      {
        id: "src_rejected",
        projectId: "prj_w",
        url: "https://doi.org/10.9999/fake.2024",
        canonicalUrl: "https://doi.org/10.9999/fake.2024",
        doi: "10.9999/fake.2024",
        title: "Fake Rejected Paper",
        normalizedTitle: "fake rejected paper",
        authorsJson: JSON.stringify(["Fake Author"]),
        year: 2024,
        sourceType: "peer_reviewed",
        connectorName: "web",
        credibilityScore: 60,
        relevanceScore: 80,
        retrievedAt: now,
        createdAt: now,
      },
    ]);

    await db.insert(sourcePassages).values([
      {
        id: "psg_good_1",
        sourceId: "src_good",
        projectId: "prj_w",
        passageIndex: 0,
        text: "Solar microgrids raised vaccine refrigerator uptime from 61% to 97% across 18 rural clinics.",
        location: "section_1",
        tokenCount: 22,
        createdAt: now,
      },
      {
        id: "psg_fake_1",
        sourceId: "src_rejected",
        projectId: "prj_w",
        passageIndex: 0,
        text: "Solar microgrids vaccine refrigerator fabricated claim.",
        location: "section_1",
        tokenCount: 10,
        createdAt: now,
      },
    ]);

    await syncCitationRegistryForProject(db, "prj_w", now);
    await verifyProjectCitations(db, "prj_w", {
      fetchFn: async (input) =>
        String(input).includes("j.good.2024")
          ? Response.json({ message: { title: ["Solar Microgrid Vaccine Cold Chain Study"] } })
          : new Response("Not found", { status: 404 }),
      now,
    });

    const retrieved = await retrieveEvidencePassages(db, {
      projectId: "prj_w",
      queryText: "vaccine refrigerator uptime in solar microgrid clinics",
      topK: 5,
    });

    expect(retrieved).toHaveLength(1);
    expect(retrieved[0]?.passageId).toBe("psg_good_1");
    expect(retrieved[0]?.citeKey).toBe("okonkwo2024");

    await db.insert(chapters).values({
      id: "chp_1",
      projectId: "prj_w",
      number: 1,
      title: "Introduction",
      chapterType: "introduction",
      isAutoReferences: false,
      status: "writing",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sections).values({
      id: "sec_1",
      chapterId: "chp_1",
      orderIndex: 1,
      heading: "Background of the study",
      wordBudget: 400,
      status: "drafting",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(chapterVersions).values({
      id: "ver_1",
      chapterId: "chp_1",
      version: 1,
      contentR2Key: "chapters/prj_w/chp_1/v1.md",
      wordCount: 410,
      pageCount: 2,
      createdBy: "ai",
      createdAt: now,
    });
    await db.insert(claims).values({
      id: "clm_1",
      sectionId: "sec_1",
      chapterId: "chp_1",
      text: "Solar microgrids raised vaccine refrigerator uptime from 61% to 97%.",
      citationId: retrieved[0]!.citationId,
      passageId: retrieved[0]!.passageId,
      verdict: "supported",
      verified: true,
      createdAt: now,
    });

    await expect(
      db.insert(chapterVersions).values({
        id: "ver_dup",
        chapterId: "chp_1",
        version: 1,
        contentR2Key: "chapters/prj_w/chp_1/v1-dup.md",
        wordCount: 100,
        pageCount: 1,
        createdBy: "ai",
        createdAt: now,
      })
    ).rejects.toThrow();
  });

  it("normalizes @-prefixed citeKeys and extracts multi-key prose claims for claim verification", async () => {
    expect(normalizeCiteKey("@poncedvila2026")).toBe("poncedvila2026");
    expect(normalizeCiteKey("[@darvish2024]")).toBe("darvish2024");
    expect(normalizeCiteKey("karimzadeh2022")).toBe("karimzadeh2022");

    const passages = [
      {
        passageId: "psg_1",
        sourceId: "src_1",
        citationId: "cit_1",
        citeKey: "poncedvila2026",
        sourceTitle: "Beetroot Juice Meta-Analysis",
        year: 2026,
        location: "results",
        text: "Beetroot juice supplementation reduced oxidative stress markers across seven clinical trials.",
        score: 0.95,
      },
      {
        passageId: "psg_2",
        sourceId: "src_2",
        citationId: "cit_2",
        citeKey: "darvish2024",
        sourceTitle: "Nitrate Vascular Study",
        year: 2024,
        location: "abstract",
        text: "Dietary nitrate lowered reactive oxygen species bioactivity by 25%.",
        score: 0.9,
      },
    ];

    // Case 1: Model returns @-prefixed citeKey in JSON claims AND one hallucinated key
    let verifyCalls = 0;
    const resultAtPrefix = await draftAndVerifySection(
      {
        workflowId: "wf_norm_1",
        projectId: "prj_w",
        topic: "Beetroot oxidative stress",
        chapterTitle: "Introduction",
        sectionHeading: "Background",
        wordBudget: 200,
        spelling: "uk",
        priorSummaryText: "",
        glossaryText: "",
        passages,
        spendCapUsd: 1,
      },
      {
        db,
        env: {
          CLOUDFLARE_ACCOUNT_ID: "acct_1",
          CLOUDFLARE_AI_GATEWAY_ID: "gw_1",
          ANTHROPIC_API_KEY: "sk-ant-test",
          APP_ENV: "dev",
        },
        fetchFn: async (_url, init) => {
          const body = JSON.parse(String(init?.body ?? "{}")) as { system?: string };
          if ((body.system ?? "").includes("fact-checker")) {
            verifyCalls++;
            return Response.json({
              id: "msg_ver_1",
              model: "claude-sonnet-4-5",
              stop_reason: "end_turn",
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    results: [{ index: 0, verdict: "supported", notes: "Matches passage" }],
                  }),
                },
              ],
              usage: { input_tokens: 50, output_tokens: 30 },
            });
          }
          return Response.json({
            id: "msg_draft_1",
            model: "claude-sonnet-4-5",
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  prose:
                    "Beetroot juice lowers oxidative stress markers [@poncedvila2026]. Dietary nitrate reduces ROS by 25% [@darvish2024].",
                  claims: [
                    {
                      text: "Beetroot juice lowers oxidative stress markers.",
                      citeKey: "@poncedvila2026",
                      passageId: "psg_1",
                    },
                    {
                      text: "Fabricated claim that must be ignored.",
                      citeKey: "@hallucinated2099",
                      passageId: "psg_1",
                    },
                  ],
                }),
              },
            ],
            usage: { input_tokens: 100, output_tokens: 80 },
          });
        },
        nowFn: () => now.getTime(),
      }
    );

    expect(verifyCalls).toBe(1);
    expect(resultAtPrefix.claims).toHaveLength(1);
    expect(resultAtPrefix.claims[0]?.citeKey).toBe("poncedvila2026");

    // Case 2: Model omits claims array but cites multi-key bracket [@poncedvila2026; @darvish2024]
    let multiVerifyCount = 0;
    const resultMultiKey = await draftAndVerifySection(
      {
        workflowId: "wf_norm_2",
        projectId: "prj_w",
        topic: "Beetroot oxidative stress",
        chapterTitle: "Introduction",
        sectionHeading: "Background",
        wordBudget: 200,
        spelling: "uk",
        priorSummaryText: "",
        glossaryText: "",
        passages,
        spendCapUsd: 1,
      },
      {
        db,
        env: {
          CLOUDFLARE_ACCOUNT_ID: "acct_1",
          CLOUDFLARE_AI_GATEWAY_ID: "gw_1",
          ANTHROPIC_API_KEY: "sk-ant-test",
          APP_ENV: "dev",
        },
        fetchFn: async (_url, init) => {
          const body = JSON.parse(String(init?.body ?? "{}")) as { system?: string };
          if ((body.system ?? "").includes("fact-checker")) {
            multiVerifyCount++;
            return Response.json({
              id: "msg_ver_2",
              model: "claude-sonnet-4-5",
              stop_reason: "end_turn",
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    results: [
                      { index: 0, verdict: "supported", notes: "Supported" },
                      { index: 1, verdict: "supported", notes: "Supported" },
                    ],
                  }),
                },
              ],
              usage: { input_tokens: 50, output_tokens: 30 },
            });
          }
          return Response.json({
            id: "msg_draft_2",
            model: "claude-sonnet-4-5",
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  prose:
                    "Combined trials show nitrate-rich beetroot lowers oxidative stress [@poncedvila2026; @darvish2024].",
                  claims: [],
                }),
              },
            ],
            usage: { input_tokens: 100, output_tokens: 80 },
          });
        },
        nowFn: () => now.getTime(),
      }
    );

    expect(multiVerifyCount).toBe(1);
    expect(resultMultiKey.claims).toHaveLength(2);
    expect(resultMultiKey.claims.map((c) => c.citeKey).sort()).toEqual([
      "darvish2024",
      "poncedvila2026",
    ]);
  });

  it("parses existing chapter sections and targets ONLY affected sections for surgical revision", () => {
    const plan = [
      { sectionId: "sec_1", orderIndex: 1, heading: "Background of the study" },
      { sectionId: "sec_2", orderIndex: 2, heading: "Statement of the problem" },
      { sectionId: "sec_3", orderIndex: 3, heading: "Aim and objectives" },
    ];
    const existingMd = [
      "# Chapter 1: Introduction",
      "",
      "## 1.1 Background of the study",
      "",
      "Original untouched background paragraph [@poncedvila2026].",
      "",
      "## 1.2 Statement of the problem",
      "",
      "Original problem paragraph needing expansion.",
      "",
      "## 1.3 Aim and objectives",
      "",
      "Original objectives list stays untouched.",
    ].join("\n");

    const parsed = parseExistingChapterSections(existingMd, plan);
    expect(parsed.sec_1).toBe("Original untouched background paragraph [@poncedvila2026].");
    expect(parsed.sec_2).toBe("Original problem paragraph needing expansion.");
    expect(parsed.sec_3).toBe("Original objectives list stays untouched.");

    // Explicit dotted section reference targets ONLY sec_2
    expect(
      matchExplicitRevisionTargets({
        chapterNumber: 1,
        revisionInstructions: "In section 1.2, add more context on ethanol hepatic stress.",
        sectionPlan: plan,
      })
    ).toEqual(["sec_2"]);

    // Explicit UI heading dropdown selection targets ONLY sec_3
    expect(
      matchExplicitRevisionTargets({
        chapterNumber: 1,
        revisionInstructions: "Tighten the wording slightly.",
        sectionPlan: plan,
        explicitTargetHeadings: ["Aim and objectives"],
      })
    ).toEqual(["sec_3"]);

    // Whole-chapter request returns empty explicit match so classifier/all-section mode applies
    expect(
      matchExplicitRevisionTargets({
        chapterNumber: 1,
        revisionInstructions: "Make the tone more formal across the entire chapter.",
        sectionPlan: plan,
      })
    ).toEqual([]);
  });
});
