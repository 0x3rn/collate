import { z } from "zod";
import { callLLM, type CallLLMContext } from "@/lib/ai/call-llm";

export interface RevisionSectionDescriptor {
  sectionId: string;
  orderIndex: number;
  heading: string;
}

function normalizeHeading(raw: string): string {
  return raw
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/^\d+(?:\.\d+)*\.?\s+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Splits an existing chapter Markdown draft into a map of `sectionId -> prose`
 * matching the chapter's ordered section plan. Preserves headings, figures, tables,
 * and page breaks inside each section verbatim.
 */
export function parseExistingChapterSections(
  chapterMarkdown: string,
  sectionPlan: RevisionSectionDescriptor[]
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!chapterMarkdown.trim() || sectionPlan.length === 0) return result;

  const lines = chapterMarkdown.split(/\r?\n/);
  const parsedBlocks: Array<{
    rawHeading: string;
    normalizedHeading: string;
    bodyLines: string[];
  }> = [];
  let current: { rawHeading: string; normalizedHeading: string; bodyLines: string[] } | null = null;

  for (const line of lines) {
    if (/^##\s+/.test(line.trim())) {
      if (current) {
        parsedBlocks.push(current);
      }
      const rawHeading = line
        .trim()
        .replace(/^##\s+/, "")
        .trim();
      current = {
        rawHeading,
        normalizedHeading: normalizeHeading(rawHeading),
        bodyLines: [],
      };
      continue;
    }
    if (current) {
      current.bodyLines.push(line);
    }
  }
  if (current) {
    parsedBlocks.push(current);
  }

  const usedBlockIndices = new Set<number>();

  // Pass 1: Match by normalized heading text
  for (const sec of sectionPlan) {
    const targetNorm = normalizeHeading(sec.heading);
    const matchIdx = parsedBlocks.findIndex(
      (b, idx) => !usedBlockIndices.has(idx) && b.normalizedHeading === targetNorm
    );
    if (matchIdx !== -1) {
      usedBlockIndices.add(matchIdx);
      const body = parsedBlocks[matchIdx]!.bodyLines.join("\n").trim();
      if (body.length > 0) {
        result[sec.sectionId] = body;
      }
    }
  }

  // Pass 2: Match remaining sections by positional order if counts align
  for (let i = 0; i < sectionPlan.length; i++) {
    const sec = sectionPlan[i]!;
    if (result[sec.sectionId]) continue;
    const block = parsedBlocks[i];
    if (block && !usedBlockIndices.has(i)) {
      usedBlockIndices.add(i);
      const body = block.bodyLines.join("\n").trim();
      if (body.length > 0) {
        result[sec.sectionId] = body;
      }
    }
  }

  return result;
}

const WHOLE_CHAPTER_PATTERNS = [
  /\b(entire|whole|full|all sections|every section|throughout the chapter|across the chapter)\b/i,
];

const EM_DASH_ONLY_REMOVAL_PATTERN =
  /^(?:please\s+)?(?:remove|replace|strip|eliminate|fix|clean\s+up|get\s+rid\s+of)\s+(?:all\s+|any\s+|the\s+)?(?:em[\s-]?dash(?:es)?|en[\s-]?dash(?:es)?|long\s+dash(?:es)?|m[\s-]?dash(?:es)?)(?:[\s,;]*(?:from|in|across|throughout)\s+(?:(?:this|the)\s+)?(?:chapter|section(?:\s+\d+(?:\.\d+)?)?|text|draft|entire\s+chapter|whole\s+chapter))?(?:[\s,;]*(?:and\s+)?(?:replace|use|substitute)(?:\s+(?:them|it))?\s+(?:with\s+)?(?:something\s+else|commas?|colons?|parentheses|semicolons?|other\s+punctuation|standard\s+punctuation|appropriate\s+punctuation|better\s+punctuation))?[\s.!?]*$/i;

const SUBSTANTIVE_REVISION_PATTERN =
  /\b(add|insert|include|cite|citation|citations|source|sources|reference|references|figure|figures|image|images|diagram|chart|table|tables|expand|shorten|longer|shorter|more\s+words|more\s+pages|fewer\s+pages|rewrite\s+(?:the\s+)?(?:whole|entire|full)|redo\s+(?:the\s+)?(?:whole|entire|full)|start\s+over|new\s+section|data|statistic|statistics|methodology|finding|findings|argument|arguments|discuss|explain|elaborate)\b/i;

const LIGHT_COPY_EDIT_PATTERN =
  /\b(em[\s-]?dash(?:es)?|en[\s-]?dash(?:es)?|long\s+dash(?:es)?|m[\s-]?dash(?:es)?|punctuation|typo|typos|spelling|spellcheck|grammar|grammatical|capitali[sz]ation|british\s+english|american\s+english|uk\s+english|us\s+english|proofread|copy[\s-]?edit)\b/i;

/**
 * Returns true when a user's revision note specifically requests removing/replacing
 * em-dashes or spaced en-dashes without requesting substantive content edits.
 */
export function isEmDashOnlyRequest(instructions: string): boolean {
  const cleaned = instructions.trim().replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > 240) return false;
  return EM_DASH_ONLY_REMOVAL_PATTERN.test(cleaned);
}

