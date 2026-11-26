import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { createProjectForUser } from "@/db/queries/projects";
import { users } from "@/db/schema";
import { ACADEMIC_LEVELS } from "@/lib/wizard/schema";
import { writingStyleForLevel } from "@/lib/writing/level-style";
import { draftAndVerifySection } from "@/lib/writing/section-pipeline";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

describe("writing style by academic level", () => {
  it("gives every level in setup its own guidance", () => {
    const byLevel = Object.fromEntries(ACADEMIC_LEVELS.map((l) => [l, writingStyleForLevel(l)]));
    expect(byLevel["High school / Secondary"]).toContain("secondary school");
    expect(byLevel["High school / Secondary"]).toContain("short sentences");
    expect(byLevel["Undergraduate"]).toContain("not a doctoral thesis");
    expect(byLevel["Diploma / HND"]).toContain("diploma");
    expect(byLevel["Masters"]).toContain("master's");
    expect(byLevel["PhD"]).toContain("doctoral");
    expect(byLevel["Professional / Independent"]).toContain("professional");
    expect(new Set(Object.values(byLevel)).size).toBe(ACADEMIC_LEVELS.length);
  });

  it("falls back to undergraduate guidance when no level was chosen", () => {
    expect(writingStyleForLevel(null)).toBe(writingStyleForLevel("Undergraduate"));
    expect(writingStyleForLevel("")).toContain("undergraduate");
  });
});

describe("drafting prompt", () => {
  let d1: InMemoryD1Context;
  let db: AppDb;
  beforeEach(async () => {
    d1 = createInMemoryD1();
    d1.applyMigrations();
    db = createDb(d1.d1);
    const now = new Date();
    await db.insert(users).values({
      id: "usr_level",
      email: "level@uni.edu.ng",
      emailVerified: true,
      name: "Level Tester",
      creditsBalance: 0,
      createdAt: now,
      updatedAt: now,
    });
    await createProjectForUser(db, {
      id: "prj_level",
      userId: "usr_level",
      type: "project",
      title: "Kola nut caffeine",
      now,
    });
  });
  afterEach(() => d1.close());

  async function draftSystemPrompt(level: string): Promise<string> {
    let system = "";
    await draftAndVerifySection(
      {
        workflowId: "wf_level",
        projectId: "prj_level",
        topic: "Kola nut caffeine",
        chapterTitle: "Introduction",
        sectionHeading: "Background",
        wordBudget: 150,
        level,
        spelling: "uk",
        priorSummaryText: "",
        glossaryText: "",
        passages: [
          {
            passageId: "psg_1",
            sourceId: "src_1",
            citationId: "cit_1",
            citeKey: "obi2024",
            sourceTitle: "Kola study",
            year: 2024,
            location: "results",
            text: "Kola nuts contain about 2% caffeine by dry weight.",
            score: 0.9,
          },
        ],
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
            return Response.json({
              id: "v",
              model: "claude-sonnet-4-5",
              stop_reason: "end_turn",
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    results: [{ index: 0, verdict: "supported", notes: "" }],
                  }),
                },
              ],
              usage: { input_tokens: 10, output_tokens: 10 },
            });
          }
          system = body.system ?? "";
          return Response.json({
            id: "d",
            model: "claude-sonnet-4-5",
            stop_reason: "end_turn",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  prose: "Kola nuts contain caffeine [@obi2024].",
                  claims: [
                    { text: "Kola nuts contain caffeine.", citeKey: "obi2024", passageId: "psg_1" },
                  ],
                }),
              },
            ],
            usage: { input_tokens: 10, output_tokens: 10 },
          });
        },
      }
    );
    return system;
  }

  it("adds the level guidance right after the level line and keeps every evidence rule", async () => {
    const prompt = await draftSystemPrompt("High school / Secondary");
    const lines = prompt.split("\n");
    const levelLine = lines.findIndex((l) =>
      l.startsWith("Academic level: High school / Secondary")
    );
    expect(levelLine).toBeGreaterThan(-1);
    expect(lines[levelLine + 1]).toBe(writingStyleForLevel("High school / Secondary"));
    expect(lines[levelLine + 2]).toBe("STRICT EVIDENCE RULES (NON-NEGOTIABLE):");
    expect(prompt).toContain("1. Use ONLY the provided passages");
    expect(prompt).toContain("You may cite ONLY these registered citation keys");
  });

  it("uses different guidance for an undergraduate project", async () => {
    const prompt = await draftSystemPrompt("Undergraduate");
    expect(prompt).toContain("not a doctoral thesis");
    expect(prompt).not.toContain("secondary school");
  });
});
