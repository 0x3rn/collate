import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { createProjectForUser } from "@/db/queries/projects";
import { getWizardStateForUser } from "@/db/queries/wizard";
import { feasibilityReports, projects, researchRuns, users } from "@/db/schema";
import type { R2WritableBucket } from "@/lib/pdf/render-pdf";
import type { SourceConnector } from "@/lib/research/connectors/types";
import { runResearchSweepOrchestration } from "@/lib/research/sweep-orchestrator";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

describe("Phase 4 — Real Feasibility Gate integrated into ResearchSweepWorkflow", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  const now = new Date("2026-11-21T21:00:00.000Z");

  beforeEach(async () => {
    d1Ctx = createInMemoryD1();
    d1Ctx.applyMigrations();
    db = createDb(d1Ctx.d1);

    await db.insert(users).values({
      id: "usr_p4",
      email: "p4@uni.edu",
      emailVerified: true,
      name: "Phase Four Tester",
      creditsBalance: 20,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterEach(() => {
    d1Ctx.close();
  });

  const noopBucket: R2WritableBucket = {
    async put() {},
  };

  const immediateSteps = {
    planQueries: <T>(fn: () => Promise<T>) => fn(),
    searchAndDedupe: <T>(fn: () => Promise<T>) => fn(),
    fetchBatch: <T>(_idx: number, fn: () => Promise<T>) => fn(),
    scoreAndFinalize: <T>(fn: () => Promise<T>) => fn(),
  };

  it("persists a real FEASIBLE report, primary-data NN-4 notice, idealPages, and advances wizardStep to 4", async () => {
    await createProjectForUser(db, {
      id: "prj_p4_ok",
      userId: "usr_p4",
      type: "project",
      title:
        "A survey of rural clinic nurses on solar microgrid uptime and battery storage in Nigeria",
      now,
    });
    await db.insert(researchRuns).values({
      id: "run_p4_ok",
      projectId: "prj_p4_ok",
      status: "queued",
      startedAt: now,
      updatedAt: now,
    });

    const publishers = ["Elsevier", "Springer", "IEEE", "WHO", "World Bank", "Oxford"];
    const richConnector: SourceConnector = {
      name: "mock_rich",
      kind: "scholarly",
      isEnabled: () => true,
      async search() {
        return Array.from({ length: 12 }, (_, i) => ({
          url: `https://pub${i % 6}.edu/solar-clinic-study-${i}`,
          doi: `10.1000/solar-clinic-${i}`,
          title: `${["Theoretical foundations", "Empirical outcomes", "Battery degradation", "Nurse workflow survey", "Vaccine cold-chain uptime", "Lifecycle cost economics", "Rural clinic policy barriers", "Diesel hybrid comparison", "Inverter fault rates", "Maintenance governance", "Primary healthcare electrification", "Off-grid storage sizing"][i]} of solar microgrid uptime in rural Nigerian clinics`,
          authors: [`Author ${i}`],
          year: 2022 + (i % 4),
          publisher: publishers[i % publishers.length],
          venue: "Energy and Health Journal",
          sourceType: "peer_reviewed" as const,
          connectorName: "mock_rich",
          citationCount: 25 + i * 5,
          abstractText:
            "Survey of rural clinic nurses examining solar microgrid uptime, battery storage reliability, theoretical foundations, methodology, challenges, and policy outcomes in Nigeria.",
          retrievedAt: now,
        }));
      },
    };

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/robots.txt") || url.includes("unpaywall.org")) {
        return new Response("", { status: 404 });
      }
      const body =
        "Solar microgrid uptime and battery storage empirical outcomes in rural clinics. ".repeat(
          18
        );
      return new Response(`<html><body><article><p>${body}</p></article></body></html>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };

    const out = await runResearchSweepOrchestration(
      { runId: "run_p4_ok", projectId: "prj_p4_ok" },
      immediateSteps,
      {
        db,
        bucket: noopBucket,
        connectorEnv: {},
        connectors: [richConnector],
        fetchFn: mockFetch,
        nowFn: () => now,
      }
    );

    expect(out.verdict).toBe("feasible");
    expect(out.requiresPrimaryData).toBe(true);
    expect(out.idealPages).toBeGreaterThanOrEqual(40);
    expect(out.idealPages).toBeLessThanOrEqual(70);

    const [proj] = await db.select().from(projects).where(eq(projects.id, "prj_p4_ok"));
    expect(proj?.status).toBe("feasible");
    expect(proj?.wizardStep).toBe(4);
    expect(proj?.idealPages).toBe(out.idealPages);

    const hydrated = await getWizardStateForUser(db, "usr_p4", "prj_p4_ok");
    expect(hydrated?.feasibilityReports).toHaveLength(1);
    expect(hydrated?.feasibilityReports[0]?.isMocked).toBe(false);
    expect(hydrated?.feasibilityReports[0]?.coverage.requiresPrimaryData).toBe(true);
    expect(hydrated?.feasibilityReports[0]?.coverage.primaryDataNotice).toContain("NN-4");
  });

  it("blocks nonsense/zero-evidence topics at Step 3 with NOT_FEASIBLE verdict (NN-1)", async () => {
    await createProjectForUser(db, {
      id: "prj_p4_bad",
      userId: "usr_p4",
      type: "thesis",
      title: "asdfghjkl qwrtypsdfg zxcvbnm",
      now,
    });
    await db.insert(researchRuns).values({
      id: "run_p4_bad",
      projectId: "prj_p4_bad",
      status: "queued",
      startedAt: now,
      updatedAt: now,
    });

    const emptyConnector: SourceConnector = {
      name: "mock_empty",
      kind: "scholarly",
      isEnabled: () => true,
      async search() {
        return [];
      },
    };

    const out = await runResearchSweepOrchestration(
      { runId: "run_p4_bad", projectId: "prj_p4_bad" },
      immediateSteps,
      {
        db,
        bucket: noopBucket,
        connectorEnv: {},
        connectors: [emptyConnector],
        fetchFn: async () => new Response("", { status: 404 }),
        nowFn: () => now,
      }
    );

    expect(out.verdict).toBe("not_feasible");
    const [proj] = await db.select().from(projects).where(eq(projects.id, "prj_p4_bad"));
    expect(proj?.status).toBe("not_feasible");
    expect(proj?.wizardStep).toBe(3);

    const reports = await db
      .select()
      .from(feasibilityReports)
      .where(eq(feasibilityReports.projectId, "prj_p4_bad"));
    expect(reports).toHaveLength(1);
    expect(reports[0]?.verdict).toBe("not_feasible");
    expect(reports[0]?.isMocked).toBe(false);
  });
});
