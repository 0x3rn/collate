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
});
