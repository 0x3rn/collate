import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { getWizardStateForUser, type HydratedWizardState } from "@/db/queries/wizard";
import { chapters, projectMemory, projects, researchRuns, sections } from "@/db/schema";
import type { CallLLMContext } from "@/lib/ai/call-llm";
import {
  buildProjectOutlinePlan,
  ProjectOutlinePlanSchema,
  validateConfirmedOutline,
  type ProjectOutlinePlan,
} from "@/lib/outline/planner";
import { getDefaultStructureForWork } from "@/lib/outline/structures";
import { generateTopicTailoredOutline } from "@/lib/outline/topic-outline";

export class OutlineError extends Error {
  public readonly code: "NOT_FOUND" | "VALIDATION_ERROR" | "OUTLINE_LOCKED";
  public readonly status: number;

  constructor(
    code: "NOT_FOUND" | "VALIDATION_ERROR" | "OUTLINE_LOCKED",
    message: string,
    status: number
  ) {
    super(message);
    this.name = "OutlineError";
    this.code = code;
    this.status = status;
  }
}

export interface HydratedOutlineResult {
  projectId: string;
  outlineLocked: boolean;
  hasSavedOutline: boolean;
  outline: ProjectOutlinePlan;
}

function outlineMatchesWizardState(
  saved: ProjectOutlinePlan,
  wizard: HydratedWizardState
): boolean {
  if (saved.projectType !== wizard.project.type) return false;
  if (wizard.project.type === "assignment") {
    if (saved.assignmentPlans.length !== wizard.questions.length) return false;
    return true;
  }

  if (saved.useChapters !== wizard.settings.useChapters) return false;
  if (saved.isExperimental !== wizard.settings.isExperimental) return false;

  const savedContent = saved.chapters
    .filter((c) => !c.isAutoReferences)
    .sort((a, b) => a.number - b.number);
  const wizardContent = wizard.chapters
    .filter((c) => !c.isAutoReferences)
    .sort((a, b) => a.number - b.number);

  if (savedContent.length !== wizardContent.length) return false;
  for (let i = 0; i < savedContent.length; i++) {
    const s = savedContent[i]!;
    const w = wizardContent[i]!;
    if (s.number !== w.number || s.title.trim().toLowerCase() !== w.title.trim().toLowerCase()) {
      return false;
    }
  }
  return true;
}

export async function getProjectOutlineForUser(
  db: AppDb,
  userId: string,
  projectId: string
): Promise<HydratedOutlineResult | null> {
  const wizard = await getWizardStateForUser(db, userId, projectId);
  if (!wizard) return null;

  const [memory] = await db
    .select()
    .from(projectMemory)
    .where(eq(projectMemory.projectId, projectId))
    .limit(1);

  if (memory && memory.outlineJson && memory.outlineJson !== "{}") {
    try {
      const parsed = ProjectOutlinePlanSchema.safeParse(JSON.parse(memory.outlineJson));
      if (
        parsed.success &&
        (memory.outlineLocked || outlineMatchesWizardState(parsed.data, wizard))
      ) {
        return {
          projectId,
          outlineLocked: memory.outlineLocked,
          hasSavedOutline: true,
          outline: parsed.data,
        };
      }
    } catch {
      // Regenerate fresh draft below if stored JSON was empty/legacy
    }
  }

  const chapterIds = wizard.chapters.map((c) => c.id);
  const existingSectionsByChapter = new Map<string, string[]>();
  if (chapterIds.length > 0) {
    const secRows = await db
      .select({
        chapterId: sections.chapterId,
        orderIndex: sections.orderIndex,
        heading: sections.heading,
      })
      .from(sections)
      .where(inArray(sections.chapterId, chapterIds))
      .orderBy(asc(sections.orderIndex));
    for (const s of secRows) {
      const list = existingSectionsByChapter.get(s.chapterId) ?? [];
      list.push(s.heading);
      existingSectionsByChapter.set(s.chapterId, list);
    }
  }

  const targetPages = wizard.project.targetPages ?? wizard.project.idealPages ?? 40;
  const generated = buildProjectOutlinePlan({
    projectType: wizard.project.type,
    targetPages,
    lineSpacing: wizard.settings.lineSpacing,
    fontSizePt: wizard.settings.fontSizePt,
    isExperimental: wizard.settings.isExperimental,
    useChapters: wizard.settings.useChapters,
    chapters: wizard.chapters.map((c) => ({
      id: c.id,
      number: c.number,
      title: c.title,
      chapterType: c.chapterType,
      brief: c.brief,
      existingSections: existingSectionsByChapter.get(c.id),
      isAutoReferences: c.isAutoReferences,
    })),
    questions: wizard.questions.map((q) => ({
      id: q.id,
      orderIndex: q.orderIndex,
      text: q.text,
    })),
  });

  return {
    projectId,
    outlineLocked: memory?.outlineLocked ?? false,
    hasSavedOutline: false,
    outline: generated,
  };
}