/**
 * Returns true when a revision request is a light copy-edit pass (punctuation, em-dashes,
 * typos, spelling, grammar, UK/US spelling) that does not alter facts, citations, figures,
 * tables, or chapter depth. These runs use a fast, low-cost LLM copy-editor (e.g.
 * gemini-4-hydrogen at LOW thinking) instead of re-synthesizing from evidence passages.
 */
export function isLightStyleCopyEditRequest(instructions: string): boolean {
  const cleaned = instructions.trim().replace(/\s+/g, " ");
  if (!cleaned || cleaned.length > 260) return false;
  if (isEmDashOnlyRequest(cleaned)) return true;
  if (SUBSTANTIVE_REVISION_PATTERN.test(cleaned)) return false;
  return LIGHT_COPY_EDIT_PATTERN.test(cleaned);
}

/**
 * Inspects prose lines of a section (skipping fenced :::figure/code blocks and raw URLs)
 * to determine whether the section actually contains em-dashes (—), spaced en-dashes ( – ),
 * or prose double-hyphens ( -- ) that need smart punctuation editing.
 */
export function sectionContainsEmOrSpacedEnDash(markdown: string): boolean {
  const lines = markdown.split(/\r?\n/);
  let inFencedBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^(?:```|~~~|:::)/.test(trimmed)) {
      if (trimmed === ":::" || trimmed === "```" || trimmed === "~~~") {
        inFencedBlock = false;
      } else {
        inFencedBlock = true;
      }
      continue;
    }
    if (inFencedBlock || /^https?:\/\//i.test(trimmed)) {
      continue;
    }
    if (line.includes("\u2014") || /\s\u2013\s/.test(line) || /\s--\s/.test(line)) {
      return true;
    }
  }
  return false;
}

/**
 * Deterministic check for explicit section mentions in the user's revision note
 * (e.g. "in section 1.2", "in Background of the study", or explicit UI targetSectionHeadings).
 */
export function matchExplicitRevisionTargets(params: {
  chapterNumber: number;
  revisionInstructions: string;
  sectionPlan: RevisionSectionDescriptor[];
  explicitTargetHeadings?: string[] | null;
}): string[] {
  const matched = new Set<string>();

  if (params.explicitTargetHeadings && params.explicitTargetHeadings.length > 0) {
    const targetNorms = new Set(params.explicitTargetHeadings.map(normalizeHeading));
    for (const sec of params.sectionPlan) {
      if (targetNorms.has(normalizeHeading(sec.heading))) {
        matched.add(sec.sectionId);
      }
    }
    if (matched.size > 0) {
      return Array.from(matched);
    }
  }

  const note = params.revisionInstructions;
  if (WHOLE_CHAPTER_PATTERNS.some((rx) => rx.test(note))) {
    return [];
  }

  const lowerNote = note.toLowerCase();
  for (const sec of params.sectionPlan) {
    const dottedRef = `${params.chapterNumber}.${sec.orderIndex}`;
    const dottedPattern = new RegExp(`\\b${dottedRef.replace(".", "\\.")}(?!\\.\\d)\\b`);
    const sectionNumPattern = new RegExp(`\\bsection\\s+${sec.orderIndex}(?!\\.\\d)\\b`, "i");
    const normHeading = normalizeHeading(sec.heading);

    if (
      dottedPattern.test(note) ||
      sectionNumPattern.test(note) ||
      (normHeading.length >= 6 && lowerNote.includes(normHeading))
    ) {
      matched.add(sec.sectionId);
    }
  }

  return Array.from(matched);
}

