import { z } from "zod";
import { WRITING_CONFIG } from "@/config/writing";
import type { ClaimVerdict, SpellingVariant } from "@/db/schema";
import { callLLM, type CallLLMContext } from "@/lib/ai/call-llm";
import type { RetrievedEvidencePassage } from "./retrieval";
import { writingStyleForLevel } from "./level-style";

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
  preservedExistingClaims?: boolean;
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
  sourceUrl?: string;
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
    chapterGuidance?: string | null;
    revisionInstructions?: string | null;
    existingSectionProse?: string | null;
    isSingleSectionSurgical?: boolean;
    isLightCopyEdit?: boolean;
    availableFigures?: DraftFigureContext[];
    extraDataContext?: string | null;
    passages: RetrievedEvidencePassage[];
    spendCapUsd: number;
  },
  llmCtx: CallLLMContext
): Promise<VerifiedSectionResult> {
  if (
    input.isLightCopyEdit &&
    input.existingSectionProse?.trim() &&
    input.revisionInstructions?.trim()
  ) {
    const existingProse = input.existingSectionProse.trim();
    const existingWords = Math.max(1, countWords(existingProse));
    const copyEditMaxTokens = Math.min(6000, Math.max(800, Math.round(existingWords * 1.8) + 200));

    const copyEditSystem = [
      `You are a careful academic copy-editor performing a targeted punctuation, spelling, or phrasing polish on an already-verified section of "${input.chapterTitle}".`,
      `Spelling: ${input.spelling.toUpperCase()} English.`,
      "Smartly choose natural, context-appropriate punctuation for every edit (for example, replacing em-dashes with commas, colons, semicolons, parentheses, or splitting into two crisp sentences depending on the grammar of each sentence).",
      "STRICT PRESERVATION RULES:",
      "1. Preserve factual meaning, statistics, dates, arguments, and overall length. Do NOT rewrite unaffected sentences.",
      "2. Preserve EVERY [@citeKey] citation marker verbatim in its exact sentence.",
      "3. Preserve EVERY :::figure ... ::: block (including url, alt, caption, attribution, width, height), Markdown table, <!-- pagebreak --> marker, and numeric range (e.g. 2020–2024) verbatim.",
      "4. Never introduce em-dashes (\u2014) or spaced en-dashes (\u2013) as sentence punctuation.",
      "5. Output ONLY the edited section Markdown body (no preamble, no outer ## section heading, no JSON wrapper).",
    ].join("\n");

    const copyEditRes = await callLLM(
      {
        workflowId: input.workflowId,
        projectId: input.projectId,
        step: `copy_edit_section:${input.sectionHeading.slice(0, 55)}`,
        task: "verify",
        thinkingLevel: "LOW",
        system: copyEditSystem,
        messages: [
          {
            role: "user",
            content: [
              `Section heading: ${input.sectionHeading}`,
              `Copy-edit instruction: ${input.revisionInstructions.trim()}`,
              `CURRENT SECTION TEXT:\n${existingProse}`,
            ].join("\n\n"),
          },
        ],
        maxTokens: copyEditMaxTokens,
        temperature: 0.15,
        spendCapUsd: input.spendCapUsd,
      },
      llmCtx
    );

    let editedProse = copyEditRes.text.trim();
    // Unwrap accidental JSON wrapper if a model returns { "prose": "..." }
    if (editedProse.startsWith("{")) {
      const jsonSlice = extractJsonObject(editedProse);
      if (jsonSlice) {
        try {
          const parsed = SectionDraftOutputSchema.safeParse(JSON.parse(jsonSlice));
          if (parsed.success) {
            editedProse = parsed.data.prose.trim();
          }
        } catch {
          // Keep raw editedProse
        }
      }
    }
    // Strip accidental outer ```markdown ... ``` fence
    const fencedMatch = editedProse.match(/^```(?:markdown|md)?\r?\n([\s\S]*?)\r?\n```$/i);
    if (fencedMatch?.[1]?.trim()) {
      editedProse = fencedMatch[1].trim();
    }

    const finalProse = editedProse.length >= 20 ? editedProse : existingProse;
    return {
      prose: finalProse,
      wordCount: countWords(finalProse),
      claims: [],
      rewriteAttempts: 0,
      preservedExistingClaims: true,
    };
  }

  const passageById = new Map(input.passages.map((p) => [p.passageId, p]));
  const passageByKey = new Map(input.passages.map((p) => [p.citeKey, p]));
  const allowedKeys = Array.from(passageByKey.keys());
  const isSurgicalRevision = Boolean(
    input.revisionInstructions?.trim() && input.existingSectionProse?.trim()
  );
  const omitChapterWideContext = Boolean(input.isSingleSectionSurgical && isSurgicalRevision);

  const figuresBlock =
    input.availableFigures && input.availableFigures.length > 0
      ? input.availableFigures
          .map(
            (f, idx) =>
              `[FIGURE ${idx + 1}]\nurl: ${f.url}\nalt: ${f.alt}\ncaption: ${f.caption}\nattribution: ${f.attribution}${f.sourceUrl ? `\nsourceUrl: ${f.sourceUrl}` : ""}\nwidth: ${f.width}\nheight: ${f.height}`
          )
          .join("\n\n")
      : "";

  const hasChapterGuidance = Boolean(!isSurgicalRevision && input.chapterGuidance?.trim());
  const systemRules: string[] = [
    "1. Use ONLY the provided passages, verified data tables, and any explicit experimental measurements supplied by the author below. Never invent statistics, quotes, or sources.",
    `2. You may cite ONLY these registered citation keys using [@key] syntax: ${allowedKeys.map((k) => `@${k}`).join(", ") || "(none)"}. Attach [@key] citations strictly to claims supported by the provided scholarly passages.`,
    "3. Write in original academic prose without copying source sentences verbatim. Do not use em-dashes (\u2014) or spaced en-dashes as sentence punctuation; use commas, colons, parentheses, or separate sentences instead.",
  ];
  if (isSurgicalRevision) {
    systemRules.push(
      `${systemRules.length + 1}. SURGICAL REVISION MODE: Preserve all unaffected sentences, existing verified [@key] citations, tables, page breaks (<!-- pagebreak -->), and :::figure blocks from CURRENT SECTION TEXT verbatim. Modify ONLY what the user's revision request specifically asks to add, fix, expand, or tighten.`
    );
  }
  if (hasChapterGuidance) {
    systemRules.push(
      `${systemRules.length + 1}. AUTHOR PRE-START INSTRUCTIONS & NOTES (APPENDED — STAY ON THE MAIN CHAPTER PLAN): You MUST still fully draft the planned section "${input.sectionHeading}" according to its academic purpose, target word budget, and verified scholarly passages. Do NOT deviate from or abandon the section's main academic scope. Alongside the main plan, apply every instruction from AUTHOR PRE-START INSTRUCTIONS that fits this section (specific focus points, frameworks, terminology, formatting, or experimental details). Treat any numbers, measurements, or tables explicitly supplied by the author as verified primary data (Rule NN-4: report them accurately without altering or fabricating additional figures).`
    );
  }
  if (figuresBlock) {
    systemRules.push(
      `${systemRules.length + 1}. VERIFIED FIGURES: Never invent or generate image URLs. When an illustration strengthens this section (or the user requested an image), insert ONLY from VERIFIED FIGURES using the exact fenced block syntax:\n:::figure\nurl: <exact url>\nalt: <alt text>\ncaption: <academic caption explaining the figure>\nattribution: <exact attribution>\nsourceUrl: <exact sourceUrl if provided>\nwidth: <exact width>\nheight: <exact height>\n:::`
    );
  }
  systemRules.push(
    `${systemRules.length + 1}. Return ONLY a valid JSON object: { "prose": "...", "claims": [{ "text": "...", "citeKey": "bare_key_without_at", "passageId": "..." }] }.`
  );

  const systemPrompt = [
    `You are an academic researcher ${isSurgicalRevision ? "performing a surgical revision of" : "drafting"} a section of "${input.chapterTitle}" (${WRITING_CONFIG.promptVersion}).`,
    `Academic level: ${input.level || "University"}. Spelling: ${input.spelling.toUpperCase()} English.`,
    writingStyleForLevel(input.level),
    "STRICT EVIDENCE RULES (NON-NEGOTIABLE):",
    ...systemRules,
  ].join("\n");

  const baseUserPrompt = [
    `Topic: ${input.topic}`,
    `Section heading: ${input.sectionHeading}`,
    `Target length: approximately ${input.wordBudget} words.`,
    !omitChapterWideContext && input.priorSummaryText
      ? `Prior chapter memory:\n${input.priorSummaryText}`
      : "",
    !omitChapterWideContext && input.glossaryText ? `Glossary terms:\n${input.glossaryText}` : "",
    input.existingSectionProse
      ? `CURRENT SECTION TEXT (preserve untouched sentences verbatim):\n${input.existingSectionProse}`
      : "",
    hasChapterGuidance
      ? `AUTHOR PRE-START INSTRUCTIONS & NOTES (apply alongside the main plan without deviating from "${input.sectionHeading}"):\n${input.chapterGuidance!.trim()}`
      : "",
    input.revisionInstructions ? `Revision request from user:\n${input.revisionInstructions}` : "",
    input.extraDataContext ? `Verified empirical data (Rule NN-4):\n${input.extraDataContext}` : "",
    figuresBlock
      ? `VERIFIED FIGURES (open-license, real photographs/diagrams):\n${figuresBlock}`
      : "",
    input.passages.length > 0
      ? `VERIFIED EVIDENCE PASSAGES:\n${buildEvidenceBlock(input.passages)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const sectionMaxTokens = Math.min(8000, Math.max(1200, Math.round(input.wordBudget * 2.2)));
  const draftThinkingLevel = isSurgicalRevision ? ("LOW" as const) : undefined;

  const initialRes = await callLLM(
    {
      workflowId: input.workflowId,
      projectId: input.projectId,
      step: `draft_section:${input.sectionHeading.slice(0, 60)}`,
      task: "draft",
      system: systemPrompt,
      messages: [{ role: "user", content: baseUserPrompt }],
      maxTokens: sectionMaxTokens,
      temperature: 0.25,
      ...(draftThinkingLevel ? { thinkingLevel: draftThinkingLevel } : {}),
      spendCapUsd: input.spendCapUsd,
    },
    llmCtx
  );

  let currentDraft = parseDraftJsonOrFallback(initialRes.text, input.passages);
  let verifiedClaims: VerifiedSectionClaim[] = [];
  let rewriteAttempts = 0;

  // For surgical revisions that only polish/clarify existing verified text without introducing
  // any new [@citeKey] markers or expanding length by >25%, avoid redundant re-verification loops.
  const extractCiteKeySet = (text: string): Set<string> => {
    const keys = new Set<string>();
    for (const m of text.matchAll(/@([a-zA-Z0-9_:-]+)/g)) {
      if (m[1]) keys.add(m[1]);
    }
    return keys;
  };
  let skipVerifyForLightSurgical = false;
  if (isSurgicalRevision && input.existingSectionProse) {
    const oldKeys = extractCiteKeySet(input.existingSectionProse);
    const newKeys = extractCiteKeySet(currentDraft.prose);
    const addedNewCitation = Array.from(newKeys).some((k) => !oldKeys.has(k));
    const oldWords = Math.max(1, countWords(input.existingSectionProse));
    const newWords = countWords(currentDraft.prose);
    const expandedSignificantly = newWords > oldWords * 1.25 + 60;
    if (!addedNewCitation && !expandedSignificantly) {
      skipVerifyForLightSurgical = true;
      verifiedClaims = extractClaimsFromProse(currentDraft.prose, input.passages)
        .map((c) => {
          const psg = passageById.get(c.passageId) ?? passageByKey.get(c.citeKey);
          if (!psg) return null;
          return {
            text: c.text,
            citationId: psg.citationId,
            citeKey: psg.citeKey,
            passageId: psg.passageId,
            verdict: "supported" as ClaimVerdict,
            verified: true,
            verifierNotes: "Preserved from previously verified section.",
          };
        })
        .filter((x): x is VerifiedSectionClaim => x !== null);
    }
  }

  const maxVerifyRewrites = skipVerifyForLightSurgical
    ? -1
    : isSurgicalRevision
      ? 0
      : WRITING_CONFIG.retries.maxClaimVerifyRewrites;

  for (let attempt = 0; attempt <= maxVerifyRewrites; attempt++) {
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
      "Verify each factual claim against its paired source passage.",
      "Mark a claim 'supported' if the passage supports it, 'partly_supported' if it synthesizes or frames the finding broadly without contradicting the passage, or 'unsupported' ONLY if the claim fabricates facts or contradicts the passage.",
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
          "You are a strict academic fact-checker. Flag fabricated or contradicted claims as unsupported, while allowing accurate academic synthesis backed by the passage.",
        messages: [{ role: "user", content: verifyPrompt }],
        maxTokens: 1600,
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
        // Only genuinely unsupported claims fail verification; partly_supported synthesis
        // does not trigger expensive full-section rewrite cascades.
        verified: outcome.verdict === "supported" || outcome.verdict === "partly_supported",
        verifierNotes: outcome.notes,
      };
    });

    const unsupported = verifiedClaims.filter((c) => c.verdict === "unsupported");
    if (unsupported.length === 0 || attempt === maxVerifyRewrites) {
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
      "The fact-checker flagged these claims as unsupported:",
      ...unsupported.map((u) => `- "${u.text}" (Reason: ${u.verifierNotes})`),
      "Rewrite ONLY the flagged sentences so EVERY remaining factual statement is directly supported by the provided passages. Keep all unaffected sentences verbatim.",
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
        maxTokens: sectionMaxTokens,
        temperature: 0.2,
        thinkingLevel: "LOW",
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
