import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { createProjectForUser } from "@/db/queries/projects";
import { researchRuns, sourcePassages, sources, users } from "@/db/schema";
import {
  handleSignIn,
  handleSignUp,
  handleVerifyEmail,
  type HttpAuthDeps,
} from "@/lib/auth/http-handlers";
import type { EmailMessage, EmailSender } from "@/lib/email/mailer";
import type { R2WritableBucket } from "@/lib/pdf/render-pdf";
import type { SourceConnector } from "@/lib/research/connectors/types";
import { handleGetResearchStatus, handleStartResearchSweep } from "@/lib/research/http-handlers";
import { runResearchSweepOrchestration } from "@/lib/research/sweep-orchestrator";
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

describe("Resumable ResearchSweepWorkflow orchestration", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  const now = new Date("2026-11-21T20:00:00.000Z");

  beforeEach(async () => {
    d1Ctx = createInMemoryD1();
    d1Ctx.applyMigrations();
    db = createDb(d1Ctx.d1);

    await db.insert(users).values({
      id: "usr_sweep",
      email: "sweep@uni.edu",
      emailVerified: true,
      name: "Sweep Tester",
      creditsBalance: 10,
      createdAt: now,
      updatedAt: now,
    });
    await createProjectForUser(db, {
      id: "prj_sweep",
      userId: "usr_sweep",
      type: "thesis",
      title: "Solar Microgrid Reliability in Rural Clinics",
      now,
    });
    await db.insert(researchRuns).values({
      id: "run_resume_1",
      projectId: "prj_sweep",
      status: "queued",
      startedAt: now,
      updatedAt: now,
    });
  });

  afterEach(() => {
    d1Ctx.close();
  });

  it("resumes an interrupted sweep without refetching already-completed sources", async () => {
    const fetchCounts = new Map<string, number>();
    const r2Objects = new Map<string, string>();
    let shouldCrashSecondBatch = true;

    const bucket: R2WritableBucket = {
      async put(key, value) {
        r2Objects.set(key, String(value));
      },
    };

    const mockConnector: SourceConnector = {
      name: "mock_scholar",
      kind: "scholarly",
      isEnabled: () => true,
      async search() {
        return [
          {
            url: "https://journal.example/paper-1",
            doi: "10.1000/paper-1",
            title: "Solar Microgrid Reliability Study One",
            authors: ["A. Okonkwo"],
            year: 2024,
            publisher: "Academic Press",
            venue: "Energy Journal",
            sourceType: "peer_reviewed",
            connectorName: "mock_scholar",
            citationCount: 24,
            abstractText: "Solar microgrid reliability in rural clinics improves vaccine uptime.",
            retrievedAt: now,
          },
          {
            url: "https://journal.example/paper-2",
            doi: "10.1000/paper-2",
            title: "Rural Clinic Battery Storage Study Two",
            authors: ["B. Mensah"],
            year: 2025,
            publisher: "Academic Press",
            venue: "Health Infrastructure",
            sourceType: "peer_reviewed",
            connectorName: "mock_scholar",
            citationCount: 15,
            abstractText: "Battery storage resilience for rural health facilities.",
            retrievedAt: now,
          },
        ];
      },
    };

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/robots.txt") || url.includes("unpaywall.org")) {
        return new Response("", { status: 404 });
      }
      fetchCounts.set(url, (fetchCounts.get(url) ?? 0) + 1);
      const body = `<html><body><article><p>Empirical rural clinic solar microgrid study at ${url}. ${"Detailed evidence. ".repeat(35)}</p></article></body></html>`;
      return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
    };

    const stepRunner = {
      planQueries: <T>(fn: () => Promise<T>) => fn(),
      searchAndDedupe: <T>(fn: () => Promise<T>) => fn(),
      fetchBatch: async <T>(batchIdx: number, fn: () => Promise<T>) => {
        if (batchIdx === 1 && shouldCrashSecondBatch) {
          throw new Error("Simulated worker crash before batch 2");
        }
        return fn();
      },
      scoreAndFinalize: <T>(fn: () => Promise<T>) => fn(),
    };

    await expect(
      runResearchSweepOrchestration({ runId: "run_resume_1", projectId: "prj_sweep" }, stepRunner, {
        db,
        bucket,
        connectorEnv: {},
        connectors: [mockConnector],
        fetchFn: mockFetch,
        nowFn: () => now,
        batchSize: 1,
      })
    ).rejects.toThrow("Simulated worker crash");

    const [failedRun] = await db
      .select()
      .from(researchRuns)
      .where(eq(researchRuns.id, "run_resume_1"));
    expect(failedRun?.status).toBe("failed");
    expect(fetchCounts.get("https://journal.example/paper-1")).toBe(1);
    expect(fetchCounts.get("https://journal.example/paper-2")).toBeUndefined();

    shouldCrashSecondBatch = false;
    const finalResult = await runResearchSweepOrchestration(
      { runId: "run_resume_1", projectId: "prj_sweep" },
      stepRunner,
      {
        db,
        bucket,
        connectorEnv: {},
        connectors: [mockConnector],
        fetchFn: mockFetch,
        nowFn: () => now,
        batchSize: 1,
      }
    );

    expect(finalResult.status).toBe("completed");
    expect(finalResult.totalSources).toBe(2);
    expect(finalResult.fetchedSources).toBe(2);

    expect(fetchCounts.get("https://journal.example/paper-1")).toBe(1);
    expect(fetchCounts.get("https://journal.example/paper-2")).toBe(1);

    const storedSources = await db.select().from(sources).where(eq(sources.projectId, "prj_sweep"));
    expect(storedSources.every((s) => Boolean(s.doi) && s.credibilityScore > 60)).toBe(true);
    const storedPassages = await db
      .select()
      .from(sourcePassages)
      .where(eq(sourcePassages.projectId, "prj_sweep"));
    expect(storedPassages.length).toBeGreaterThanOrEqual(2);
    expect(r2Objects.size).toBe(2);
  });
});

