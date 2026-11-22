import { ORIGINALITY_CONFIG } from "@/config/originality";
import { callLLM, type CallLLMContext } from "@/lib/ai/call-llm";
import { cosineSimilarity, type EmbeddingProvider } from "@/lib/research/embeddings";

export interface FlaggedSpan {
  kind:
    | "source_overlap"
    | "semantic_paraphrase"
    | "structure_mirroring"
    | "quote_budget"
    | "uncited_quote"
    | "cross_user_similarity";
  sentence: string;
  score: number;
  sourceId?: string;
  passageId?: string;
  reason: string;
}

export interface ExternalPlagiarismReport {
  provider: string;
  similarityPct: number;
  reportUrl?: string;
  checkedAt: string;
  passed: boolean;
}

export interface ExternalPlagiarismProvider {
  readonly name: string;
  checkText(text: string): Promise<ExternalPlagiarismReport>;
}

export interface OriginalityEvaluation {
  passed: boolean;
  waived: boolean;
  overlapScore: number;
  semanticScore: number;
  quoteSharePct: number;
  crossUserScore: number;
  flaggedSpans: FlaggedSpan[];
  externalReport: ExternalPlagiarismReport | null;
  shingleHashes: string[];
}

export function tokenizeNormalized(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\[@[^\]]+\]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function splitIntoSentences(markdown: string): string[] {
  const withoutHeadings = markdown
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#") && !line.trim().startsWith("|"))
    .join(" ");

  return withoutHeadings
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => tokenizeNormalized(s).length >= ORIGINALITY_CONFIG.shingleSize);
}

export function hashShingle(shingle: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < shingle.length; i++) {
    hash ^= shingle.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildShingleHashSet(
  text: string,
  k: number = ORIGINALITY_CONFIG.shingleSize
): Set<string> {
  const tokens = tokenizeNormalized(text);
  const hashes = new Set<string>();
  if (tokens.length < k) return hashes;
  for (let i = 0; i <= tokens.length - k; i++) {
    hashes.add(hashShingle(tokens.slice(i, i + k).join(" ")));
  }
  return hashes;
}

export function checkSourceShingleOverlap(
  draftMarkdown: string,
  sourcePassages: Array<{ passageId: string; sourceId: string; text: string }>
): { overlapPct: number; flagged: FlaggedSpan[]; draftHashes: Set<string> } {
  const sentences = splitIntoSentences(draftMarkdown);
  const draftHashes = buildShingleHashSet(draftMarkdown);

  if (sentences.length === 0 || sourcePassages.length === 0) {
    return { overlapPct: 0, flagged: [], draftHashes };
  }

  const passageSets = sourcePassages.map((p) => ({
    passageId: p.passageId,
    sourceId: p.sourceId,
    hashes: buildShingleHashSet(p.text),
  }));

  const allSourceHashes = new Set<string>();
  for (const ps of passageSets) {
    for (const h of ps.hashes) allSourceHashes.add(h);
  }

  const flagged: FlaggedSpan[] = [];
  for (const sentence of sentences) {
    const sHashes = buildShingleHashSet(sentence);
    if (sHashes.size === 0) continue;

    let bestRatio = 0;
    let bestPassage: { passageId: string; sourceId: string } | null = null;

    for (const ps of passageSets) {
      let overlap = 0;
      for (const h of sHashes) {
        if (ps.hashes.has(h)) overlap++;
      }
      const ratio = overlap / sHashes.size;
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestPassage = { passageId: ps.passageId, sourceId: ps.sourceId };
      }
    }

    if (bestRatio >= ORIGINALITY_CONFIG.maxSentenceOverlapRatio && bestPassage) {
      flagged.push({
        kind: "source_overlap",
        sentence,
        score: Number((bestRatio * 100).toFixed(1)),
        sourceId: bestPassage.sourceId,
        passageId: bestPassage.passageId,
        reason: `Sentence shares ${Math.round(bestRatio * 100)}% n-gram shingles with stored source passage.`,
      });
    }
  }

  let matchedDraftShingles = 0;
  for (const h of draftHashes) {
    if (allSourceHashes.has(h)) matchedDraftShingles++;
  }
  const overlapPct =
    draftHashes.size > 0 ? Number(((matchedDraftShingles / draftHashes.size) * 100).toFixed(2)) : 0;

  return { overlapPct, flagged, draftHashes };
}

