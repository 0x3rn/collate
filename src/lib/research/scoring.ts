import {
  LOW_CREDIBILITY_DOMAINS,
  RESEARCH_CONFIG,
  TRUSTED_INSTITUTIONAL_DOMAINS,
} from "@/config/research";
import type { DeduplicatedSource, ScoredSource } from "./types";

function extractHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function hostMatchesList(host: string, list: readonly string[]): boolean {
  if (!host) return false;
  return list.some((entry) => {
    if (entry.startsWith(".")) {
      return host.endsWith(entry);
    }
    return host === entry || host.endsWith(`.${entry}`);
  });
}

function tokenizeForRelevance(text: string): Set<string> {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "into",
    "about",
    "using",
    "based",
    "study",
  ]);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));
  return new Set(tokens);
}

export function scoreSourceCredibility(
  source: Pick<
    DeduplicatedSource,
    "sourceType" | "doi" | "url" | "citationCount" | "year" | "publisher" | "venue" | "authors"
  >,
  referenceYear: number = new Date().getUTCFullYear()
): number {
  const cfg = RESEARCH_CONFIG.scoring;
  const host = extractHost(source.url);

  if (hostMatchesList(host, LOW_CREDIBILITY_DOMAINS)) {
    return 10;
  }

  let score = cfg.baseByType[source.sourceType] ?? 25;

  if (source.doi) {
    score += cfg.doiBonus;
  }

  if (hostMatchesList(host, TRUSTED_INSTITUTIONAL_DOMAINS)) {
    score += cfg.trustedDomainBonus;
  }

  if (source.citationCount && source.citationCount > 0) {
    // Smooth log curve: ~4 pts at 5 citations, ~10 pts at 50, ~16 pts at 500+
    const bonus = Math.min(
      cfg.maxCitationBonus,
      Math.round(Math.log10(source.citationCount + 1) * 6)
    );
    score += bonus;
  }

  if (source.year && source.year <= referenceYear + 1) {
    const age = Math.max(0, referenceYear - source.year);
    if (age <= 5) {
      score += cfg.recencyBonusRecent;
    } else if (age <= 10) {
      score += cfg.recencyBonusModerate;
    } else if (age <= 20) {
      score += cfg.recencyBonusOlder;
    }
  }

  if (source.authors.length > 0 && (source.publisher || source.venue)) {
    score += 4;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreSourceRelevance(
  source: Pick<DeduplicatedSource, "title" | "abstractText" | "venue">,
  topic: string,
  subtopics: string[],
  embeddingCosineScore?: number
): { relevanceScore: number; matchedSubtopics: string[] } {
  const sourceText = [source.title, source.abstractText ?? "", source.venue ?? ""].join(" ");
  const sourceTokens = tokenizeForRelevance(sourceText);
  const topicTokens = tokenizeForRelevance(topic);

  let topicHits = 0;
  for (const tok of topicTokens) {
    if (sourceTokens.has(tok)) topicHits++;
  }
  const lexicalTopicRatio = topicTokens.size > 0 ? topicHits / topicTokens.size : 0;

  const matchedSubtopics: string[] = [];
  let bestSubtopicRatio = 0;

  for (const sub of subtopics) {
    const subTokens = tokenizeForRelevance(sub);
    if (subTokens.size === 0) continue;
    let hits = 0;
    for (const tok of subTokens) {
      if (sourceTokens.has(tok)) hits++;
    }
    const ratio = hits / subTokens.size;
    if (ratio > bestSubtopicRatio) bestSubtopicRatio = ratio;
    if (ratio >= 0.35 || hits >= 2) {
      matchedSubtopics.push(sub);
    }
  }

  const lexicalScore = Math.min(
    100,
    Math.round((lexicalTopicRatio * 0.6 + bestSubtopicRatio * 0.4) * 100)
  );

  const combined =
    embeddingCosineScore !== undefined
      ? Math.round(Math.max(0, Math.min(1, embeddingCosineScore)) * 70 + lexicalScore * 0.3)
      : lexicalScore;

  return {
    relevanceScore: Math.max(0, Math.min(100, combined)),
    matchedSubtopics,
  };
}

export function scoreAndRankSources(
  deduped: DeduplicatedSource[],
  topic: string,
  subtopics: string[],
  referenceYear?: number
): ScoredSource[] {
  const scored: ScoredSource[] = deduped.map((src) => {
    const credibilityScore = scoreSourceCredibility(src, referenceYear);
    const { relevanceScore, matchedSubtopics } = scoreSourceRelevance(src, topic, subtopics);
    return {
      ...src,
      credibilityScore,
      relevanceScore,
      matchedSubtopics,
    };
  });

  scored.sort((a, b) => {
    const rankA = a.credibilityScore * 0.55 + a.relevanceScore * 0.45;
    const rankB = b.credibilityScore * 0.55 + b.relevanceScore * 0.45;
    return rankB - rankA;
  });

  return scored;
}

export function countCoveredSubtopics(scored: ScoredSource[]): number {
  const covered = new Set<string>();
  for (const src of scored) {
    if (src.relevanceScore >= RESEARCH_CONFIG.scoring.subtopicRelevancePassThreshold) {
      for (const sub of src.matchedSubtopics) {
        covered.add(sub);
      }
    }
  }
  return covered.size;
}