describe("Research Sweep HTTP API (idempotency and cross-user isolation)", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  let sent: EmailMessage[];
  let authDeps: HttpAuthDeps;
  const now = new Date("2026-11-21T20:15:00.000Z");

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
        body: JSON.stringify({ name, email, password, turnstileToken: "ok" }),
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

  it("prevents duplicate concurrent runs and blocks other users with 404", async () => {
    const alice = await signUpCookie("Alice", "alice.r@uni.edu", "quiet warm oak library");
    const bob = await signUpCookie("Bob", "bob.r@uni.edu", "calm winter slate harbor");

    await createProjectForUser(db, {
      id: "prj_alice_r",
      userId: alice.userId,
      type: "research",
      title: "Water Purification Membranes",
      now,
    });

    let launchCount = 0;
    const launcher = {
      async create() {
        launchCount++;
        return { id: `wf_inst_${launchCount}` };
      },
    };

    const first = await handleStartResearchSweep(
      new Request("https://collate.app/api/projects/prj_alice_r/research", {
        method: "POST",
        headers: { origin: "https://collate.app", cookie: alice.cookie },
      }),
      "prj_alice_r",
      { ...authDeps, workflowLauncher: launcher }
    );
    expect(first.status).toBe(202);
    const firstJson = (await first.json()) as { runId: string; alreadyRunning: boolean };
    expect(firstJson.alreadyRunning).toBe(false);

    const second = await handleStartResearchSweep(
      new Request("https://collate.app/api/projects/prj_alice_r/research", {
        method: "POST",
        headers: { origin: "https://collate.app", cookie: alice.cookie },
      }),
      "prj_alice_r",
      { ...authDeps, workflowLauncher: launcher }
    );
    const secondJson = (await second.json()) as { runId: string; alreadyRunning: boolean };
    expect(secondJson.alreadyRunning).toBe(true);
    expect(secondJson.runId).toBe(firstJson.runId);
    expect(launchCount).toBe(1);

    const bobGet = await handleGetResearchStatus(
      new Request("https://collate.app/api/projects/prj_alice_r/research", {
        headers: { cookie: bob.cookie },
      }),
      "prj_alice_r",
      authDeps
    );
    expect(bobGet.status).toBe(404);
  });

  it("grants 3 free sweeps, requires 2 credits on the 4th sweep (402 if empty), and refunds on workflow crash", async () => {
    const alice = await signUpCookie(
      "Alice Quota",
      "alice.quota@uni.edu",
      "steady archive shelf lamp"
    );
    await createProjectForUser(db, {
      id: "prj_quota",
      userId: alice.userId,
      type: "research",
      title: "Solar Desalination Efficiency",
      now,
    });

    // Seed 3 completed free sweeps
    for (let i = 1; i <= 3; i++) {
      await db.insert(researchRuns).values({
        id: `run_free_${i}`,
        projectId: "prj_quota",
        status: "completed",
        startedAt: now,
        updatedAt: now,
      });
    }

    // 4th sweep with 0 credits -> 402
    const blocked = await handleStartResearchSweep(
      new Request("https://collate.app/api/projects/prj_quota/research", {
        method: "POST",
        headers: { origin: "https://collate.app", cookie: alice.cookie },
      }),
      "prj_quota",
      authDeps
    );
    expect(blocked.status).toBe(402);

    // Grant 5 credits -> 4th sweep reserves 2 credits
    await db.update(users).set({ creditsBalance: 5 }).where(eq(users.id, alice.userId));
    let capturedResId: string | null | undefined;
    const paid = await handleStartResearchSweep(
      new Request("https://collate.app/api/projects/prj_quota/research", {
        method: "POST",
        headers: { origin: "https://collate.app", cookie: alice.cookie },
      }),
      "prj_quota",
      {
        ...authDeps,
        workflowLauncher: {
          async create(opts) {
            capturedResId = opts.params.reservationId;
            return { id: "wf_paid_4" };
          },
        },
      }
    );
    expect(paid.status).toBe(202);
    const paidJson = (await paid.json()) as {
      runId: string;
      creditsReserved: number;
      reservationId: string;
    };
    expect(paidJson.creditsReserved).toBe(2);
    expect(capturedResId).toBe(paidJson.reservationId);

    const [afterReserve] = await db.select().from(users).where(eq(users.id, alice.userId));
    expect(afterReserve?.creditsBalance).toBe(3);

    // Simulate sweep failure -> reservation is automatically refunded in full
    await expect(
      runResearchSweepOrchestration(
        {
          runId: paidJson.runId,
          projectId: "prj_quota",
          reservationId: paidJson.reservationId,
        },
        {
          planQueries: async () => {
            throw new Error("Simulated provider outage");
          },
          searchAndDedupe: (fn) => fn(),
          fetchBatch: (_i, fn) => fn(),
          scoreAndFinalize: (fn) => fn(),
        },
        {
          db,
          bucket: { async put() {} },
          connectorEnv: {},
          nowFn: () => now,
        }
      )
    ).rejects.toThrow("Simulated provider outage");

    const [afterRefund] = await db.select().from(users).where(eq(users.id, alice.userId));
    expect(afterRefund?.creditsBalance).toBe(5);
  });
});
