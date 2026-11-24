export const ORIGINALITY_CONFIG = {
  shingleSize: 5,
  maxSentenceOverlapRatio: 0.35,
  maxOverallOverlapPct: 12,
  maxSemanticParaphraseScore: 0.88,
  maxConsecutiveSingleSourceMirror: 3,
  maxDirectQuotePct: 2.0,
  maxCrossUserSimilarityPct: 18,
  maxRewritePasses: 1,
  allowWaiverByConfig: false,
} as const;
