export const ORIGINALITY_CONFIG = {
  shingleSize: 5,
  maxSentenceOverlapRatio: 0.35,
  maxOverallOverlapPct: 12,
  /** Embedding cosine similarity that triggers mosaic-paraphrase inspection when combined with lexical phrasing overlap. */
  maxSemanticParaphraseScore: 0.89,
  /** Embedding cosine similarity above which a sentence is flagged as a near-verbatim semantic clone regardless of lexical overlap. */
  maxSemanticCloneScore: 0.96,
  /** Minimum 3-gram phrasing overlap ratio required alongside high semantic similarity (0.89-0.96) to distinguish mosaic plagiarism from valid cited scientific synthesis. */
  maxSemanticTrigramOverlapRatio: 0.3,
  /** Embedding cosine similarity threshold for detecting multi-sentence structural mirroring of a single source. */
  structureMirroringScore: 0.88,
  maxConsecutiveSingleSourceMirror: 3,
  maxDirectQuotePct: 2.0,
  maxCrossUserSimilarityPct: 18,
  maxRewritePasses: 1,
  allowWaiverByConfig: false,
} as const;
