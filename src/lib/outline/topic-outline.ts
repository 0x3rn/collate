import { z } from "zod";
import { CHAPTER_TYPES, CHAPTER_TYPE_TEMPLATES, type ChapterType } from "@/config/outline";
import type { LineSpacing, ProjectType } from "@/db/schema";
import { callLLM, hasConfiguredLlmProvider, type CallLLMContext } from "@/lib/ai/call-llm";
import {
  buildProjectOutlinePlan,
  calculateWordsPerPage,
  distributeWordsAcrossSections,
  type OutlineChapterPlan,
  type ProjectOutlinePlan,
} from "./planner";
import {
  getDefaultStructureForWork,
  stripLeadingUnitPrefix,
  unitNounPlural,
  unitNounSingular,
  validatePureLiteratureStructure,
} from "./structures";

const SuggestedUnitSchema = z.object({
  title: z.string().trim().min(3).max(160),
  chapterType: z.enum(CHAPTER_TYPES),
  purpose: z.string().trim().min(10).max(380),
  sections: z.array(z.string().trim().min(3).max(160)).min(2).max(8),
});

const SuggestedOutlineResponseSchema = z.object({
  units: z.array(SuggestedUnitSchema).min(3).max(8),
});

export interface TopicOutlineInput {
  workflowId: string;
  projectId: string;
  projectType: ProjectType;
  title: string;
  field?: string | null;
  level?: string | null;
  supervisorNotes?: string | null;
  isExperimental: boolean;
  useChapters: boolean;
  targetPages: number;
  lineSpacing: LineSpacing;
  fontSizePt?: number;
  subtopics?: string[];
  desiredUnitCount?: number;
}

function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

function buildDeterministicTopicFallback(input: TopicOutlineInput): ProjectOutlinePlan {
  const baseTemplates = getDefaultStructureForWork({
    type: input.projectType,
    isExperimental: input.isExperimental,
    useChapters: input.useChapters,
    level: input.level,
  });

  const cleanSubtopics = (input.subtopics ?? [])
    .map((s) => stripLeadingUnitPrefix(s))
    .filter((s) => s.length >= 4 && s.length <= 120);

  const enrichedUnits = baseTemplates.map((unit) => {
    if (
      !input.isExperimental &&
      cleanSubtopics.length >= 2 &&
      (unit.chapterType === "thematic_analysis" || unit.chapterType === "literature_review")
    ) {
      const injected = cleanSubtopics.slice(0, 3);
      const mergedSections =
        unit.chapterType === "literature_review"
          ? [
              unit.sections[0] ?? "Conceptual clarification",
              ...injected,
              "Synthesis of literature gaps",
            ]
          : [
              unit.sections[0] ?? "Historical and contextual background",
              ...injected,
              input.useChapters ? "Chapter summary" : "Summary of thematic insights",
            ];
      const candidateCheck = validatePureLiteratureStructure([
        { title: unit.title, chapterType: unit.chapterType, sections: mergedSections },
      ]);
      if (candidateCheck.valid) {
        return { ...unit, sections: mergedSections };
      }
    }
    return unit;
  });

  return buildProjectOutlinePlan({
    projectType: input.projectType,
    targetPages: input.targetPages,
    lineSpacing: input.lineSpacing,
    fontSizePt: input.fontSizePt ?? 12,
    isExperimental: input.isExperimental,
    useChapters: input.useChapters,
    chapters: [
      ...enrichedUnits.map((u) => ({
        number: u.number,
        title: u.title,
        chapterType: u.chapterType,
        brief: u.purpose,
        existingSections: u.sections,
        isAutoReferences: false,
      })),
      {
        number: enrichedUnits.length + 1,
        title: "References",
        chapterType: "references",
        isAutoReferences: true,
      },
    ],
  });
}