export function checkDirectQuoteBudget(draftMarkdown: string): {
  quoteSharePct: number;
  flagged: FlaggedSpan[];
} {
  const totalWords = tokenizeNormalized(draftMarkdown).length;
  if (totalWords === 0) return { quoteSharePct: 0, flagged: [] };

  const flagged: FlaggedSpan[] = [];
  let quotedWords = 0;

  const quoteRegex = /["“]([^"”]{20,})["”](.{0,45})/g;
  for (const match of draftMarkdown.matchAll(quoteRegex)) {
    const quoteText = match[1] ?? "";
    const trailing = match[2] ?? "";
    const words = tokenizeNormalized(quoteText).length;
    if (words < 5) continue;

    quotedWords += words;
    const hasCitation = /\[@[a-zA-Z0-9_:-]+/.test(trailing) || /\([^)]+\d{4}[^)]*\)/.test(trailing);
    if (!hasCitation) {
      flagged.push({
        kind: "uncited_quote",
        sentence: `"${quoteText}"`,
        score: 100,
        reason: "Direct quote is missing an adjacent citation marker.",
      });
    }
  }

  const quoteSharePct = Number(((quotedWords / totalWords) * 100).toFixed(2));
  if (quoteSharePct > ORIGINALITY_CONFIG.maxDirectQuotePct) {
    flagged.push({
      kind: "quote_budget",
      sentence: `Direct quotes account for ${quoteSharePct}% of chapter words.`,
      score: quoteSharePct,
      reason: `Direct quote share (${quoteSharePct}%) exceeds the ${ORIGINALITY_CONFIG.maxDirectQuotePct}% cap.`,
    });
  }

  return { quoteSharePct, flagged };
}

export async function checkSemanticSimilarityAndMirroring(
  draftMarkdown: string,
  sourcePassages: Array<{ passageId: string; sourceId: string; text: string }>,
  embedder?: EmbeddingProvider
): Promise<{ semanticScorePct: number; flagged: FlaggedSpan[] }> {
  const sentences = splitIntoSentences(draftMarkdown);
  if (!embedder || sentences.length === 0 || sourcePassages.length === 0) {
    return { semanticScorePct: 0, flagged: [] };
  }

  const sampledSentences = sentences.slice(0, 40);
  const sampledPassages = sourcePassages.slice(0, 25);

  const [sentVecs, passVecs] = await Promise.all([
    embedder.embed(sampledSentences),
    embedder.embed(sampledPassages.map((p) => p.text)),
  ]);

  const flagged: FlaggedSpan[] = [];
  let maxScore = 0;
  let consecutiveSameSource = 0;
  let prevSourceId: string | null = null;

  for (let i = 0; i < sampledSentences.length; i++) {
    const sVec = sentVecs[i];
    if (!sVec) continue;

    let bestSim = 0;
    let bestPassage: { passageId: string; sourceId: string } | null = null;

    for (let j = 0; j < sampledPassages.length; j++) {
      const pVec = passVecs[j];
      if (!pVec) continue;
      const sim = cosineSimilarity(sVec, pVec);
      if (sim > bestSim) {
        bestSim = sim;
        bestPassage = sampledPassages[j]!;
      }
    }

    if (bestSim > maxScore) maxScore = bestSim;

    if (bestSim >= ORIGINALITY_CONFIG.maxSemanticParaphraseScore && bestPassage) {
      flagged.push({
        kind: "semantic_paraphrase",
        sentence: sampledSentences[i]!,
        score: Number((bestSim * 100).toFixed(1)),
        sourceId: bestPassage.sourceId,
        passageId: bestPassage.passageId,
        reason: `Close semantic paraphrase detected (${Math.round(bestSim * 100)}% similarity to a single source passage).`,
      });
    }

    if (bestSim >= 0.78 && bestPassage) {
      if (bestPassage.sourceId === prevSourceId) {
        consecutiveSameSource++;
      } else {
        consecutiveSameSource = 1;
        prevSourceId = bestPassage.sourceId;
      }
      if (consecutiveSameSource >= ORIGINALITY_CONFIG.maxConsecutiveSingleSourceMirror) {
        flagged.push({
          kind: "structure_mirroring",
          sentence: sampledSentences[i]!,
          score: Number((bestSim * 100).toFixed(1)),
          sourceId: bestPassage.sourceId,
          reason: `Section mirrors a single source's structure across ${consecutiveSameSource} consecutive sentences.`,
        });
      }
    } else {
      consecutiveSameSource = 0;
      prevSourceId = null;
    }
  }

  return {
    semanticScorePct: Number((maxScore * 100).toFixed(1)),
    flagged,
  };
}

