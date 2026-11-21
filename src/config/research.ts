/**
 * Configurable research sweep limits, credibility weights, and deduplication thresholds.
 * Kept strictly in config (Appendix B) rather than hard-coded across modules.
 */

export const RESEARCH_CONFIG = {
  queryPlan: {
    minQueries: 15,
    maxQueries: 40,
    minSubtopics: 3,
    maxSubtopics: 8,
  },
  dedupe: {
    titleSimilarityThreshold: 0.85,
  },
  caps: {
    defaultSpendCapUsd: 2.0,
    maxRunDurationMs: 20 * 60 * 1000, // 20 minutes per research sweep
    maxSourcesToFetchPerRun: 60,
    maxHtmlBytes: 2_500_000, // 2.5 MB page fetch cap
    perRequestTimeoutMs: 12_000,
  },
  scoring: {
    baseByType: {
      peer_reviewed: 62,
      book: 58,
      institutional: 55,
      dataset: 55,
      preprint: 46,
      web: 25,
    },
    doiBonus: 12,
    trustedDomainBonus: 14,
    maxCitationBonus: 16,
    recencyBonusRecent: 10, // <= 5 years old
    recencyBonusModerate: 6, // <= 10 years old
    recencyBonusOlder: 2, // <= 20 years old
    subtopicRelevancePassThreshold: 40,
  },
} as const;

export const TRUSTED_INSTITUTIONAL_DOMAINS = [
  ".gov",
  ".edu",
  ".ac.uk",
  ".edu.ng",
  "who.int",
  "worldbank.org",
  "imf.org",
  "un.org",
  "oecd.org",
  "unesco.org",
  "ieee.org",
  "acm.org",
  "nature.com",
  "sciencedirect.com",
  "springer.com",
  "wiley.com",
  "nih.gov",
  "ncbi.nlm.nih.gov",
  "arxiv.org",
] as const;

export const LOW_CREDIBILITY_DOMAINS = [
  "pinterest.com",
  "quora.com",
  "reddit.com",
  "chegg.com",
  "coursehero.com",
  "studocu.com",
  "bartleby.com",
  "ukessays.com",
  "essayshark.com",
  "tiktok.com",
  "instagram.com",
  "facebook.com",
] as const;