export async function saveConfirmedOutlineForUser(
  db: AppDb,
  userId: string,
  projectId: string,
  rawOutline: unknown,
  now: Date = new Date()
): Promise<HydratedOutlineResult> {
  const wizard = await getWizardStateForUser(db, userId, projectId);
  if (!wizard) {
    throw new OutlineError("NOT_FOUND", "Project not found.", 404);
  }

  const [existingMemory] = await db
    .select()
    .from(projectMemory)
    .where(eq(projectMemory.projectId, projectId))
    .limit(1);

  if (existingMemory?.outlineLocked) {
    throw new OutlineError(
      "OUTLINE_LOCKED",
      "This outline is locked because chapter writing has started. Use 'Revise outline' to unlock it first.",
      409
    );
  }

  const parsed = ProjectOutlinePlanSchema.safeParse(rawOutline);
  if (!parsed.success) {
    throw new OutlineError(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Check your outline fields and try again.",
      400
    );
  }

  const outline = parsed.data;
  const validation = validateConfirmedOutline(outline);
  if (!validation.valid) {
    throw new OutlineError(
      "VALIDATION_ERROR",
      validation.errors[0] ?? "Outline validation failed.",
      400
    );
  }

  if (outline.projectType !== "assignment") {
    const existingChapters = await db
      .select()
      .from(chapters)
      .where(eq(chapters.projectId, projectId))
      .orderBy(asc(chapters.number));

    const existingByNumber = new Map(existingChapters.map((c) => [c.number, c]));
    const keptNumbers = new Set(outline.chapters.map((c) => c.number));

    for (const oldCh of existingChapters) {
      if (!keptNumbers.has(oldCh.number)) {
        await db.delete(chapters).where(eq(chapters.id, oldCh.id));
      }
    }

    const updatedChapters = [];
    for (const ch of outline.chapters) {
      const existingCh = existingByNumber.get(ch.number);
      let chapterId: string;

      if (existingCh) {
        chapterId = existingCh.id;
        await db
          .update(chapters)
          .set({
            title: ch.title,
            chapterType: ch.chapterType,
            brief: ch.inferredPurpose,
            pageBudget: ch.isAutoReferences ? null : ch.pageBudget,
            wordBudget: ch.isAutoReferences ? null : ch.wordBudget,
            isAutoReferences: ch.isAutoReferences,
            updatedAt: now,
          })
          .where(eq(chapters.id, chapterId));
      } else {
        chapterId = `chp_${crypto.randomUUID()}`;
        await db.insert(chapters).values({
          id: chapterId,
          projectId,
          number: ch.number,
          title: ch.title,
          chapterType: ch.chapterType,
          brief: ch.inferredPurpose,
          pageBudget: ch.isAutoReferences ? null : ch.pageBudget,
          wordBudget: ch.isAutoReferences ? null : ch.wordBudget,
          isAutoReferences: ch.isAutoReferences,
          status: "not_started",
          createdAt: now,
          updatedAt: now,
        });
      }

      await db.delete(sections).where(eq(sections.chapterId, chapterId));
      for (const sec of ch.sections) {
        await db.insert(sections).values({
          id: `sec_${crypto.randomUUID()}`,
          chapterId,
          orderIndex: sec.orderIndex,
          heading: sec.heading,
          wordBudget: sec.wordBudget,
          status: "not_started",
          createdAt: now,
          updatedAt: now,
        });
      }

      updatedChapters.push({ ...ch, chapterId });
    }

    outline.chapters = updatedChapters;
  }

  await db
    .insert(projectMemory)
    .values({
      projectId,
      outlineJson: JSON.stringify(outline),
      outlineLocked: false,
      chapterSummariesJson: existingMemory?.chapterSummariesJson ?? "[]",
      glossaryJson: existingMemory?.glossaryJson ?? "[]",
      styleNotes: existingMemory?.styleNotes ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: projectMemory.projectId,
      set: {
        outlineJson: JSON.stringify(outline),
        updatedAt: now,
      },
    });

  await db
    .update(projects)
    .set({
      targetPages: outline.targetPages,
      status: "outline_pending",
      wizardStep: 8,
      updatedAt: now,
    })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  return {
    projectId,
    outlineLocked: false,
    hasSavedOutline: true,
    outline,
  };
}

