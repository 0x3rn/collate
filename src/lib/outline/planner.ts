import { z } from "zod";
import {
  ASSIGNMENT_ANSWER_SECTIONS,
  CHAPTER_TYPE_TEMPLATES,
  CHAPTER_TYPES,
  OUTLINE_BUDGET_TOLERANCE_RATIO,
  WORDS_PER_PAGE_BASELINE,
  type ChapterType,
} from "@/config/outline";
import type { LineSpacing, ProjectType } from "@/db/schema";

export interface ClassifiedChapter {
  chapterType: ChapterType;
  confidence: "high" | "ambiguous";
  needsConfirmation: boolean;
  inferredPurpose: string;
  defaultSections: string[];
}

export const OutlineSectionSchema = z.object({
  orderIndex: z.number().int().min(1),
  heading: z.string().trim().min(2, "Section heading must be at least 2 characters.").max(180),
  wordBudget: z.number().int().min(50, "Each section must have at least 50 words."),
});

export const OutlineChapterPlanSchema = z.object({
  chapterId: z.string().optional(),
  number: z.number().int().min(1).max(30),
  title: z.string().trim().min(2, "Chapter title is required.").max(180),
  chapterType: z.enum(CHAPTER_TYPES),
  isAutoReferences: z.boolean().default(false),
  inferredPurpose: z.string().trim().min(5, "Describe what this chapter will cover.").max(400),
  needsConfirmation: z.boolean().default(false),
  purposeConfirmed: z.boolean().default(true),
  pageBudget: z.number().int().min(0).max(300),
  wordBudget: z.number().int().min(0),
  sections: z.array(OutlineSectionSchema),
});

export const AssignmentQuestionPlanSchema = z.object({
  questionId: z.string().min(1),
  orderIndex: z.number().int().min(1),
  questionText: z.string().trim().min(5),
  pageBudget: z.number().int().min(1).max(100),
  wordBudget: z.number().int().min(100),
  sections: z.array(OutlineSectionSchema).min(1),
});

export const ProjectOutlinePlanSchema = z.object({
  projectType: z.enum(["project", "research", "thesis", "assignment"]),
  targetPages: z.number().int().min(1).max(300),
  wordsPerPage: z.number().int().min(150).max(700),
  chapters: z.array(OutlineChapterPlanSchema),
  assignmentPlans: z.array(AssignmentQuestionPlanSchema).default([]),
});

export type OutlineSectionPlan = z.infer<typeof OutlineSectionSchema>;
export type OutlineChapterPlan = z.infer<typeof OutlineChapterPlanSchema>;
export type AssignmentQuestionPlan = z.infer<typeof AssignmentQuestionPlanSchema>;
export type ProjectOutlinePlan = z.infer<typeof ProjectOutlinePlanSchema>;

export function calculateWordsPerPage(lineSpacing: LineSpacing, fontSizePt = 12): number {
  const base = WORDS_PER_PAGE_BASELINE[lineSpacing] ?? 275;
  const fontScale = 12 / Math.max(10, Math.min(14, fontSizePt));
  return Math.round(base * fontScale);
}

