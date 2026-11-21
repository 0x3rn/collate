import { and, asc, eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { getWizardStateForUser } from "@/db/queries/wizard";
import { chapters, projectMemory, projects, sections } from "@/db/schema";
import {
  buildProjectOutlinePlan,
  ProjectOutlinePlanSchema,
  validateConfirmedOutline,
  type ProjectOutlinePlan,
} from "@/lib/outline/planner";

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
      if (parsed.success) {
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

  const targetPages = wizard.project.targetPages ?? wizard.project.idealPages ?? 40;
  const generated = buildProjectOutlinePlan({
    projectType: wizard.project.type,
    targetPages,
    lineSpacing: wizard.settings.lineSpacing,
    fontSizePt: wizard.settings.fontSizePt,
    chapters: wizard.chapters.map((c) => ({
      id: c.id,
      number: c.number,
      title: c.title,
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