function buildPlanFromValidatedUnits(
  input: TopicOutlineInput,
  units: Array<{
    title: string;
    chapterType: ChapterType;
    purpose: string;
    sections: string[];
  }>
): ProjectOutlinePlan {
  const wordsPerPage = calculateWordsPerPage(input.lineSpacing, input.fontSizePt ?? 12);
  const weighted = units.map((u, idx) => ({
    number: idx + 1,
    title: stripLeadingUnitPrefix(u.title) || u.title.trim(),
    chapterType: u.chapterType,
    purpose: u.purpose.trim(),
    sections: u.sections
      .map((s) => stripLeadingUnitPrefix(s) || s.trim())
      .filter((s) => s.length >= 2),
    weight: CHAPTER_TYPE_TEMPLATES[u.chapterType].defaultWeight || 14,
  }));

  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0) || 1;
  const effectiveTarget = Math.max(weighted.length, input.targetPages);
  let remainingPages = effectiveTarget;

  const plannedChapters: OutlineChapterPlan[] = weighted.map((item, idx) => {
    const isLast = idx === weighted.length - 1;
    const minLeftForRest = weighted.length - 1 - idx;
    const proportional = Math.max(1, Math.round((item.weight / totalWeight) * effectiveTarget));
    const pageBudget = isLast
      ? Math.max(1, remainingPages)
      : Math.min(proportional, Math.max(1, remainingPages - minLeftForRest));
    remainingPages -= pageBudget;

    const wordBudget = pageBudget * wordsPerPage;
    return {
      number: item.number,
      title: item.title,
      chapterType: item.chapterType,
      isAutoReferences: false,
      inferredPurpose: item.purpose,
      needsConfirmation: false,
      purposeConfirmed: true,
      pageBudget,
      wordBudget,
      sections: distributeWordsAcrossSections(
        item.sections.length > 0 ? item.sections : ["Overview and context", "Core analysis"],
        wordBudget
      ),
    };
  });

  plannedChapters.push({
    number: plannedChapters.length + 1,
    title: "References",
    chapterType: "references",
    isAutoReferences: true,
    inferredPurpose: CHAPTER_TYPE_TEMPLATES.references.defaultPurpose,
    needsConfirmation: false,
    purposeConfirmed: true,
    pageBudget: 0,
    wordBudget: 0,
    sections: [],
  });

  return {
    projectType: input.projectType,
    useChapters: input.useChapters,
    isExperimental: input.isExperimental,
    targetPages: input.targetPages,
    wordsPerPage,
    chapters: plannedChapters,
    assignmentPlans: [],
  };
}

export function buildTopicOutlinePrompts(input: TopicOutlineInput): {
  system: string;
  user: string;
} {
  const unitSingular = unitNounSingular(input.useChapters);
  const unitPlural = unitNounPlural(input.useChapters);
  const subPlural = input.useChapters ? "sections" : "subsections";
  const defaultUnits = getDefaultStructureForWork({
    type: input.projectType,
    isExperimental: input.isExperimental,
    useChapters: input.useChapters,
    level: input.level,
  });
  const targetCount = Math.max(4, Math.min(7, input.desiredUnitCount ?? defaultUnits.length));

  const allowedTypes = input.isExperimental
    ? [
        "introduction",
        "literature_review",
        "theoretical_framework",
        "methodology",
        "results",
        "discussion",
        "conclusion",
        ...(input.projectType === "project"
          ? ["system_analysis", "system_design", "implementation", "testing"]
          : []),
      ]
    : [
        "introduction",
        "literature_review",
        "theoretical_framework",
        "thematic_analysis",
        "critical_analysis",
        "conclusion",
      ];

  const workFormatGuidance =
    input.projectType === "research"
      ? input.useChapters
        ? "Format: Chaptered academic research paper. Formulate topic-specific chapter titles and aligned section headings."
        : "Format: Standard journal-style academic research paper WITHOUT chapters. Formulate concise numbered top-level paper sections and aligned subsections (2 to 4 subsections each). NEVER use the word 'Chapter' in any title, purpose, or subsection."
      : input.projectType === "project"
        ? input.isExperimental
          ? `Format: Final-year undergraduate empirical project (${input.useChapters ? "5 formal chapters" : "5 continuous numbered sections"}).`
          : `Format: Non-experimental / library-based final-year project (${input.useChapters ? "5 chapters following Nigerian/international humanities, law, social-science, and theoretical project standards" : "5 continuous numbered sections"}). Keep Introduction as ${unitSingular} 1, Literature Review & Theoretical Framework as ${unitSingular} 2, topic-specific Thematic/Contextual/Doctrinal/Historical Analysis as ${unitSingular} 3, Critical Evaluation & Comparative Synthesis as ${unitSingular} 4, and Summary, Conclusion and Recommendations as ${unitSingular} 5.`
        : input.isExperimental
          ? `Format: Academic thesis / dissertation with primary empirical investigation (${input.useChapters ? "6 formal chapters separating Results and Discussion" : "6 continuous numbered sections"}).`
          : `Format: Theoretical / library-based academic thesis (${input.useChapters ? "6 formal chapters with dedicated Theoretical Framework, Thematic Analysis, and Critical Discussion" : "6 continuous numbered sections"}).`;

  const studyModeRules = input.isExperimental
    ? [
        "STUDY MODE: EXPERIMENTAL / EMPIRICAL STUDY.",
        `Include appropriate empirical Methodology and Results ${unitPlural} tailored specifically to the topic and field.`,
      ]
    : [
        "STUDY MODE: PURE LITERATURE / DESK RESEARCH (NON-EXPERIMENTAL).",
        "HARD PROHIBITIONS (MUST OBEY): This study has NO experiments, NO lab assays, NO field surveys, NO questionnaires, NO sample sizes, and NO original empirical data.",
        "- NEVER include a 'Results', 'Results and Discussion', 'Results and Findings', or 'Data Presentation' unit.",
        "- NEVER use chapterType 'results'.",
        "- NEVER include empirical survey/lab subsections such as 'Population and sampling strategy', 'Data collection instruments', 'Questionnaires', 'Validity and reliability', 'Research questions and hypotheses', 'Statistical analysis', or 'Primary empirical findings'.",
        "- Instead, formulate rich, topic-specific conceptual, theoretical, thematic, historical, comparative, policy, or critical-evaluation titles and subheadings drawn directly from the topic.",
      ];

  const system = [
    `You are an academic curriculum and manuscript architect designing an authentic ${input.projectType} outline.`,
    workFormatGuidance,
    ...studyModeRules,
    `Create exactly ${targetCount} top-level content ${unitPlural} (do NOT include References; References is appended automatically).`,
    `For each ${unitSingular}, tailor the title (except standard Introduction / Conclusion where appropriate, though even middle ${unitPlural} MUST be clearly tailored to the user's exact topic) AND tailor every ${subPlural.slice(0, -1)} heading to fit the topic directly.`,
    "Strip any 'Chapter 1:' or '1.' numbering prefix from titles and section headings (numbering is applied automatically).",
    `Use ONLY these chapterType values: ${allowedTypes.join(", ")}.`,
    "Do not use em-dashes in any title, purpose, or heading.",
    'Return ONLY a single valid JSON object matching: { "units": [{ "title": "...", "chapterType": "...", "purpose": "1 concise sentence starting with This chapter will... or This section will...", "sections": ["...", "..."] }] }.',
  ].join("\n");

  const user = [
    `Topic: ${input.title.trim()}`,
    `Work type: ${input.projectType}`,
    `Uses chapters: ${input.useChapters ? "Yes (formal chapters)" : "No (continuous numbered paper sections)"}`,
    `Experimental / primary data: ${input.isExperimental ? "Yes" : "No (pure literature / library study)"}`,
    `Target pages: ${input.targetPages}`,
    input.field?.trim() ? `Field of study: ${input.field.trim()}` : "",
    input.level?.trim() ? `Academic level: ${input.level.trim()}` : "",
    input.supervisorNotes?.trim() ? `Supervisor notes: ${input.supervisorNotes.trim()}` : "",
    input.subtopics && input.subtopics.length > 0
      ? `Discovered research subtopics from literature sweep:\n${input.subtopics.map((s) => `- ${s}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user };
}

