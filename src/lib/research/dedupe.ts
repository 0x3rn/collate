import { RESEARCH_CONFIG } from "@/config/research";
import type { SourceType } from "@/db/schema";
import type { DeduplicatedSource, RawSourceCandidate } from "./types";

const TRACKING_QUERY_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "ref",
  "source",
]);

const SOURCE_TYPE_RANK: Record<SourceType, number> = {
  peer_reviewed: 6,
  book: 5,
  institutional: 4,
  dataset: 4,
  preprint: 3,
  web: 1,
};

export function normalizeDoi(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let cleaned = raw.trim().toLowerCase();
  const prefixes = [
    "https://doi.org/",
    "http://doi.org/",
    "https://dx.doi.org/",
    "http://dx.doi.org/",
    "doi:",
  ];
  for (const prefix of prefixes) {
    if (cleaned.startsWith(prefix)) {
      cleaned = cleaned.slice(prefix.length).trim();
    }
  }
  while (cleaned.endsWith(".") || cleaned.endsWith("/")) {
    cleaned = cleaned.slice(0, -1);
  }
  return /^10\.[0-9]{4,9}\/\S+$/.test(cleaned) ? cleaned : null;
}

export function canonicalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.hostname.startsWith("www.")) {
      parsed.hostname = parsed.hostname.slice(4);
    }

    const keptParams: Array<[string, string]> = [];
    for (const [key, val] of parsed.searchParams.entries()) {
      if (!TRACKING_QUERY_PARAMS.has(key.toLowerCase())) {
        keptParams.push([key, val]);
      }
    }
    keptParams.sort(([a], [b]) => a.localeCompare(b));
    parsed.search = "";
    for (const [k, v] of keptParams) {
      parsed.searchParams.append(k, v);
    }

    let pathname = parsed.pathname;
    while (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;
    return parsed.toString();
  } catch {
    return trimmed.toLowerCase();
  }
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function computeTitleSimilarity(normA: string, normB: string): number {
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const setA = new Set(normA.split(" ").filter((t) => t.length >= 2));
  const setB = new Set(normB.split(" ").filter((t) => t.length >= 2));
  if (setA.size === 0 || setB.size === 0) return 0;

  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) overlap++;
  }
  return (2 * overlap) / (setA.size + setB.size);
}

function mergeIntoExisting(target: DeduplicatedSource, incoming: RawSourceCandidate): void {
  const incomingDoi = normalizeDoi(incoming.doi);
  if (!target.doi && incomingDoi) {
    target.doi = incomingDoi;
  }

  if (incoming.authors.length > target.authors.length) {
    target.authors = incoming.authors;
  }
  if (!target.year && incoming.year) {
    target.year = incoming.year;
  }
  if (!target.publisher && incoming.publisher) {
    target.publisher = incoming.publisher;
  }
  if (!target.venue && incoming.venue) {
    target.venue = incoming.venue;
  }
  if (SOURCE_TYPE_RANK[incoming.sourceType] > SOURCE_TYPE_RANK[target.sourceType]) {
    target.sourceType = incoming.sourceType;
  }
  if (
    incoming.citationCount !== null &&
    incoming.citationCount !== undefined &&
    (target.citationCount === null || incoming.citationCount > target.citationCount)
  ) {
    target.citationCount = incoming.citationCount;
  }
  if (
    incoming.abstractText &&
    (!target.abstractText || incoming.abstractText.length > target.abstractText.length)
  ) {
    target.abstractText = incoming.abstractText.trim();
  }
  if (!target.openAccessPdfUrl && incoming.openAccessPdfUrl) {
    target.openAccessPdfUrl = incoming.openAccessPdfUrl;
  }
  if (!target.connectorNames.includes(incoming.connectorName)) {
    target.connectorNames.push(incoming.connectorName);
  }
  if (target.accessStatus === "metadata_only" && target.abstractText) {
    target.accessStatus = "abstract_only";
  }
}

/**
 * Deduplicates sources by DOI, canonical URL, and normalized title similarity (>= 0.85),
 * merging the richest metadata fields from every matching connector record.
 */
export function deduplicateSources(candidates: RawSourceCandidate[]): DeduplicatedSource[] {
  const results: DeduplicatedSource[] = [];
  const byDoi = new Map<string, DeduplicatedSource>();
  const byUrl = new Map<string, DeduplicatedSource>();

  for (const candidate of candidates) {
    const cleanTitle = candidate.title.trim();
    const cleanUrl = candidate.url.trim();
    if (!cleanTitle || !cleanUrl) continue;

    const doi = normalizeDoi(candidate.doi);
    const canonicalUrl = canonicalizeUrl(cleanUrl);
    const normalizedTitle = normalizeTitle(cleanTitle);

    let match: DeduplicatedSource | undefined;
    if (doi) {
      match = byDoi.get(doi);
    }
    if (!match) {
      match = byUrl.get(canonicalUrl);
    }
    if (!match && normalizedTitle.length >= 12) {
      match = results.find((existing) => {
        if (doi && existing.doi && existing.doi !== doi) {
          return false;
        }
        return (
          computeTitleSimilarity(existing.normalizedTitle, normalizedTitle) >=
          RESEARCH_CONFIG.dedupe.titleSimilarityThreshold
        );
      });
    }

    if (match) {
      mergeIntoExisting(match, candidate);
      if (match.doi) byDoi.set(match.doi, match);
      byUrl.set(canonicalUrl, match);
      continue;
    }

    const abstractText = candidate.abstractText?.trim() || null;
    const created: DeduplicatedSource = {
      url: cleanUrl,
      canonicalUrl,
      doi,
      title: cleanTitle,
      normalizedTitle,
      authors: candidate.authors.map((a) => a.trim()).filter(Boolean),
      year: candidate.year ?? null,
      publisher: candidate.publisher?.trim() || null,
      venue: candidate.venue?.trim() || null,
      sourceType: candidate.sourceType,
      connectorName: candidate.connectorName,
      connectorNames: [candidate.connectorName],
      citationCount: candidate.citationCount ?? null,
      abstractText,
      openAccessPdfUrl: candidate.openAccessPdfUrl?.trim() || null,
      accessStatus: abstractText ? "abstract_only" : "metadata_only",
      retrievedAt: candidate.retrievedAt,
    };

    results.push(created);
    if (doi) byDoi.set(doi, created);
    byUrl.set(canonicalUrl, created);
  }

  return results;
}
