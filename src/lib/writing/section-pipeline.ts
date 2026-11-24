import { z } from "zod";
import { WRITING_CONFIG } from "@/config/writing";
import type { ClaimVerdict, SpellingVariant } from "@/db/schema";
import { callLLM, type CallLLMContext } from "@/lib/ai/call-llm";
import type { RetrievedEvidencePassage } from "./retrieval";

export const DraftClaimOutputSchema = z.object({
  text: z.string().trim().min(5),
  citeKey: z.string().trim().min(1),
  passageId: z.string().trim().min(1),
});

export const SectionDraftOutputSchema = z.object({
  prose: z.string().trim().min(20),
  claims: z.array(DraftClaimOutputSchema).default([]),
});

export type DraftClaimOutput = z.infer<typeof DraftClaimOutputSchema>;
export type SectionDraftOutput = z.infer<typeof SectionDraftOutputSchema>;

export const ClaimVerificationResponseSchema = z.object({
  results: z.array(
    z.object({
      index: z.number().int().min(0),
      verdict: z.enum(["supported", "partly_supported", "unsupported"]),
      notes: z.string().default(""),
    })
  ),
});

export interface VerifiedSectionClaim {
  text: string;
  citationId: string;
  citeKey: string;
  passageId: string;
  verdict: ClaimVerdict;
  verified: boolean;
  verifierNotes: string;
}

export interface VerifiedSectionResult {
  prose: string;
  wordCount: number;
  claims: VerifiedSectionClaim[];
  rewriteAttempts: number;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

function buildEvidenceBlock(passages: RetrievedEvidencePassage[]): string {
  return passages
    .map(
      (p) =>
        `[PASSAGE:${p.passageId} | CITE:@${p.citeKey} | SOURCE:${p.sourceTitle} (${p.year ?? "n.d."}) | LOC:${p.location}]\n${p.text}`
    )
    .join("\n\n");
}

export function normalizeCiteKey(raw: string): string {
  return raw.trim().replace(/^\[/, "").replace(/\]$/, "").replace(/^@/, "").trim();
}

function extractClaimsFromProse(
  prose: string,
  passages: RetrievedEvidencePassage[]
): DraftClaimOutput[] {
  const byKey = new Map(passages.map((p) => [p.citeKey, p]));
  const extractedClaims: DraftClaimOutput[] = [];
  const seen = new Set<string>();
  const sentences = prose.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 10);

  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    const bracketMatches = trimmedSentence.match(/\[([^\]]*@[^\]]*)\]/g) ?? [];
    for (const bracket of bracketMatches) {
      const keyMatches = bracket.match(/@([a-zA-Z0-9_:-]+)/g) ?? [];
      for (const rawKey of keyMatches) {
        const key = normalizeCiteKey(rawKey);
        const dedupeKey = `${trimmedSentence}::${key}`;
        if (seen.has(dedupeKey)) continue;
        const passage = byKey.get(key);
        if (passage) {
          seen.add(dedupeKey);
          extractedClaims.push({
            text: trimmedSentence,
            citeKey: key,
            passageId: passage.passageId,
          });
        }
      }
    }
  }

  return extractedClaims;
}

function parseDraftJsonOrFallback(
  rawText: string,
  passages: RetrievedEvidencePassage[]
): SectionDraftOutput {
  const jsonSlice = extractJsonObject(rawText);
  if (jsonSlice) {
    try {
      const parsed = SectionDraftOutputSchema.safeParse(JSON.parse(jsonSlice));
      if (parsed.success) {
        const normalizedClaims = parsed.data.claims.map((c) => ({
          ...c,
          citeKey: normalizeCiteKey(c.citeKey),
        }));
        return {
          prose: parsed.data.prose,
          claims:
            normalizedClaims.length > 0
              ? normalizedClaims
              : extractClaimsFromProse(parsed.data.prose, passages),
        };
      }
    } catch {
      // Fallback below
    }
  }

  return {
    prose: rawText.trim(),
    claims: extractClaimsFromProse(rawText, passages),
  };
}