export async function setOutlineLockForUser(
  db: AppDb,
  userId: string,
  projectId: string,
  locked: boolean,
  now: Date = new Date()
): Promise<{ projectId: string; outlineLocked: boolean }> {
  const wizard = await getWizardStateForUser(db, userId, projectId);
  if (!wizard) {
    throw new OutlineError("NOT_FOUND", "Project not found.", 404);
  }

  const [existing] = await db
    .select()
    .from(projectMemory)
    .where(eq(projectMemory.projectId, projectId))
    .limit(1);

  if (!existing) {
    await db.insert(projectMemory).values({
      projectId,
      outlineJson: "{}",
      outlineLocked: locked,
      updatedAt: now,
    });
  } else {
    await db
      .update(projectMemory)
      .set({ outlineLocked: locked, updatedAt: now })
      .where(eq(projectMemory.projectId, projectId));
  }

  return { projectId, outlineLocked: locked };
}

export async function suggestAndPersistOutlineForUser(
  db: AppDb,
  userId: string,
  projectId: string,
  options: {
    resetToDefault?: boolean;
    desiredUnitCount?: number;
    llmCtx?: CallLLMContext;
    now?: Date;
  } = {}
): Promise<{
  projectId: string;
  usedAi: boolean;
  outline: ProjectOutlinePlan;
  wizard: HydratedWizardState;
}> {
  const now = options.now ?? new Date();
  const wizard = await getWizardStateForUser(db, userId, projectId);
  if (!wizard) {
    throw new OutlineError("NOT_FOUND", "Project not found.", 404);
  }
  if (wizard.project.type === "assignment") {
    throw new OutlineError(
      "VALIDATION_ERROR",
      "Assignments use question lists rather than chapters or paper sections.",
      400
    );
  }

  const [existingMemory] = await db
    .select()
    .from(projectMemory)
    .where(eq(projectMemory.projectId, projectId))
    .limit(1);

  if (existingMemory?.outlineLocked) {
    throw new OutlineError(
      "OUTLINE_LOCKED",
      "This outline is locked because drafting has started. Unlock it first before regenerating.",
      409
    );
  }

  const hasStartedAny = wizard.chapters.some(
    (ch) => !ch.isAutoReferences && ch.status !== "not_started"
  );
  if (hasStartedAny) {
    throw new OutlineError(
      "OUTLINE_LOCKED",
      "Cannot replace the outline structure after drafting has started.",
      409
    );
  }

  const targetPages = wizard.project.targetPages ?? wizard.project.idealPages ?? 40;
  let plan: ProjectOutlinePlan;
  let usedAi = false;

  if (options.resetToDefault) {
    const defaults = getDefaultStructureForWork({
      type: wizard.project.type,
      isExperimental: wizard.settings.isExperimental,
      useChapters: wizard.settings.useChapters,
      level: wizard.project.level,
    });
    plan = buildProjectOutlinePlan({
      projectType: wizard.project.type,
      targetPages,
      lineSpacing: wizard.settings.lineSpacing,
      fontSizePt: wizard.settings.fontSizePt,
      isExperimental: wizard.settings.isExperimental,
      useChapters: wizard.settings.useChapters,
      chapters: [
        ...defaults.map((d) => ({
          number: d.number,
          title: d.title,
          chapterType: d.chapterType,
          brief: d.purpose,
          existingSections: d.sections,
          isAutoReferences: false,
        })),
        {
          number: defaults.length + 1,
          title: "References",
          chapterType: "references",
          isAutoReferences: true,
        },
      ],
    });
  } else {
    let subtopics: string[] = [];
    const [latestRun] = await db
      .select({ subtopicsJson: researchRuns.subtopicsJson })
      .from(researchRuns)
      .where(eq(researchRuns.projectId, projectId))
      .orderBy(desc(researchRuns.startedAt))
      .limit(1);
    if (latestRun?.subtopicsJson) {
      try {
        const parsedSubs = JSON.parse(latestRun.subtopicsJson) as unknown;
        if (Array.isArray(parsedSubs)) {
          subtopics = parsedSubs.filter((item): item is string => typeof item === "string");
        }
      } catch {
        subtopics = [];
      }
    }

    const generated = await generateTopicTailoredOutline(
      {
        workflowId: `outline_${projectId}_${now.getTime()}`,
        projectId,
        projectType: wizard.project.type,
        title: wizard.project.title,
        field: wizard.project.field,
        level: wizard.project.level,
        supervisorNotes: wizard.project.supervisorNotes,
        isExperimental: wizard.settings.isExperimental,
        useChapters: wizard.settings.useChapters,
        targetPages,
        lineSpacing: wizard.settings.lineSpacing,
        fontSizePt: wizard.settings.fontSizePt,
        subtopics,
        desiredUnitCount: options.desiredUnitCount,
      },
      options.llmCtx
    );
    plan = generated.plan;
    usedAi = generated.usedAi;
  }

  // Replace unstarted chapters and sections cleanly with the suggested structure
  await db.delete(chapters).where(eq(chapters.projectId, projectId));
  const persistedChapters = [];
  for (const ch of plan.chapters) {
    const chapterId = `chp_${crypto.randomUUID()}`;
    await db.insert(chapters).values({
      id: chapterId,
      projectId,
      number: ch.number,
      title: ch.title,
      chapterType: ch.chapterType,
      brief: ch.inferredPurpose,
      pageBudget: ch.isAutoReferences ? null : ch.pageBudget,
      wordBudget: ch.isAutoReferences ? null : ch.wordBudget,
      isAutoReferences: ch.isAutoReferences,
      status: "not_started",
      createdAt: now,
      updatedAt: now,
    });

    for (const sec of ch.sections) {
      await db.insert(sections).values({
        id: `sec_${crypto.randomUUID()}`,
        chapterId,
        orderIndex: sec.orderIndex,
        heading: sec.heading,
        wordBudget: sec.wordBudget,
        status: "not_started",
        createdAt: now,
        updatedAt: now,
      });
    }

    persistedChapters.push({ ...ch, chapterId });
  }

  plan = { ...plan, chapters: persistedChapters };

  await db
    .insert(projectMemory)
    .values({
      projectId,
      outlineJson: JSON.stringify(plan),
      outlineLocked: false,
      chapterSummariesJson: existingMemory?.chapterSummariesJson ?? "[]",
      glossaryJson: existingMemory?.glossaryJson ?? "[]",
      styleNotes: existingMemory?.styleNotes ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: projectMemory.projectId,
      set: {
        outlineJson: JSON.stringify(plan),
        updatedAt: now,
      },
    });

  const refreshedWizard = await getWizardStateForUser(db, userId, projectId);
  if (!refreshedWizard) {
    throw new Error("Failed to reload wizard state after outline suggestion");
  }

  return {
    projectId,
    usedAi,
    outline: plan,
    wizard: refreshedWizard,
  };
}