export function checkCrossUserSimilarity(
  draftHashes: Set<string>,
  otherUserFingerprints: Array<{ chapterVersionId: string; shingleHashes: string[] }>
): { crossUserScorePct: number; flagged: FlaggedSpan[] } {
  if (draftHashes.size === 0 || otherUserFingerprints.length === 0) {
    return { crossUserScorePct: 0, flagged: [] };
  }

  let maxJaccard = 0;
  let matchedVersionId: string | null = null;

  for (const fp of otherUserFingerprints) {
    if (fp.shingleHashes.length === 0) continue;
    const otherSet = new Set(fp.shingleHashes);
    let intersection = 0;
    for (const h of draftHashes) {
      if (otherSet.has(h)) intersection++;
    }
    const union = draftHashes.size + otherSet.size - intersection;
    const jaccard = union > 0 ? intersection / union : 0;
    if (jaccard > maxJaccard) {
      maxJaccard = jaccard;
      matchedVersionId = fp.chapterVersionId;
    }
  }

  const pct = Number((maxJaccard * 100).toFixed(2));
  const flagged: FlaggedSpan[] = [];
  if (pct > ORIGINALITY_CONFIG.maxCrossUserSimilarityPct && matchedVersionId) {
    flagged.push({
      kind: "cross_user_similarity",
      sentence: `Chapter shares ${pct}% structural/n-gram overlap with another user's chapter on a similar topic.`,
      score: pct,
      reason: `Exceeds cross-user uniqueness ceiling (${ORIGINALITY_CONFIG.maxCrossUserSimilarityPct}%). Structural diversification rewrite required.`,
    });
  }

  return { crossUserScorePct: pct, flagged };
}

export async function evaluateChapterOriginality(params: {
  draftMarkdown: string;
  sourcePassages: Array<{ passageId: string; sourceId: string; text: string }>;
  otherUserFingerprints?: Array<{ chapterVersionId: string; shingleHashes: string[] }>;
  embedder?: EmbeddingProvider;
  externalProvider?: ExternalPlagiarismProvider;
  waiveGate?: boolean;
}): Promise<OriginalityEvaluation> {
  const shingleCheck = checkSourceShingleOverlap(params.draftMarkdown, params.sourcePassages);
  const quoteCheck = checkDirectQuoteBudget(params.draftMarkdown);
  const semanticCheck = await checkSemanticSimilarityAndMirroring(
    params.draftMarkdown,
    params.sourcePassages,
    params.embedder
  );
  const crossUserCheck = checkCrossUserSimilarity(
    shingleCheck.draftHashes,
    params.otherUserFingerprints ?? []
  );

  let externalReport: ExternalPlagiarismReport | null = null;
  if (params.externalProvider) {
    externalReport = await params.externalProvider.checkText(params.draftMarkdown);
  }

  const flaggedSpans: FlaggedSpan[] = [
    ...shingleCheck.flagged,
    ...quoteCheck.flagged,
    ...semanticCheck.flagged,
    ...crossUserCheck.flagged,
  ];

  const strictPass =
    flaggedSpans.length === 0 &&
    shingleCheck.overlapPct <= ORIGINALITY_CONFIG.maxOverallOverlapPct &&
    quoteCheck.quoteSharePct <= ORIGINALITY_CONFIG.maxDirectQuotePct &&
    crossUserCheck.crossUserScorePct <= ORIGINALITY_CONFIG.maxCrossUserSimilarityPct &&
    (externalReport ? externalReport.passed : true);

  const waived = !strictPass && Boolean(params.waiveGate ?? ORIGINALITY_CONFIG.allowWaiverByConfig);

  return {
    passed: strictPass || waived,
    waived,
    overlapScore: shingleCheck.overlapPct,
    semanticScore: semanticCheck.semanticScorePct,
    quoteSharePct: quoteCheck.quoteSharePct,
    crossUserScore: crossUserCheck.crossUserScorePct,
    flaggedSpans,
    externalReport,
    shingleHashes: Array.from(shingleCheck.draftHashes).slice(0, 2500),
  };
}