export function classifyChapterTitle(title: string, projectType: ProjectType): ClassifiedChapter {
  const clean = title.trim();
  const lower = clean.toLowerCase();

  const matches = (keywords: string[]) => keywords.some((k) => lower.includes(k));

  let detected: ChapterType = "custom";

  if (matches(["reference", "bibliograph", "works cited"])) {
    detected = "references";
  } else if (matches(["introduction", "background of the study", "introductory"])) {
    detected = "introduction";
  } else if (matches(["theoretical framework", "conceptual framework"])) {
    detected = "theoretical_framework";
  } else if (matches(["literature", "prior work", "related work", "review of"])) {
    detected = "literature_review";
  } else if (projectType === "project" && matches(["system analysis", "requirement"])) {
    detected = "system_analysis";
  } else if (projectType === "project" && matches(["system design", "architecture"])) {
    detected = "system_design";
  } else if (
    projectType === "project" &&
    matches(["implementation", "development", "deployment"])
  ) {
    detected = "implementation";
  } else if (projectType === "project" && matches(["testing", "verification", "evaluation"])) {
    detected = "testing";
  } else if (
    matches(["methodology", "research method", "materials and methods", "research design"])
  ) {
    detected = "methodology";
  } else if (matches(["result", "finding", "data analysis", "data presentation"])) {
    detected = "results";
  } else if (matches(["discussion", "interpretation"])) {
    detected = "discussion";
  } else if (matches(["conclusion", "recommendation", "summary and conclusion"])) {
    detected = "conclusion";
  }

  if (detected === "custom") {
    return {
      chapterType: "custom",
      confidence: "ambiguous",
      needsConfirmation: true,
      inferredPurpose: `This chapter will examine "${clean}" using verified sources, organized into context, core evidence-based analysis, synthesis, and summary.`,
      defaultSections: [...CHAPTER_TYPE_TEMPLATES.custom.requiredSections],
    };
  }

  const template = CHAPTER_TYPE_TEMPLATES[detected];
  return {
    chapterType: detected,
    confidence: "high",
    needsConfirmation: false,
    inferredPurpose: `This chapter will ${template.defaultPurpose.charAt(0).toLowerCase()}${template.defaultPurpose.slice(1)}`,
    defaultSections: [...template.requiredSections],
  };
}

export function distributeWordsAcrossSections(
  headings: string[],
  totalWords: number
): OutlineSectionPlan[] {
  if (headings.length === 0) return [];
  const safeTotal = Math.max(headings.length * 50, totalWords);
  const baseWords = Math.floor(safeTotal / headings.length);
  let remainder = safeTotal - baseWords * headings.length;

  return headings.map((heading, idx) => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder--;
    return {
      orderIndex: idx + 1,
      heading: heading.trim(),
      wordBudget: baseWords + extra,
    };
  });
}

export function buildProjectOutlinePlan(input: {
  projectType: ProjectType;
  targetPages: number;
  lineSpacing: LineSpacing;
  fontSizePt?: number;
  chapters: Array<{ id?: string; number: number; title: string; isAutoReferences?: boolean }>;
  questions?: Array<{ id: string; orderIndex: number; text: string }>;
}): ProjectOutlinePlan {
  const wordsPerPage = calculateWordsPerPage(input.lineSpacing, input.fontSizePt ?? 12);

  if (input.projectType === "assignment") {
    const qList = input.questions ?? [];
    const count = Math.max(1, qList.length);
    const basePages = Math.max(1, Math.floor(input.targetPages / count));
    let remainder = Math.max(0, input.targetPages - basePages * count);

    const assignmentPlans: AssignmentQuestionPlan[] = qList.map((q) => {
      const pageBudget = basePages + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      const wordBudget = pageBudget * wordsPerPage;
      return {
        questionId: q.id,
        orderIndex: q.orderIndex,
        questionText: q.text,
        pageBudget,
        wordBudget,
        sections: distributeWordsAcrossSections([...ASSIGNMENT_ANSWER_SECTIONS], wordBudget),
      };
    });

    return {
      projectType: "assignment",
      targetPages: input.targetPages,
      wordsPerPage,
      chapters: [],
      assignmentPlans,
    };
  }

  const contentChapters = input.chapters
    .filter((c) => !c.isAutoReferences)
    .sort((a, b) => a.number - b.number);
  const autoRefChapter = input.chapters.find((c) => c.isAutoReferences);

  const classified = contentChapters.map((ch) => {
    const cls = classifyChapterTitle(ch.title, input.projectType);
    const weight = CHAPTER_TYPE_TEMPLATES[cls.chapterType].defaultWeight || 12;
    return { ...ch, cls, weight };
  });

  const totalWeight = classified.reduce((sum, item) => sum + item.weight, 0) || 1;
  const effectiveTarget = Math.max(classified.length, input.targetPages);
  let remainingPages = effectiveTarget;

  const plannedChapters: OutlineChapterPlan[] = classified.map((item, idx) => {
    const isLast = idx === classified.length - 1;
    const minLeftForRest = classified.length - 1 - idx;
    const proportional = Math.max(1, Math.round((item.weight / totalWeight) * effectiveTarget));
    const pageBudget = isLast
      ? Math.max(1, remainingPages)
      : Math.min(proportional, Math.max(1, remainingPages - minLeftForRest));
    remainingPages -= pageBudget;

    const wordBudget = pageBudget * wordsPerPage;
    return {
      chapterId: item.id,
      number: item.number,
      title: item.title,
      chapterType: item.cls.chapterType,
      isAutoReferences: false,
      inferredPurpose: item.cls.inferredPurpose,
      needsConfirmation: item.cls.needsConfirmation,
      purposeConfirmed: !item.cls.needsConfirmation,
      pageBudget,
      wordBudget,
      sections: distributeWordsAcrossSections(item.cls.defaultSections, wordBudget),
    };
  });

  if (autoRefChapter) {
    plannedChapters.push({
      chapterId: autoRefChapter.id,
      number: autoRefChapter.number,
      title: autoRefChapter.title,
      chapterType: "references",
      isAutoReferences: true,
      inferredPurpose: CHAPTER_TYPE_TEMPLATES.references.defaultPurpose,
      needsConfirmation: false,
      purposeConfirmed: true,
      pageBudget: 0,
      wordBudget: 0,
      sections: [],
    });
  }

  return {
    projectType: input.projectType,
    targetPages: input.targetPages,
    wordsPerPage,
    chapters: plannedChapters,
    assignmentPlans: [],
  };
}