export interface DraftFigureContext {
  id: string;
  url: string;
  alt: string;
  caption: string;
  attribution: string;
  width: number;
  height: number;
}

export async function draftAndVerifySection(
  input: {
    workflowId: string;
    projectId: string;
    topic: string;
    chapterTitle: string;
    sectionHeading: string;
    wordBudget: number;
    level?: string | null;
    spelling: SpellingVariant;
    priorSummaryText: string;
    glossaryText: string;
    revisionInstructions?: string | null;
    existingSectionProse?: string | null;
    availableFigures?: DraftFigureContext[];
    extraDataContext?: string | null;
    passages: RetrievedEvidencePassage[];
    spendCapUsd: number;
  },
  llmCtx: CallLLMContext
): Promise<VerifiedSectionResult> {
  const passageById = new Map(input.passages.map((p) => [p.passageId, p]));
  const passageByKey = new Map(input.passages.map((p) => [p.citeKey, p]));
  const allowedKeys = Array.from(passageByKey.keys());
  const isSurgicalRevision = Boolean(
    input.revisionInstructions?.trim() && input.existingSectionProse?.trim()
  );

  const figuresBlock =
    input.availableFigures && input.availableFigures.length > 0
      ? input.availableFigures
          .map(
            (f, idx) =>
              `[FIGURE ${idx + 1}]\nurl: ${f.url}\nalt: ${f.alt}\ncaption: ${f.caption}\nattribution: ${f.attribution}\nwidth: ${f.width}\nheight: ${f.height}`
          )
          .join("\n\n")
      : "";

  const systemPrompt = [
    `You are an academic researcher ${isSurgicalRevision ? "performing a surgical revision of" : "drafting"} a section of "${input.chapterTitle}" (${WRITING_CONFIG.promptVersion}).`,
    `Academic level: ${input.level || "University"}. Spelling: ${input.spelling.toUpperCase()} English.`,
    "STRICT EVIDENCE RULES (NON-NEGOTIABLE):",
    "1. Use ONLY the provided passages and verified data tables. Never invent statistics, quotes, or sources.",
    `2. You may cite ONLY these registered citation keys using [@key] syntax: ${allowedKeys.map((k) => `@${k}`).join(", ") || "(none)"}.`,
    "3. Write in original academic prose without copying source sentences verbatim. Do not use em-dashes (\u2014) or spaced en-dashes as sentence punctuation; use commas, colons, parentheses, or separate sentences instead.",
    ...(isSurgicalRevision
      ? [
          "4. SURGICAL REVISION MODE: Preserve all unaffected sentences, existing verified [@key] citations, tables, page breaks (<!-- pagebreak -->), and :::figure blocks from CURRENT SECTION TEXT verbatim. Modify ONLY what the user's revision request specifically asks to add, fix, expand, or tighten.",
        ]
      : []),
    ...(figuresBlock
      ? [
          `${isSurgicalRevision ? "5" : "4"}. VERIFIED FIGURES: Never invent or generate image URLs. When an illustration strengthens this section (or the user requested an image), insert ONLY from VERIFIED FIGURES using the exact fenced block syntax:\n:::figure\nurl: <exact url>\nalt: <alt text>\ncaption: <academic caption explaining the figure>\nattribution: <exact attribution>\nwidth: <exact width>\nheight: <exact height>\n:::`,
        ]
      : []),
    `${isSurgicalRevision ? (figuresBlock ? "6" : "5") : figuresBlock ? "5" : "4"}. Return ONLY a valid JSON object: { "prose": "...", "claims": [{ "text": "...", "citeKey": "bare_key_without_at", "passageId": "..." }] }.`,
  ].join("\n");

  const baseUserPrompt = [
    `Topic: ${input.topic}`,
    `Section heading: ${input.sectionHeading}`,
    `Target length: approximately ${input.wordBudget} words.`,
    input.priorSummaryText ? `Prior chapter memory:\n${input.priorSummaryText}` : "",
    input.glossaryText ? `Glossary terms:\n${input.glossaryText}` : "",
    input.existingSectionProse
      ? `CURRENT SECTION TEXT (preserve untouched sentences verbatim):\n${input.existingSectionProse}`
      : "",
    input.revisionInstructions ? `Revision request from user:\n${input.revisionInstructions}` : "",
    input.extraDataContext ? `Verified empirical data (Rule NN-4):\n${input.extraDataContext}` : "",
    figuresBlock
      ? `VERIFIED FIGURES (open-license, real photographs/diagrams):\n${figuresBlock}`
      : "",
    `VERIFIED EVIDENCE PASSAGES:\n${buildEvidenceBlock(input.passages)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const initialRes = await callLLM(
    {
      workflowId: input.workflowId,
      projectId: input.projectId,
      step: `draft_section:${input.sectionHeading.slice(0, 60)}`,
      task: "draft",
      system: systemPrompt,
      messages: [{ role: "user", content: baseUserPrompt }],
      maxTokens: Math.min(8000, Math.max(1200, Math.round(input.wordBudget * 2.2))),
      temperature: 0.25,
      spendCapUsd: input.spendCapUsd,
    },
    llmCtx
  );

  let currentDraft = parseDraftJsonOrFallback(initialRes.text, input.passages);
  let verifiedClaims: VerifiedSectionClaim[] = [];
  let rewriteAttempts = 0;

  for (let attempt = 0; attempt <= WRITING_CONFIG.retries.maxClaimVerifyRewrites; attempt++) {
    const resolvedFromModel = currentDraft.claims
      .map((c) => {
        const cleanKey = normalizeCiteKey(c.citeKey);
        const byId = passageById.get(c.passageId.trim());
        const byKey = passageByKey.get(cleanKey);
        const psg = byId && byId.citeKey === cleanKey ? byId : byKey;
        if (!psg) return null;
        return {
          claim: { ...c, citeKey: psg.citeKey, passageId: psg.passageId },
          passage: psg,
        };
      })
      .filter(
        (x): x is { claim: DraftClaimOutput; passage: RetrievedEvidencePassage } => x !== null
      );

    const traceableClaims =
      resolvedFromModel.length > 0
        ? resolvedFromModel
        : extractClaimsFromProse(currentDraft.prose, input.passages)
            .map((c) => {
              const psg = passageById.get(c.passageId) ?? passageByKey.get(c.citeKey);
              return psg ? { claim: c, passage: psg } : null;
            })
            .filter(
              (x): x is { claim: DraftClaimOutput; passage: RetrievedEvidencePassage } => x !== null
            );

    if (traceableClaims.length === 0) {
      verifiedClaims = [];
      break;
    }

    const verifyPrompt = [
      "Verify each factual claim strictly against its paired source passage.",
      "Mark a claim 'supported' only if the passage directly supports it, 'partly_supported' if overstated, or 'unsupported' if not backed by the passage.",
      'Return ONLY JSON: { "results": [{ "index": 0, "verdict": "supported|partly_supported|unsupported", "notes": "..." }] }.',
      "",
      ...traceableClaims.map(
        (pair, idx) =>
          `[${idx}] CLAIM: ${pair.claim.text}\nPASSAGE (${pair.passage.passageId} / @${pair.passage.citeKey}): ${pair.passage.text}`
      ),
    ].join("\n\n");

    const verifyRes = await callLLM(
      {
        workflowId: input.workflowId,
        projectId: input.projectId,
        step: `verify_claims:${input.sectionHeading.slice(0, 50)}:a${attempt}`,
        task: "verify",
        system:
          "You are a strict academic fact-checker. Never approve claims not backed by the quoted passage.",
        messages: [{ role: "user", content: verifyPrompt }],
        maxTokens: 2048,
        temperature: 0.0,
        spendCapUsd: input.spendCapUsd,
      },
      llmCtx
    );

    const verdictByIdx = new Map<number, { verdict: ClaimVerdict; notes: string }>();
    const verifyJson = extractJsonObject(verifyRes.text);
    if (verifyJson) {
      try {
        const parsedVerify = ClaimVerificationResponseSchema.safeParse(JSON.parse(verifyJson));
        if (parsedVerify.success) {
          for (const item of parsedVerify.data.results) {
            verdictByIdx.set(item.index, { verdict: item.verdict, notes: item.notes });
          }
        }
      } catch {
        // Unverified claims default to unsupported below
      }
    }

    verifiedClaims = traceableClaims.map((pair, idx) => {
      const outcome = verdictByIdx.get(idx) ?? {
        verdict: "unsupported" as const,
        notes: "Verifier did not confirm support.",
      };
      return {
        text: pair.claim.text,
        citationId: pair.passage.citationId,
        citeKey: pair.passage.citeKey,
        passageId: pair.passage.passageId,
        verdict: outcome.verdict,
        verified: outcome.verdict === "supported",
        verifierNotes: outcome.notes,
      };
    });

    const unsupported = verifiedClaims.filter((c) => !c.verified);
    if (unsupported.length === 0 || attempt === WRITING_CONFIG.retries.maxClaimVerifyRewrites) {
      if (unsupported.length > 0) {
        let cleanedProse = currentDraft.prose;
        for (const bad of unsupported) {
          cleanedProse = cleanedProse
            .replace(bad.text, "")
            .replace(/[ ]{2,}/g, " ")
            .trim();
        }
        currentDraft = { ...currentDraft, prose: cleanedProse || currentDraft.prose };
      }
      break;
    }

    rewriteAttempts++;
    const rewritePrompt = [
      "The fact-checker flagged these claims as unsupported or overstated:",
      ...unsupported.map((u) => `- "${u.text}" (Reason: ${u.verifierNotes})`),
      "Rewrite the section removing or correcting the flagged claims so EVERY remaining factual statement is directly supported by the provided passages.",
      'Return ONLY the updated JSON object { "prose": "...", "claims": [...] }.',
      "",
      `CURRENT PROSE:\n${currentDraft.prose}`,
      "",
      `VERIFIED PASSAGES:\n${buildEvidenceBlock(input.passages)}`,
    ].join("\n\n");

    const rewriteRes = await callLLM(
      {
        workflowId: input.workflowId,
        projectId: input.projectId,
        step: `rewrite_section:${input.sectionHeading.slice(0, 50)}:r${rewriteAttempts}`,
        task: "draft",
        system: systemPrompt,
        messages: [{ role: "user", content: rewritePrompt }],
        maxTokens: Math.min(8000, Math.max(1200, Math.round(input.wordBudget * 2.2))),
        temperature: 0.2,
        spendCapUsd: input.spendCapUsd,
      },
      llmCtx
    );

    currentDraft = parseDraftJsonOrFallback(rewriteRes.text, input.passages);
  }

  return {
    prose: currentDraft.prose,
    wordCount: countWords(currentDraft.prose),
    claims: verifiedClaims.filter((c) => c.verified),
    rewriteAttempts,
  };
}

export type MeasurePagesFn = (markdown: string, wordsPerPage: number) => Promise<number>;

export const defaultMeasurePages: MeasurePagesFn = async (markdown, wordsPerPage) => {
  const words = countWords(markdown);
  return Math.max(1, Math.round(words / Math.max(150, wordsPerPage)));
};

export async function enforceChapterLengthBand(
  params: {
    workflowId: string;
    projectId: string;
    chapterTitle: string;
    assembledMarkdown: string;
    targetPages: number;
    wordsPerPage: number;
    passages: RetrievedEvidencePassage[];
    spendCapUsd: number;
    measurePagesFn?: MeasurePagesFn;
  },
  llmCtx: CallLLMContext
): Promise<{ markdown: string; wordCount: number; pageCount: number; adjustments: number }> {
  const measure = params.measurePagesFn ?? defaultMeasurePages;
  const minPages = Math.max(1, Math.floor(params.targetPages * WRITING_CONFIG.lengthBand.minRatio));
  const maxPages = Math.max(
    minPages + 1,
    Math.ceil(params.targetPages * WRITING_CONFIG.lengthBand.maxRatio)
  );

  let markdown = params.assembledMarkdown;
  let pageCount = await measure(markdown, params.wordsPerPage);
  let adjustments = 0;

  while (
    (pageCount < minPages || pageCount > maxPages) &&
    adjustments < WRITING_CONFIG.retries.maxLengthAdjustmentPasses
  ) {
    adjustments++;
    const isShort = pageCount < minPages;
    const targetWords = params.targetPages * params.wordsPerPage;

    const instruction = isShort
      ? `The chapter currently measures ${pageCount} pages, below the minimum target band (${minPages}-${maxPages} pages; ~${targetWords} words). Expand the analysis using ONLY the verified evidence passages below: add deeper synthesis and comparisons, never filler or repetition. Keep all existing [@citeKey] markers intact and avoid em-dashes (\u2014).`
      : `The chapter currently measures ${pageCount} pages, above the maximum target band (${minPages}-${maxPages} pages; ~${targetWords} words). Tighten wordy prose while keeping every cited factual claim and [@citeKey] intact, and avoid em-dashes (\u2014).`;

    const res = await callLLM(
      {
        workflowId: params.workflowId,
        projectId: params.projectId,
        step: isShort ? `length_expand_${adjustments}` : `length_trim_${adjustments}`,
        task: "draft",
        system:
          "You are an academic editor calibrating chapter depth strictly from verified evidence passages. Do not use em-dashes (\u2014) as sentence punctuation. Output ONLY the revised chapter Markdown.",
        messages: [
          {
            role: "user",
            content: [
              instruction,
              `CHAPTER (${params.chapterTitle}):\n${markdown}`,
              isShort
                ? `ADDITIONAL VERIFIED PASSAGES:\n${buildEvidenceBlock(params.passages)}`
                : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
        maxTokens: 8000,
        temperature: 0.2,
        spendCapUsd: params.spendCapUsd,
      },
      llmCtx
    );

    if (res.text.trim().length > 50) {
      markdown = res.text.trim();
      pageCount = await measure(markdown, params.wordsPerPage);
    } else {
      break;
    }
  }

  return {
    markdown,
    wordCount: countWords(markdown),
    pageCount,
    adjustments,
  };
}

export async function summarizeChapterForMemory(
  params: {
    workflowId: string;
    projectId: string;
    chapterNumber: number;
    chapterTitle: string;
    chapterMarkdown: string;
    spendCapUsd: number;
  },
  llmCtx: CallLLMContext
): Promise<{ summary: string; glossaryTerms: Array<{ term: string; definition: string }> }> {
  try {
    const res = await callLLM(
      {
        workflowId: params.workflowId,
        projectId: params.projectId,
        step: `memory_summary_ch${params.chapterNumber}`,
        task: "extract",
        system:
          'Summarize the chapter for project memory so later chapters stay consistent. Return ONLY JSON: { "summary": "3-5 sentence summary", "glossaryTerms": [{ "term": "...", "definition": "..." }] }.',
        messages: [
          {
            role: "user",
            content: `Chapter ${params.chapterNumber}: ${params.chapterTitle}\n\n${params.chapterMarkdown.slice(0, 12000)}`,
          },
        ],
        maxTokens: 1000,
        temperature: 0.1,
        spendCapUsd: params.spendCapUsd,
      },
      llmCtx
    );

    const jsonSlice = extractJsonObject(res.text);
    if (jsonSlice) {
      const parsed = z
        .object({
          summary: z.string().trim().min(5),
          glossaryTerms: z
            .array(
              z.object({ term: z.string().trim().min(1), definition: z.string().trim().min(2) })
            )
            .default([]),
        })
        .safeParse(JSON.parse(jsonSlice));

      if (parsed.success) {
        return parsed.data;
      }
    }
  } catch {
    // Non-fatal fallback below
  }

  return {
    summary: `Completed Chapter ${params.chapterNumber} (${params.chapterTitle}) with ${countWords(params.chapterMarkdown)} verified words.`,
    glossaryTerms: [],
  };
}