/**
 * Generates a topic-tailored outline plan aligned with (projectType, isExperimental, useChapters).
 * Uses callLLM when configured and validates strictly against pure-literature and chapter-mode
 * invariants, falling back cleanly to deterministic topic-aware structures if unavailable.
 */
export async function generateTopicTailoredOutline(
  input: TopicOutlineInput,
  llmCtx?: CallLLMContext
): Promise<{ plan: ProjectOutlinePlan; usedAi: boolean }> {
  const cleanTitle = input.title.trim();
  const isRealTopic = cleanTitle.length >= 5 && !/^untitled\s+/i.test(cleanTitle);

  if (!llmCtx || !isRealTopic || !hasConfiguredLlmProvider(llmCtx.env)) {
    return {
      plan: buildDeterministicTopicFallback(input),
      usedAi: false,
    };
  }

  const prompts = buildTopicOutlinePrompts(input);

  try {
    const res = await callLLM(
      {
        workflowId: input.workflowId,
        projectId: input.projectId,
        step: "topic_outline_suggest",
        task: "classify",
        system: prompts.system,
        messages: [{ role: "user", content: prompts.user }],
        maxTokens: 2200,
        temperature: 0.25,
        timeoutMs: 25_000,
        spendCapUsd: 0.25,
      },
      llmCtx
    );

    const jsonSlice = extractFirstJsonObject(res.text);
    if (jsonSlice) {
      const parsed = SuggestedOutlineResponseSchema.safeParse(JSON.parse(jsonSlice));
      if (parsed.success) {
        const sanitizedUnits = parsed.data.units.map((u) => {
          const cleanedTitle = stripLeadingUnitPrefix(u.title) || u.title.trim();
          const cleanedPurpose = input.useChapters
            ? u.purpose.trim()
            : u.purpose
                .trim()
                .replace(/\bthis chapter\b/gi, "this section")
                .replace(/\bchapters\b/gi, "sections");
          const cleanedSections = u.sections
            .map((s) => stripLeadingUnitPrefix(s) || s.trim())
            .filter((s) => s.length >= 2);
          const safeType: ChapterType =
            !input.isExperimental && u.chapterType === "results"
              ? "critical_analysis"
              : u.chapterType;
          return {
            title: cleanedTitle,
            chapterType: safeType,
            purpose: cleanedPurpose,
            sections: cleanedSections,
          };
        });

        if (!input.isExperimental) {
          const guard = validatePureLiteratureStructure(sanitizedUnits);
          if (!guard.valid) {
            return {
              plan: buildDeterministicTopicFallback(input),
              usedAi: false,
            };
          }
        }

        return {
          plan: buildPlanFromValidatedUnits(input, sanitizedUnits),
          usedAi: true,
        };
      }
    }
  } catch {
    // Non-fatal: fall back cleanly to deterministic structure below
  }

  return {
    plan: buildDeterministicTopicFallback(input),
    usedAi: false,
  };
}
