export const WRITING_CONFIG = {
  promptVersion: "collate-chapter-v1.0",
  lengthBand: {
    minRatio: 0.9,
    maxRatio: 1.2,
  },
  retries: {
    maxClaimVerifyRewrites: 2,
    maxLengthAdjustmentPasses: 2,
  },
  limits: {
    chapterCeilingMs: 24 * 60 * 60 * 1000,
    perChapterSpendCapUsd: 5.0,
    maxRevisionSpendCapUsd: 2.0,
    maxCsvBytes: 5 * 1024 * 1024,
    maxCsvRows: 20_000,
    topPassagesPerSection: 8,
  },
} as const;