export async function runOriginalityGateWithRewrite(params: {
  workflowId: string;
  projectId: string;
  chapterTitle: string;
  draftMarkdown: string;
  sourcePassages: Array<{ passageId: string; sourceId: string; text: string }>;
  otherUserFingerprints?: Array<{ chapterVersionId: string; shingleHashes: string[] }>;
  embedder?: EmbeddingProvider;
  externalProvider?: ExternalPlagiarismProvider;
  llmCtx?: CallLLMContext;
  spendCapUsd?: number;
  waiveGate?: boolean;
}): Promise<{ markdown: string; evaluation: OriginalityEvaluation; rewritePasses: number }> {
  let markdown = params.draftMarkdown;
  let evaluation = await evaluateChapterOriginality({
    draftMarkdown: markdown,
    sourcePassages: params.sourcePassages,
    otherUserFingerprints: params.otherUserFingerprints,
    embedder: params.embedder,
    externalProvider: params.externalProvider,
    waiveGate: params.waiveGate,
  });

  let rewritePasses = 0;

  while (
    !evaluation.passed &&
    params.llmCtx &&
    rewritePasses < ORIGINALITY_CONFIG.maxRewritePasses
  ) {
    rewritePasses++;
    const hasCrossUser = evaluation.flaggedSpans.some((f) => f.kind === "cross_user_similarity");

    const prompt = [
      "Rewrite the flagged passages below in fresh, original academic phrasing while keeping all factual meanings and [@citeKey] citation markers intact.",
      "Do NOT paste phrases from source passages. Convert unnecessary direct quotes into original cited paraphrase.",
      hasCrossUser
        ? "Diversify the structural emphasis, ordering of arguments, and analytical framing so this chapter is distinctly written from any prior work on this topic."
        : "",
      "FLAGGED ITEMS:",
      ...evaluation.flaggedSpans
        .slice(0, 12)
        .map((f, i) => `${i + 1}. [${f.kind}] ${f.reason} — "${f.sentence}"`),
      "",
      `CHAPTER MARKDOWN (${params.chapterTitle}):\n${markdown}`,
      "",
      "Return ONLY the revised chapter Markdown.",
    ]
      .filter(Boolean)
      .join("\n");

    const res = await callLLM(
      {
        workflowId: params.workflowId,
        projectId: params.projectId,
        step: `originality_rewrite_${rewritePasses}`,
        task: "draft",
        system:
          "You are an academic integrity editor rewriting flagged overlapping sentences into original cited prose without losing any factual claim or [@citeKey].",
        messages: [{ role: "user", content: prompt }],
        maxTokens: 8000,
        temperature: 0.35,
        spendCapUsd: params.spendCapUsd ?? 3.0,
      },
      params.llmCtx
    );

    if (res.text.trim().length > 40) {
      markdown = res.text.trim();
      evaluation = await evaluateChapterOriginality({
        draftMarkdown: markdown,
        sourcePassages: params.sourcePassages,
        otherUserFingerprints: params.otherUserFingerprints,
        embedder: params.embedder,
        externalProvider: params.externalProvider,
        waiveGate: params.waiveGate,
      });
    } else {
      break;
    }
  }

  return { markdown, evaluation, rewritePasses };
}
