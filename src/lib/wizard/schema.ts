import { z } from "zod";
import {
  CITATION_INLINE_MODES,
  CITATION_STYLES,
  EXPERIMENTAL_DATA_MODES,
  LINE_SPACINGS,
  PAGE_SIZES,
  HEADING_COLORS,
  PROJECT_TYPES,
  SPELLING_VARIANTS,
  type ProjectType,
} from "@/db/schema";

export const ALLOWED_FONTS = [
  "Times New Roman",
  "Georgia",
  "Garamond",
  "Arial",
  "Calibri",
] as const;

export const ACADEMIC_LEVELS = [
  "High school / Secondary",
  "Undergraduate",
  "Masters",
  "PhD",
  "Diploma / HND",
  "Professional / Independent",
] as const;

export const FrontMatterTogglesSchema = z.object({
  coverPage: z.boolean().default(true),
  certification: z.boolean().default(false),
  dedication: z.boolean().default(false),
  acknowledgements: z.boolean().default(true),
  preface: z.boolean().default(false),
  abstract: z.boolean().default(true),
  tableOfContents: z.boolean().default(true),
  listOfFiguresAndTables: z.boolean().default(false),
  appendices: z.boolean().default(false),
});

export type FrontMatterToggles = z.infer<typeof FrontMatterTogglesSchema>;

export const CoverDetailsSchema = z.object({
  authorName: z.string().trim().max(150).default(""),
  institution: z.string().trim().max(200).default(""),
  department: z.string().trim().max(200).default(""),
  supervisor: z.string().trim().max(150).default(""),
  submissionDate: z.string().trim().max(60).default(""),
});

export type CoverDetails = z.infer<typeof CoverDetailsSchema>;

export const WizardStep1Schema = z.object({
  step: z.literal(1),
  type: z.enum(PROJECT_TYPES),
});

export const WizardStep2TopicSchema = z.object({
  step: z.literal(2),
  title: z
    .string()
    .trim()
    .min(5, "Enter a clear topic title (at least 5 characters).")
    .max(300, "Keep the topic title under 300 characters."),
  field: z.string().trim().max(150).optional().default(""),
  level: z.string().trim().max(100).optional().default(""),
  institution: z.string().trim().max(200).optional().default(""),
  supervisorNotes: z.string().trim().max(2000).optional().default(""),
  isExperimental: z.boolean().optional().default(false),
  experimentalDataMode: z.enum(EXPERIMENTAL_DATA_MODES).optional().default("user_provided"),
  questions: z
    .array(
      z
        .string()
        .trim()
        .min(5, "Each assignment question must be at least 5 characters.")
        .max(1000, "Keep each question under 1000 characters.")
    )
    .max(20, "Assignments support up to 20 questions per project.")
    .optional(),
});

export const WizardStep3MockResearchSchema = z.object({
  step: z.literal(3),
  simulateVerdict: z.enum(["feasible", "needs_refinement", "not_feasible"]).default("feasible"),
});

export const WizardStep4LengthSchema = z.object({
  step: z.literal(4),
  targetPages: z
    .number()
    .int("Page count must be a whole number.")
    .min(1, "Page count must be at least 1 page.")
    .max(300, "Page count cannot exceed 300 pages."),
});

export const ChapterInputSchema = z.object({
  number: z
    .number()
    .int("Chapter number must be a whole number.")
    .min(1, "Chapter number must start at 1.")
    .max(30, "Maximum 30 chapters supported."),
  title: z
    .string()
    .trim()
    .min(2, "Every chapter needs a title.")
    .max(180, "Keep chapter titles under 180 characters."),
});

export const WizardStep5ChaptersSchema = z
  .object({
    step: z.literal(5),
    chapters: z.array(ChapterInputSchema).min(1, "Add at least 1 chapter.").max(20),
    frontMatter: FrontMatterTogglesSchema,
  })
  .superRefine((data, ctx) => {
    const seen = new Set<number>();
    for (let i = 0; i < data.chapters.length; i++) {
      const ch = data.chapters[i]!;
      if (seen.has(ch.number)) {
        ctx.addIssue({
          code: "custom",
          path: ["chapters", i, "number"],
          message: `Duplicate chapter number: Chapter ${ch.number}.`,
        });
      }
      seen.add(ch.number);
    }
  });

export const WizardStep6CitationsSchema = z.object({
  step: z.literal(6),
  citationStyle: z.enum(CITATION_STYLES),
  inlineMode: z.enum(CITATION_INLINE_MODES),
});

export const WizardStep7FormattingSchema = z.object({
  step: z.literal(7),
  font: z.enum(ALLOWED_FONTS),
  fontSizePt: z.number().int().min(10).max(14),
  lineSpacing: z.enum(LINE_SPACINGS),
  marginsMm: z.number().int().min(15).max(40),
  pageSize: z.enum(PAGE_SIZES).optional().default("a4"),
  pageNumbering: z.boolean(),
  headingColor: z.enum(HEADING_COLORS).optional().default("black"),
  spelling: z.enum(SPELLING_VARIANTS),
  cover: CoverDetailsSchema,
});

export const WizardStep8ConfirmSchema = z.object({
  step: z.literal(8),
  confirmed: z.literal(true),
});