export interface OutlineValidationResult {
  valid: boolean;
  errors: string[];
  allocatedPages: number;
  varianceRatio: number;
}

export function validateConfirmedOutline(outline: ProjectOutlinePlan): OutlineValidationResult {
  const errors: string[] = [];

  if (outline.projectType === "assignment") {
    const allocatedPages = outline.assignmentPlans.reduce((sum, q) => sum + q.pageBudget, 0);
    const diff = Math.abs(allocatedPages - outline.targetPages);
    const varianceRatio = outline.targetPages > 0 ? diff / outline.targetPages : 0;
    const allowedPages = Math.max(
      1,
      Math.floor(outline.targetPages * OUTLINE_BUDGET_TOLERANCE_RATIO)
    );

    if (outline.assignmentPlans.length === 0) {
      errors.push("Add at least one assignment question plan.");
    }
    if (diff > allowedPages) {
      errors.push(
        `Question page budgets sum to ${allocatedPages} pages, which differs from target ${outline.targetPages} pages by more than 2%.`
      );
    }

    return { valid: errors.length === 0, errors, allocatedPages, varianceRatio };
  }

  const contentChapters = outline.chapters.filter((c) => !c.isAutoReferences);
  if (contentChapters.length === 0) {
    errors.push("Outline must include at least one content chapter.");
  }

  const seenNumbers = new Set<number>();
  for (const ch of outline.chapters) {
    if (seenNumbers.has(ch.number)) {
      errors.push(`Duplicate chapter number: Chapter ${ch.number}.`);
    }
    seenNumbers.add(ch.number);
  }

  for (const ch of contentChapters) {
    if (ch.needsConfirmation && !ch.purposeConfirmed) {
      errors.push(
        `Confirm or edit the purpose of Chapter ${ch.number} ("${ch.title}") before locking the outline.`
      );
    }
    if (ch.pageBudget < 1) {
      errors.push(
        `Chapter ${ch.number} ("${ch.title}") must have a page budget of at least 1 page.`
      );
    }
    if (ch.sections.length === 0) {
      errors.push(
        `Chapter ${ch.number} ("${ch.title}") must include at least one section heading.`
      );
    }
  }

  const allocatedPages = contentChapters.reduce((sum, ch) => sum + ch.pageBudget, 0);
  const diff = Math.abs(allocatedPages - outline.targetPages);
  const varianceRatio = outline.targetPages > 0 ? diff / outline.targetPages : 0;
  const allowedPages = Math.max(
    outline.targetPages >= 50
      ? Math.floor(outline.targetPages * OUTLINE_BUDGET_TOLERANCE_RATIO)
      : 1,
    0
  );

  if (diff > allowedPages) {
    errors.push(
      `Chapter page budgets sum to ${allocatedPages} pages, outside the 2% tolerance for target ${outline.targetPages} pages.`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    allocatedPages,
    varianceRatio,
  };
}
