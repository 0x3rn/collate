import type { ProjectType } from "@/db/schema";

export const FEASIBILITY_CONFIG = {
  thresholds: {
    minCredibilityScore: 50,
    minRelevanceScore: 40,
    minSubtopicCoverageRatio: 0.6,
    recentYearsWindow: 10,
    minRecentShare: 0.25,
    byWorkType: {
      assignment: {
        minCredibleRelevantSources: 3,
        minAccessibleSources: 2,
        minDistinctDomains: 2,
        minRefinementSources: 2,
      },
      research: {
        minCredibleRelevantSources: 6,
        minAccessibleSources: 4,
        minDistinctDomains: 3,
        minRefinementSources: 3,
      },
      project: {
        minCredibleRelevantSources: 8,
        minAccessibleSources: 5,
        minDistinctDomains: 4,
        minRefinementSources: 4,
      },
      thesis: {
        minCredibleRelevantSources: 10,
        minAccessibleSources: 6,
        minDistinctDomains: 4,
        minRefinementSources: 5,
      },
    } satisfies Record<
      ProjectType,
      {
        minCredibleRelevantSources: number;
        minAccessibleSources: number;
        minDistinctDomains: number;
        minRefinementSources: number;
      }
    >,
  },
  idealPageRanges: {
    assignmentPerQuestion: [2, 6] as const,
    research: [15, 40] as const,
    project: [40, 70] as const,
    thesisBachelors: [50, 80] as const,
    thesisMasters: [80, 150] as const,
    thesisPhd: [150, 300] as const,
  },
  topicGuards: {
    minTopicChars: 10,
    minWordCountForBroadCheck: 4,
  },
} as const;

export const DISALLOWED_TOPIC_PATTERNS: ReadonlyArray<{
  category: string;
  pattern: RegExp;
}> = [
  {
    category: "explosives_or_weapons",
    pattern:
      /\b(how to (make|build|manufacture|assemble) (a )?(bomb|explosive|ied|pipe bomb|chemical weapon|biological weapon))\b/i,
  },
  {
    category: "self_harm",
    pattern: /\b(how to (commit suicide|kill myself|self[- ]?harm)|suicide methods?)\b/i,
  },
  {
    category: "cyber_exploitation",
    pattern:
      /\b(write|create|build|deploy) (ransomware|keylogger|trojan|malware|phishing kit|zero[- ]day exploit)\b/i,
  },
  {
    category: "illicit_drug_synthesis",
    pattern:
      /\b(how to (cook|synthesize|manufacture) (methamphetamine|meth|fentanyl|heroin|crack cocaine))\b/i,
  },
  {
    category: "fraud_instruction",
    pattern:
      /\b(how to (forge|counterfeit|launder money|commit credit card fraud|steal identities))\b/i,
  },
];

export const PRIMARY_DATA_INDICATORS: ReadonlyArray<{
  label: string;
  pattern: RegExp;
}> = [
  {
    label: "survey / questionnaire",
    pattern: /\b(survey of|questionnaire|respondents|likert scale)\b/i,
  },
  {
    label: "interviews / focus groups",
    pattern: /\b(semi[- ]structured interviews?|focus group|in[- ]depth interviews?)\b/i,
  },
  {
    label: "laboratory or clinical experiment",
    pattern:
      /\b(laboratory experiment|clinical trial|randomized controlled trial|experimental group|control group)\b/i,
  },
  {
    label: "field study / primary data collection",
    pattern: /\b(field study|primary data|empirical field measurement|sample of \d+)\b/i,
  },
];