export const WizardStepPayloadSchema = z.discriminatedUnion("step", [
  WizardStep1Schema,
  WizardStep2TopicSchema,
  WizardStep3MockResearchSchema,
  WizardStep4LengthSchema,
  WizardStep5ChaptersSchema,
  WizardStep6CitationsSchema,
  WizardStep7FormattingSchema,
  WizardStep8ConfirmSchema,
]);

export type WizardStepPayload = z.infer<typeof WizardStepPayloadSchema>;

export const DEFAULT_FRONT_MATTER: FrontMatterToggles = {
  coverPage: true,
  certification: false,
  dedication: false,
  acknowledgements: true,
  preface: false,
  abstract: true,
  tableOfContents: true,
  listOfFiguresAndTables: false,
  appendices: false,
};

export const DEFAULT_COVER_DETAILS: CoverDetails = {
  authorName: "",
  institution: "",
  department: "",
  supervisor: "",
  submissionDate: "",
};

export function inferChapterTypeFromTitle(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("intro")) return "introduction";
  if (lower.includes("literature") || lower.includes("review")) return "literature_review";
  if (lower.includes("method") || lower.includes("design") || lower.includes("analysis")) {
    return "methodology";
  }
  if (lower.includes("result") || lower.includes("finding") || lower.includes("data")) {
    return "results";
  }
  if (lower.includes("discussion")) return "discussion";
  if (lower.includes("conclusion") || lower.includes("recommend")) return "conclusion";
  if (lower.includes("reference") || lower.includes("bibliograph")) return "references";
  return "custom";
}

export function getDefaultChaptersForType(
  type: ProjectType
): Array<{ number: number; title: string }> {
  if (type === "assignment") return [];
  if (type === "research") {
    return [
      { number: 1, title: "Introduction" },
      { number: 2, title: "Literature Review" },
      { number: 3, title: "Methodology" },
      { number: 4, title: "Results and Discussion" },
      { number: 5, title: "Conclusion" },
    ];
  }
  return [
    { number: 1, title: "Introduction" },
    { number: 2, title: "Literature Review" },
    { number: 3, title: "Methodology" },
    { number: 4, title: "Results and Findings" },
    { number: 5, title: "Conclusion and Recommendations" },
  ];
}

export function recommendMockIdealPages(params: {
  type: ProjectType;
  level?: string | null;
  questionCount?: number;
}): { idealPages: number; reason: string } {
  if (params.type === "assignment") {
    const count = Math.max(1, params.questionCount ?? 1);
    const ideal = Math.min(300, count * 4);
    return {
      idealPages: ideal,
      reason: `Recommended ~4 pages per question across ${count} assignment question${count === 1 ? "" : "s"} (mock estimate until Phase 4 feasibility engine).`,
    };
  }

  if (params.type === "research") {
    return {
      idealPages: 25,
      reason:
        "Standard research paper range is 15–40 pages; 25 pages fits a focused multi-section study (mock estimate until Phase 4).",
    };
  }

  if (params.type === "project") {
    return {
      idealPages: 55,
      reason:
        "Final-year undergraduate projects typically span 40–70 pages across five chapters (mock estimate until Phase 4).",
    };
  }

  const lowerLevel = (params.level ?? "").toLowerCase();
  if (lowerLevel.includes("phd")) {
    return {
      idealPages: 180,
      reason: "Doctoral theses typically span 150–300 pages (mock estimate until Phase 4).",
    };
  }
  if (lowerLevel.includes("master")) {
    return {
      idealPages: 100,
      reason: "Master's theses typically span 80–150 pages (mock estimate until Phase 4).",
    };
  }
  return {
    idealPages: 65,
    reason: "Bachelor's theses typically span 50–80 pages (mock estimate until Phase 4).",
  };
}

export function estimateWordsPerPage(lineSpacing: (typeof LINE_SPACINGS)[number]): number {
  if (lineSpacing === "single") return 525;
  if (lineSpacing === "one_half") return 375;
  return 275;
}

export function allocateChapterBudgets(
  chapterList: Array<{ number: number; title: string }>,
  targetPages: number,
  lineSpacing: (typeof LINE_SPACINGS)[number]
): Array<{
  number: number;
  title: string;
  chapterType: string;
  pageBudget: number;
  wordBudget: number;
}> {
  if (chapterList.length === 0) return [];
  const wordsPerPage = estimateWordsPerPage(lineSpacing);
  const weightMap: Record<string, number> = {
    introduction: 12,
    literature_review: 28,
    methodology: 15,
    results: 22,
    discussion: 13,
    conclusion: 10,
    custom: 15,
  };

  const typed = chapterList.map((ch) => {
    const chapterType = inferChapterTypeFromTitle(ch.title);
    return { ...ch, chapterType, weight: weightMap[chapterType] ?? 15 };
  });

  const totalWeight = typed.reduce((sum, item) => sum + item.weight, 0);
  let remaining = Math.max(chapterList.length, targetPages);

  return typed.map((item, idx) => {
    const isLast = idx === typed.length - 1;
    const rawPages = isLast
      ? remaining
      : Math.max(1, Math.round((item.weight / totalWeight) * targetPages));
    const pageBudget = Math.min(
      Math.max(1, rawPages),
      Math.max(1, remaining - (typed.length - 1 - idx))
    );
    remaining -= pageBudget;
    return {
      number: item.number,
      title: item.title,
      chapterType: item.chapterType,
      pageBudget,
      wordBudget: pageBudget * wordsPerPage,
    };
  });
}
