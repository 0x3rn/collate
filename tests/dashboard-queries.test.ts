import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import {
  classifyProjectTab,
  deriveProjectNextAction,
  getDashboardOverviewForUser,
  listEnrichedProjectsForUser,
  listExportsForUser,
} from "@/db/queries/dashboard";
import {
  chapters,
  exportsTable,
  projects,
  projectSettings,
  researchRuns,
  sources,
  users,
} from "@/db/schema";
import { verifyExportDownloadParams } from "@/lib/export/signed-urls";
import {
  formatCreditLedgerType,
  formatExportScope,
  formatFileSize,
  getUserInitials,
} from "@/lib/ui/formatters";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

describe("Dashboard data queries, isolation, and UI formatters", () => {
  let ctx: InMemoryD1Context;
  let db: AppDb;
  const fixedNow = new Date("2026-11-23T18:00:00.000Z");
  const testSecret = "test-dashboard-export-signing-secret";

  beforeEach(async () => {
    ctx = createInMemoryD1();
    ctx.applyMigrations();
    db = createDb(ctx.d1);

    for (const [id, email, name, credits] of [
      ["usr_alice", "alice@uni.edu", "Adaeze Okonkwo", 45],
      ["usr_bob", "bob@uni.edu", "Bamidele Mensah", 10],
    ] as const) {
      await db.insert(users).values({
        id,
        email,
        emailVerified: true,
        name,
        creditsBalance: credits,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      });
    }
  });

  afterEach(() => {
    ctx.close();
  });

  it("returns clean empty dashboard overview for a brand new user", async () => {
    const overview = await getDashboardOverviewForUser(db, "usr_alice", {
      signingSecret: testSecret,
      nowMs: fixedNow.getTime(),
    });

    expect(overview.stats).toEqual({
      totalProjects: 0,
      activeProjects: 0,
      completedProjects: 0,
      archivedProjects: 0,
      chaptersReadyForReview: 0,
      chaptersCompleted: 0,
      chaptersTotal: 0,
      verifiedSourcesTotal: 0,
      exportsTotal: 0,
      freeSweepsUsed: 0,
      freeSweepsRemaining: 3,
    });
    expect(overview.spotlightProject).toBeNull();
    expect(overview.attentionItems).toEqual([]);
    expect(overview.recentProjects).toEqual([]);
    expect(overview.recentExports).toEqual([]);
  });

  it("rejects blank userId to prevent unscoped dashboard queries", async () => {
    await expect(getDashboardOverviewForUser(db, "   ")).rejects.toThrow("userId is required");
    await expect(listEnrichedProjectsForUser(db, "")).rejects.toThrow("userId is required");
    await expect(listExportsForUser(db, "")).rejects.toThrow("userId is required");
  });

  it("aggregates active/completed/archived projects, progress, attention priority, exports, and enforces user isolation", async () => {
    const t1 = new Date("2026-11-20T10:00:00.000Z");
    const t2 = new Date("2026-11-22T10:00:00.000Z");
    const t3 = new Date("2026-11-23T12:00:00.000Z");

    // Alice's active in-progress thesis (most recently updated -> spotlight)
    await db.insert(projects).values([
      {
        id: "prj_active",
        userId: "usr_alice",
        type: "thesis",
        title: "Solar Microgrid Reliability in Rural Clinics",
        level: "Masters",
        field: "Energy Engineering",
        institution: "University of Lagos",
        status: "in_progress",
        wizardStep: 8,
        targetPages: 80,
        idealPages: 80,
        createdAt: t1,
        updatedAt: t3,
      },
      {
        id: "prj_refine",
        userId: "usr_alice",
        type: "research",
        title: "Niche Topic Needing Scope Adjustment",
        status: "needs_refinement",
        wizardStep: 3,
        targetPages: 25,
        createdAt: t1,
        updatedAt: t2,
      },
      {
        id: "prj_completed",
        userId: "usr_alice",
        type: "project",
        title: "Campus Waste Sorting Optimization",
        status: "completed",
        wizardStep: 8,
        targetPages: 50,
        createdAt: t1,
        updatedAt: t1,
      },
      {
        id: "prj_archived",
        userId: "usr_alice",
        type: "assignment",
        title: "Old Semester Policy Essay",
        status: "archived",
        wizardStep: 8,
        targetPages: 8,
        createdAt: t1,
        updatedAt: t1,
      },
      // Bob's project (must NEVER appear in Alice's dashboard)
      {
        id: "prj_bob",
        userId: "usr_bob",
        type: "thesis",
        title: "Bob Private Dissertation",
        status: "in_progress",
        wizardStep: 8,
        targetPages: 120,
        createdAt: t3,
        updatedAt: t3,
      },
    ]);

    await db.insert(projectSettings).values([
      {
        projectId: "prj_active",
        citationStyle: "harvard",
        inlineMode: "inline_and_list",
        font: "Times New Roman",
        fontSizePt: 12,
        lineSpacing: "double",
        marginsMm: 25,
        pageNumbering: true,
        spelling: "uk",
        frontMatterJson: "{}",
        coverJson: "{}",
        updatedAt: t3,
      },
      {
        projectId: "prj_bob",
        citationStyle: "ieee",
        inlineMode: "inline_and_list",
        font: "Times New Roman",
        fontSizePt: 12,
        lineSpacing: "double",
        marginsMm: 25,
        pageNumbering: true,
        spelling: "uk",
        frontMatterJson: "{}",
        coverJson: "{}",
        updatedAt: t3,
      },
    ]);

    await db.insert(chapters).values([
      {
        id: "ch_1",
        projectId: "prj_active",
        number: 1,
        title: "Introduction",
        status: "approved",
        isAutoReferences: false,
        createdAt: t1,
        updatedAt: t1,
      },
      {
        id: "ch_2",
        projectId: "prj_active",
        number: 2,
        title: "Literature Review",
        status: "ready",
        isAutoReferences: false,
        createdAt: t1,
        updatedAt: t2,
      },
      {
        id: "ch_3",
        projectId: "prj_active",
        number: 3,
        title: "Methodology",
        status: "needs_attention",
        isAutoReferences: false,
        createdAt: t1,
        updatedAt: t3,
      },
      {
        id: "ch_refs",
        projectId: "prj_active",
        number: 4,
        title: "References",
        status: "not_started",
        isAutoReferences: true,
        createdAt: t1,
        updatedAt: t1,
      },
      {
        id: "ch_bob_1",
        projectId: "prj_bob",
        number: 1,
        title: "Bob Chapter 1",
        status: "needs_attention",
        isAutoReferences: false,
        createdAt: t3,
        updatedAt: t3,
      },
    ]);

    await db.insert(sources).values([
      {
        id: "src_1",
        projectId: "prj_active",
        url: "https://example.org/1",
        canonicalUrl: "https://example.org/1",
        title: "Solar Microgrids",
        normalizedTitle: "solar microgrids",
        connectorName: "openalex",
        retrievedAt: t2,
        createdAt: t2,
      },
      {
        id: "src_2",
        projectId: "prj_active",
        url: "https://example.org/2",
        canonicalUrl: "https://example.org/2",
        title: "Clinic Power Outages",
        normalizedTitle: "clinic power outages",
        connectorName: "crossref",
        retrievedAt: t2,
        createdAt: t2,
      },
      {
        id: "src_bob",
        projectId: "prj_bob",
        url: "https://example.org/bob",
        canonicalUrl: "https://example.org/bob",
        title: "Bob Private Source",
        normalizedTitle: "bob private source",
        connectorName: "openalex",
        retrievedAt: t3,
        createdAt: t3,
      },
    ]);

    await db.insert(researchRuns).values([
      {
        id: "run_1",
        projectId: "prj_active",
        status: "completed",
        startedAt: t1,
        updatedAt: t1,
      },
      {
        id: "run_2",
        projectId: "prj_refine",
        status: "failed",
        startedAt: t2,
        updatedAt: t2,
      },
    ]);

    await db.insert(exportsTable).values([
      {
        id: "exp_alice_1",
        projectId: "prj_completed",
        scope: "full",
        format: "pdf",
        r2Key: "exports/prj_completed/exp_alice_1.pdf",
        pageCount: 52,
        sizeBytes: 1_240_000,
        sha256: "abc123",
        createdAt: t3,
      },
      {
        id: "exp_bob_1",
        projectId: "prj_bob",
        scope: "full",
        format: "docx",
        r2Key: "exports/prj_bob/exp_bob_1.docx",
        pageCount: 90,
        sizeBytes: 980_000,
        sha256: "def456",
        createdAt: t3,
      },
    ]);

    const overview = await getDashboardOverviewForUser(db, "usr_alice", {
      signingSecret: testSecret,
      nowMs: fixedNow.getTime(),
    });

    // Stats (strictly Alice's data; failed sweep does not count against free sweeps)
    expect(overview.stats).toEqual({
      totalProjects: 4,
      activeProjects: 2,
      completedProjects: 1,
      archivedProjects: 1,
      chaptersReadyForReview: 2, // ch_2 (ready) + ch_3 (needs_attention)
      chaptersCompleted: 2, // ch_1 (approved) + ch_2 (ready)
      chaptersTotal: 3, // excludes auto-references chapter
      verifiedSourcesTotal: 2,
      exportsTotal: 1,
      freeSweepsUsed: 1,
      freeSweepsRemaining: 2,
    });

    // Spotlight picks most recently updated active project
    expect(overview.spotlightProject?.id).toBe("prj_active");
    expect(overview.spotlightProject?.citationStyle).toBe("harvard");
    expect(overview.spotlightProject?.nextAction).toEqual({
      href: "/projects/prj_active/chapters/ch_3",
      label: "Review Chapter 3",
    });

    // Attention priority: needs_attention (1) -> ready (2) -> needs_refinement (3), zero Bob items
    expect(overview.attentionItems.map((i) => i.kind)).toEqual([
      "chapter_needs_attention",
      "chapter_ready",
      "topic_refinement",
    ]);
    expect(overview.attentionItems.every((i) => i.projectId !== "prj_bob")).toBe(true);

    // Exports list strictly isolated to Alice and contains verifiable signed download URL
    expect(overview.recentExports).toHaveLength(1);
    const aliceExport = overview.recentExports[0]!;
    expect(aliceExport.id).toBe("exp_alice_1");
    expect(aliceExport.downloadUrl).toContain(
      "/api/projects/prj_completed/exports/exp_alice_1/download?"
    );

    const parsedUrl = new URL(`https://collate.local${aliceExport.downloadUrl!}`);
    const verified = await verifyExportDownloadParams({
      exportId: aliceExport.id,
      projectId: aliceExport.projectId,
      userId: "usr_alice",
      exp: Number(parsedUrl.searchParams.get("exp")),
      sig: parsedUrl.searchParams.get("sig") ?? "",
      secret: testSecret,
      nowMs: fixedNow.getTime(),
    });
    expect(verified.valid).toBe(true);
  });

  it("derives next actions, lifecycle tabs, and plain-language formatters accurately", () => {
    expect(classifyProjectTab("draft")).toBe("active");
    expect(classifyProjectTab("in_progress")).toBe("active");
    expect(classifyProjectTab("completed")).toBe("completed");
    expect(classifyProjectTab("archived")).toBe("archived");

    expect(
      deriveProjectNextAction({
        id: "p1",
        type: "assignment",
        status: "in_progress",
        wizardStep: 8,
        chapters: [{ id: "c1", number: 1, status: "ready", isAutoReferences: false }],
      })
    ).toEqual({ href: "/projects/p1/chapters/c1", label: "Review assignment" });

    expect(formatCreditLedgerType("sweep_fee")).toBe("Topic source check");
    expect(formatCreditLedgerType("refund")).toBe("Automatic refund");
    expect(formatExportScope("chapter", 2)).toBe("Chapter 2");
    expect(formatExportScope("full")).toBe("Full manuscript");
    expect(formatFileSize(1_572_864)).toBe("1.5 MB");
    expect(formatFileSize(512_000)).toBe("500 KB");
    expect(getUserInitials("Adaeze Okonkwo")).toBe("AO");
  });
});
