import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import {
  getProjectOutlineForUser,
  OutlineError,
  saveConfirmedOutlineForUser,
  setOutlineLockForUser,
} from "@/db/queries/outline";
import { createWizardDraftProject, saveWizardStepForUser } from "@/db/queries/wizard";
import { projectMemory, sections, users } from "@/db/schema";
import {
  buildProjectOutlinePlan,
  classifyChapterTitle,
  validateConfirmedOutline,
} from "@/lib/outline/planner";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

describe("Phase 5 — Chapter Classifier, Appendix A Templates & Budget Math", () => {
  it("classifies standard and practical Project chapter titles and flags ambiguous custom titles", () => {
    const intro = classifyChapterTitle("Introduction and Problem Context", "thesis");
    expect(intro.chapterType).toBe("introduction");
    expect(intro.needsConfirmation).toBe(false);
    expect(intro.defaultSections).toContain("Statement of the problem");

    const sysDesign = classifyChapterTitle("System Design and Architecture", "project");
    expect(sysDesign.chapterType).toBe("system_design");
    expect(sysDesign.needsConfirmation).toBe(false);

    const ambiguous = classifyChapterTitle("Lagos Peri-Urban Energy Landscape", "thesis");
    expect(ambiguous.chapterType).toBe("custom");
    expect(ambiguous.confidence).toBe("ambiguous");
    expect(ambiguous.needsConfirmation).toBe(true);
    expect(ambiguous.inferredPurpose).toContain("This chapter will");
  });

  it("allocates chapter page budgets summing within 2% of target across multiple lengths", () => {
    for (const targetPages of [15, 45, 60, 80, 120, 200]) {
      const plan = buildProjectOutlinePlan({
        projectType: "thesis",
        targetPages,
        lineSpacing: "double",
        fontSizePt: 12,
        chapters: [
          { number: 1, title: "Introduction" },
          { number: 2, title: "Literature Review" },
          { number: 3, title: "Methodology" },
          { number: 4, title: "Results and Findings" },
          { number: 5, title: "Discussion" },
          { number: 6, title: "Conclusion" },
          { number: 7, title: "References", isAutoReferences: true },
        ],
      });

      const validation = validateConfirmedOutline(plan);
      expect(validation.valid).toBe(true);
      expect(validation.varianceRatio).toBeLessThanOrEqual(0.02);
      expect(validation.allocatedPages).toBe(targetPages);
    }
  });

  it("blocks silent confirmation when an ambiguous/custom chapter is unconfirmed or budgets drift > 2%", () => {
    const plan = buildProjectOutlinePlan({
      projectType: "thesis",
      targetPages: 60,
      lineSpacing: "double",
      chapters: [
        { number: 1, title: "Introduction" },
        { number: 2, title: "Regional Perspectives in West Africa" },
        { number: 3, title: "Conclusion" },
      ],
    });

    const beforeConfirm = validateConfirmedOutline(plan);
    expect(beforeConfirm.valid).toBe(false);
    expect(beforeConfirm.errors[0]).toContain("Confirm or edit the purpose");

    plan.chapters[1]!.purposeConfirmed = true;
    expect(validateConfirmedOutline(plan).valid).toBe(true);

    plan.chapters[0]!.pageBudget = 5;
    plan.chapters[1]!.pageBudget = 5;
    plan.chapters[2]!.pageBudget = 5;
    const drifted = validateConfirmedOutline(plan);
    expect(drifted.valid).toBe(false);
    expect(drifted.errors[0]).toContain("2%");
  });
});

describe("Phase 5 — D1 project_memory, sections persistence, locking & Assignment mode", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  const now = new Date("2026-11-21T22:00:00.000Z");

  beforeEach(async () => {
    d1Ctx = createInMemoryD1();
    d1Ctx.applyMigrations();
    db = createDb(d1Ctx.d1);

    for (const [id, email, name] of [
      ["usr_a", "a@uni.edu", "Alice"],
      ["usr_b", "b@uni.edu", "Bob"],
    ] as const) {
      await db.insert(users).values({
        id,
        email,
        emailVerified: true,
        name,
        creditsBalance: 20,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  afterEach(() => {
    d1Ctx.close();
  });

  it("persists confirmed outline to project_memory + sections, enforces lock, and allows explicit unlock", async () => {
    const draft = await createWizardDraftProject(db, "usr_a", "thesis", now);
    await saveWizardStepForUser(db, "usr_a", draft.project.id, { step: 4, targetPages: 60 }, now);

    const initial = await getProjectOutlineForUser(db, "usr_a", draft.project.id);
    expect(initial?.hasSavedOutline).toBe(false);
    expect(initial?.outline.chapters.length).toBeGreaterThanOrEqual(5);

    const saved = await saveConfirmedOutlineForUser(
      db,
      "usr_a",
      draft.project.id,
      initial!.outline,
      now
    );
    expect(saved.hasSavedOutline).toBe(true);

    const [mem] = await db
      .select()
      .from(projectMemory)
      .where(eq(projectMemory.projectId, draft.project.id));
    expect(mem?.outlineLocked).toBe(false);

    const allSections = await db.select().from(sections);
    expect(allSections.length).toBeGreaterThanOrEqual(15);

    await setOutlineLockForUser(db, "usr_a", draft.project.id, true, now);
    await expect(
      saveConfirmedOutlineForUser(db, "usr_a", draft.project.id, saved.outline, now)
    ).rejects.toMatchObject({ code: "OUTLINE_LOCKED", status: 409 });

    await setOutlineLockForUser(db, "usr_a", draft.project.id, false, now);
    const revised = await saveConfirmedOutlineForUser(
      db,
      "usr_a",
      draft.project.id,
      saved.outline,
      now
    );
    expect(revised.hasSavedOutline).toBe(true);

    expect(await getProjectOutlineForUser(db, "usr_b", draft.project.id)).toBeNull();
    await expect(setOutlineLockForUser(db, "usr_b", draft.project.id, false, now)).rejects.toThrow(
      OutlineError
    );
  });

  it("builds and persists per-question answer plans for Assignment mode", async () => {
    const draft = await createWizardDraftProject(db, "usr_a", "assignment", now);
    await saveWizardStepForUser(
      db,
      "usr_a",
      draft.project.id,
      {
        step: 2,
        title: "Development Economics Assignment",
        questions: [
          "Explain Harrod-Domar growth model assumptions.",
          "Compare export-led growth and import substitution.",
          "Analyze microfinance repayment incentives in rural cooperatives.",
        ],
      },
      now
    );
    await saveWizardStepForUser(db, "usr_a", draft.project.id, { step: 4, targetPages: 12 }, now);

    const loaded = await getProjectOutlineForUser(db, "usr_a", draft.project.id);
    expect(loaded?.outline.assignmentPlans).toHaveLength(3);
    const total = loaded!.outline.assignmentPlans.reduce((s, q) => s + q.pageBudget, 0);
    expect(total).toBe(12);

    const saved = await saveConfirmedOutlineForUser(
      db,
      "usr_a",
      draft.project.id,
      loaded!.outline,
      now
    );
    expect(saved.hasSavedOutline).toBe(true);
  });
});
