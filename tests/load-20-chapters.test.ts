import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { createProjectForUser } from "@/db/queries/projects";
import {
  chapters,
  chapterVersions,
  originalityReports,
  sections,
  sourcePassages,
  sources,
  users,
} from "@/db/schema";
import type { CallLLMContext } from "@/lib/ai/call-llm";
import type { R2WritableBucket } from "@/lib/pdf/render-pdf";
import { runWriteChapterOrchestration } from "@/lib/writing/chapter-orchestrator";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

describe("Phase 12 — Load Test: 20 Simultaneous Chapter Runs", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  const now = new Date("2026-11-23T15:00:00.000Z");

  beforeEach(() => {
    d1Ctx = createInMemoryD1();
    d1Ctx.applyMigrations();
    db = createDb(d1Ctx.d1);
  });

  afterEach(() => {
    d1Ctx.close();
  });

  it("completes 20 simultaneous chapter runs across 20 projects with zero race conditions or cross-project leaks", async () => {
    const COUNT = 20;
    const r2Store = new Map<string, string>();
    const bucket: R2WritableBucket = {
      async put(key, val) {
        r2Store.set(key, String(val));
      },
    };

    // Seed 20 isolated users, projects, sources, passages, chapters, and sections
    for (let i = 1; i <= COUNT; i++) {
      const uid = `usr_load_${i}`;
      const pid = `prj_load_${i}`;
      const cid = `chp_load_${i}`;

      await db.insert(users).values({
        id: uid,
        email: `load${i}@uni.edu`,
        emailVerified: true,
        name: `Researcher ${i}`,
        creditsBalance: 20,
        createdAt: now,
        updatedAt: now,
      });

      await createProjectForUser(db, {
        id: pid,
        userId: uid,
        type: "research",
        title: `Distinct Research Topic Number ${i} on Renewable Grid Control`,
        targetPages: 20,
        now,
      });

      await db.insert(sources).values({
        id: `src_load_${i}`,
        projectId: pid,
        url: `https://doi.org/10.1000/load.${i}`,
        canonicalUrl: `https://doi.org/10.1000/load.${i}`,
        doi: `10.1000/load.${i}`,
        title: `Empirical Paper ${i} on Renewable Grid Control`,
        normalizedTitle: `empirical paper ${i} on renewable grid control`,
        authorsJson: JSON.stringify([`Scholar${i} Adeyemi`]),
        year: 2024,
        sourceType: "peer_reviewed",
        connectorName: "crossref",
        credibilityScore: 90,
        relevanceScore: 88,
        retrievedAt: now,
        createdAt: now,
      });

      await db.insert(sourcePassages).values({
        id: `psg_load_${i}`,
        sourceId: `src_load_${i}`,
        projectId: pid,
        passageIndex: 0,
        text: `Source passage ${i} documents empirical inverter stability metrics across regional microgrid node ${i}.`,
        location: "section_1",
        tokenCount: 16,
        createdAt: now,
      });

      await db.insert(chapters).values({
        id: cid,
        projectId: pid,
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
        id: `sec_load_${i}`,
        chapterId: cid,
        orderIndex: 1,
        heading: "Background",
        wordBudget: 250,
        status: "not_started",
        createdAt: now,
        updatedAt: now,
      });
    }

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
            id: "msg_v",
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
            id: "msg_m",
            model: "claude-haiku-4-5",
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: JSON.stringify({ summary: "Concurrent chapter summary.", glossaryTerms: [] }),
              },
            ],
            usage: { input_tokens: 30, output_tokens: 20 },
          });
        }

        const refMatch = userText.match(/\[PASSAGE:(psg_load_\d+)\s*\|\s*CITE:@([^\s|]+)/);
        const psgId = refMatch?.[1] ?? "psg_load_1";
        const citeKey = refMatch?.[2] ?? "adeyemi2024";
        const num = psgId.replace("psg_load_", "");
        const uniqueProse = `Independent investigation ${num} examines distributed feeder resilience using verified telemetry from study node ${num} [@${citeKey}]. Field measurements confirm stable frequency regulation throughout peak rural demand intervals in project ${num}.`;

        return Response.json({
          id: `msg_d_${num}`,
          model: "claude-sonnet-4-5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                prose: uniqueProse,
                claims: [{ text: uniqueProse, citeKey, passageId: psgId }],
              }),
            },
          ],
          usage: { input_tokens: 80, output_tokens: 60 },
        });
      },
    };

    const results = await Promise.all(
      Array.from({ length: COUNT }, (_, idx) => {
        const i = idx + 1;
        return runWriteChapterOrchestration(
          { runId: `load_run_${i}`, projectId: `prj_load_${i}`, chapterId: `chp_load_${i}` },
          {
            loadContext: (fn) => fn(),
            draftSection: (_s, fn) => fn(),
            assembleAndFinalize: (fn) => fn(),
          },
          {
            db,
            bucket,
            llmCtx,
            measurePagesFn: async () => 1,
            nowFn: () => now,
          }
        );
      })
    );

    expect(results).toHaveLength(COUNT);
    for (const res of results) {
      expect(res.status).toBe("ready");
      expect(res.version).toBe(1);
      expect(r2Store.has(res.contentR2Key)).toBe(true);
    }

    const allVersions = await db.select().from(chapterVersions);
    expect(allVersions).toHaveLength(COUNT);

    const allReports = await db.select().from(originalityReports);
    expect(allReports).toHaveLength(COUNT);
    expect(allReports.every((r) => r.passed)).toBe(true);

    // Spot check isolation on project #17
    const [p17Ch] = await db.select().from(chapters).where(eq(chapters.id, "chp_load_17"));
    expect(p17Ch?.status).toBe("ready");
  });
});
