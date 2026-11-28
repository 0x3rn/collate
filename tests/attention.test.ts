import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { createProjectForUser } from "@/db/queries/projects";
import { chapters, chapterVersions, originalityReports, users } from "@/db/schema";
import {
  buildOriginalityAttention,
  classifyChapterRuntimeError,
  loadChapterAttentionMap,
  recordChapterNeedsAttentionAudit,
} from "@/lib/writing/attention";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

describe("Chapter attention classification, masking, and D1 persistence", () => {
  let ctx: InMemoryD1Context;
  let db: AppDb;
  const now = new Date("2026-11-24T08:00:00.000Z");

  beforeEach(async () => {
    ctx = createInMemoryD1();
    ctx.applyMigrations();
    db = createDb(ctx.d1);

    await db.insert(users).values({
      id: "usr_att",
      email: "student@uni.edu",
      emailVerified: true,
      name: "Adaeze",
      creditsBalance: 20,
      createdAt: now,
      updatedAt: now,
    });
    await createProjectForUser(db, {
      id: "prj_att",
      userId: "usr_att",
      type: "project",
      title: "Beetroot Oxidative Stress Study",
      now,
    });
    await db.insert(chapters).values([
      {
        id: "ch_tech",
        projectId: "prj_att",
        number: 1,
        title: "Introduction",
        chapterType: "introduction",
        status: "needs_attention",
        isAutoReferences: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "ch_orig",
        projectId: "prj_att",
        number: 2,
        title: "Literature Review",
        chapterType: "literature_review",
        status: "needs_attention",
        isAutoReferences: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  afterEach(() => {
    ctx.close();
  });

  it("masks Cloudflare subrequest and provider errors completely from user-facing text", () => {
    const { attention, internalReason } = classifyChapterRuntimeError(
      new Error(
        "LLMError: Network error contacting google LLM endpoint: Too many subrequests by single Worker invocation. https://developers.cloudflare.com"
      )
    );

    expect(attention.kind).toBe("technical_error");
    expect(attention.inputType).toBe("none");
    expect(attention.userMessage).not.toMatch(
      /cloudflare|subrequest|google|llm|worker|http|endpoint/i
    );
    expect(attention.userMessage.toLowerCase()).toContain("temporary service issue");
    expect(attention.userMessage.toLowerCase()).toContain("refunded");
    expect(internalReason).toContain("Too many subrequests");
  });

  it("records and reloads structured attention state, and falls back cleanly for legacy paused chapters", async () => {
    const origAttention = buildOriginalityAttention({ overlapScore: 18, quoteSharePct: 4 });
    await recordChapterNeedsAttentionAudit(db, {
      userId: "usr_att",
      projectId: "prj_att",
      chapterId: "ch_orig",
      attention: origAttention,
      internalReason: "Originality gate failed",
      now,
    });

    // ch_tech has no audit row yet -> must fall back to safe masked technical_error
    const map = await loadChapterAttentionMap(db, [
      { id: "ch_tech", chapterType: "introduction" },
      { id: "ch_orig", chapterType: "literature_review" },
    ]);

    expect(map.get("ch_tech")?.kind).toBe("technical_error");
    expect(map.get("ch_orig")?.kind).toBe("user_input_required");
    expect(map.get("ch_orig")?.inputType).toBe("originality_guidance");
    expect(map.get("ch_orig")?.userMessage).toContain("18%");

    // When overlap and quotes are both 0%, report paraphrase similarity rather than misleading "0%"
    const semanticOnly = buildOriginalityAttention({
      overlapScore: 0,
      quoteSharePct: 0,
      semanticScore: 93,
      crossUserScore: 0,
    });
    expect(semanticOnly.userMessage).toContain("similar wording 93%");
    expect(semanticOnly.userMessage).not.toContain("matched source text 0%");
  });

  it("detects legacy failed originality report as user_input_required even without audit_log row", async () => {
    await db.insert(chapterVersions).values({
      id: "ver_1",
      chapterId: "ch_orig",
      version: 1,
      contentR2Key: "chapters/prj_att/ch_orig/v1.md",
      wordCount: 800,
      pageCount: 3,
      promptVersion: "v1",
      createdBy: "ai",
      createdAt: now,
    });
    await db.insert(originalityReports).values({
      id: "org_1",
      chapterVersionId: "ver_1",
      chapterId: "ch_orig",
      projectId: "prj_att",
      overlapScore: 22,
      semanticScore: 12,
      quoteSharePct: 3,
      crossUserScore: 0,
      flaggedSpansJson: "[]",
      passed: false,
      waived: false,
      createdAt: now,
    });

    const map = await loadChapterAttentionMap(db, [
      { id: "ch_orig", chapterType: "literature_review" },
    ]);
    expect(map.get("ch_orig")?.kind).toBe("user_input_required");
    expect(map.get("ch_orig")?.inputType).toBe("originality_guidance");
  });
});