const RevisionTargetSchema = z.object({
  scope: z.enum(["targeted", "all"]),
  sectionIds: z.array(z.string()).default([]),
});

function extractJsonSlice(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

/**
 * Selects only the section IDs affected by a revision request so untouched sections
 * stay byte-for-byte identical. Uses explicit user selection / section mentions first,
 * then a fast LLM classifier for ambiguous notes, safely falling back to all sections.
 */
export async function selectSectionsForRevision(
  params: {
    workflowId: string;
    projectId: string;
    chapterNumber: number;
    chapterTitle: string;
    revisionInstructions: string;
    sectionPlan: RevisionSectionDescriptor[];
    existingProseBySectionId: Record<string, string>;
    explicitTargetHeadings?: string[] | null;
    spendCapUsd: number;
  },
  llmCtx: CallLLMContext
): Promise<string[]> {
  const allIds = params.sectionPlan.map((s) => s.sectionId);
  if (allIds.length <= 1) return allIds;

  // 1. Explicit UI dropdown selection or clear section mention in user's note
  const explicitMatches = matchExplicitRevisionTargets({
    chapterNumber: params.chapterNumber,
    revisionInstructions: params.revisionInstructions,
    sectionPlan: params.sectionPlan,
    explicitTargetHeadings: params.explicitTargetHeadings,
  });
  if (explicitMatches.length > 0) {
    return explicitMatches;
  }

  if (WHOLE_CHAPTER_PATTERNS.some((rx) => rx.test(params.revisionInstructions))) {
    return allIds;
  }

  // 2. Ask classifier which section(s) genuinely need editing
  const sectionList = params.sectionPlan
    .map((sec) => {
      const preview = (params.existingProseBySectionId[sec.sectionId] ?? "")
        .replace(/\s+/g, " ")
        .slice(0, 220);
      return `- id="${sec.sectionId}" | ${params.chapterNumber}.${sec.orderIndex} ${sec.heading} | excerpt: "${preview}"`;
    })
    .join("\n");

  try {
    const res = await callLLM(
      {
        workflowId: params.workflowId,
        projectId: params.projectId,
        step: `classify_revision_targets_ch${params.chapterNumber}`,
        task: "classify",
        system: [
          "You route academic chapter revision requests to ONLY the affected section(s) so untouched sections remain unchanged.",
          'Return ONLY JSON: { "scope": "targeted" | "all", "sectionIds": ["sec_..."] }.',
          'Choose "targeted" with only the relevant section IDs when the user requests a specific addition, correction, figure, or clarification.',
          'Choose "all" only when the request genuinely applies to the entire chapter (e.g. tone, formatting, or rewriting everything).',
        ].join("\n"),
        messages: [
          {
            role: "user",
            content: [
              `Chapter ${params.chapterNumber}: ${params.chapterTitle}`,
              `User revision request: ${params.revisionInstructions}`,
              `Sections:\n${sectionList}`,
            ].join("\n\n"),
          },
        ],
        maxTokens: 300,
        temperature: 0.0,
        spendCapUsd: params.spendCapUsd,
      },
      llmCtx
    );

    const slice = extractJsonSlice(res.text);
    if (slice) {
      const parsed = RevisionTargetSchema.safeParse(JSON.parse(slice));
      if (parsed.success) {
        if (parsed.data.scope === "all") return allIds;
        const validSet = new Set(allIds);
        const filtered = parsed.data.sectionIds.filter((id) => validSet.has(id));
        if (filtered.length > 0) return filtered;
      }
    }
  } catch {
    // Non-fatal: fall back to revising all sections while preserving untouched sentences
  }

  return allIds;
}
