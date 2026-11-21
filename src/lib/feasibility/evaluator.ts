import { FEASIBILITY_CONFIG } from "@/config/feasibility";
import type { FeasibilityVerdict, ProjectType, SourceAccessStatus, SourceType } from "@/db/schema";
import { buildNarrowingSuggestions, screenTopic } from "./topic-screen";

export interface FeasibilitySourceInput {
  url: string;
  doi?: string | null;
  title: string;
  year?: number | null;
  publisher?: string | null;
  sourceType: SourceType;
  credibilityScore: number;
  relevanceScore: number;
  accessStatus: SourceAccessStatus;
  matchedSubtopics?: string[];
}

export interface SubtopicCoverageItem {
  subtopic: string;
  credibleSources: number;
  covered: boolean;
}

export interface FeasibilityEvaluation {
  verdict: FeasibilityVerdict;
  score: number;
  reasons: string[];
  suggestedRefinements: string[];
  requiresPrimaryData: boolean;
  primaryDataNotice: string | null;
  coverage: {
    totalSources: number;
    credibleRelevantSources: number;
    accessibleSources: number;
    distinctDomains: number;
    subtopicsCovered: number;
    totalSubtopics: number;
    recentShare: number;
    subtopicBreakdown: SubtopicCoverageItem[];
  };
  idealPages: number;
  idealPagesRange: [number, number];
  complexityScore: number;
  idealPagesReason: string;
}

export interface EvaluateFeasibilityInput {
  topic: string;
  projectType: ProjectType;
  level?: string | null;
  supervisorNotes?: string | null;
  subtopics: string[];
  sources: FeasibilitySourceInput[];
  referenceYear?: number;
}

function extractDomainOrPublisher(src: FeasibilitySourceInput): string {
  if (src.publisher?.trim()) {
    return src.publisher.trim().toLowerCase();
  }
  try {
    return new URL(src.url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

export function resolveIdealPageRange(
  projectType: ProjectType,
  level?: string | null
): [number, number] {
  const ranges = FEASIBILITY_CONFIG.idealPageRanges;
  if (projectType === "assignment") return [...ranges.assignmentPerQuestion];
  if (projectType === "research") return [...ranges.research];
  if (projectType === "project") return [...ranges.project];

  const lower = (level ?? "").toLowerCase();
  if (lower.includes("phd") || lower.includes("doctor")) return [...ranges.thesisPhd];
  if (lower.includes("master") || lower.includes("msc") || lower.includes("ma ")) {
    return [...ranges.thesisMasters];
  }
  return [...ranges.thesisBachelors];
}

export function computeIdealPagesRecommendation(params: {
  projectType: ProjectType;
  level?: string | null;
  subtopicsCovered: number;
  credibleRelevantSources: number;
  requiresPrimaryData: boolean;
}): {
  idealPages: number;
  idealPagesRange: [number, number];
  complexityScore: number;
  idealPagesReason: string;
} {
  const range = resolveIdealPageRange(params.projectType, params.level);
  const [minPages, maxPages] = range;

  const subtopicFactor = Math.min(1, params.subtopicsCovered / 6);
  const volumeFactor = Math.min(1, params.credibleRelevantSources / 30);
  const primaryDataBoost = params.requiresPrimaryData ? 0.15 : 0;

  const complexityScore = Math.max(
    0,
    Math.min(1, Number((subtopicFactor * 0.45 + volumeFactor * 0.4 + primaryDataBoost).toFixed(2)))
  );

  const rawIdeal = minPages + (maxPages - minPages) * complexityScore;
  const idealPages = Math.max(minPages, Math.min(maxPages, Math.round(rawIdeal)));

  const parts = [
    `${params.projectType === "assignment" ? "Per-question assignment" : "Standard"} range is ${minPages}–${maxPages} pages`,
    `with ${params.credibleRelevantSources} credible relevant sources across ${params.subtopicsCovered} covered subtopic${params.subtopicsCovered === 1 ? "" : "s"}`,
  ];
  if (params.requiresPrimaryData) {
    parts.push("plus empirical methodology and results sections");
  }

  return {
    idealPages,
    idealPagesRange: range,
    complexityScore,
    idealPagesReason: `Recommended ${idealPages} pages (${parts.join(", ")}).`,
  };
}

function sourceMatchesSubtopic(src: FeasibilitySourceInput, subtopic: string): boolean {
  if (src.matchedSubtopics && src.matchedSubtopics.includes(subtopic)) {
    return true;
  }
  const subWords = subtopic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  if (subWords.length === 0) return false;
  const titleLower = src.title.toLowerCase();
  const hits = subWords.filter((w) => titleLower.includes(w)).length;
  return hits >= 2 || hits / subWords.length >= 0.4;
}

export function evaluateFeasibility(input: EvaluateFeasibilityInput): FeasibilityEvaluation {
  const referenceYear = input.referenceYear ?? new Date().getUTCFullYear();
  const t = FEASIBILITY_CONFIG.thresholds;
  const workRules = t.byWorkType[input.projectType];

  const screen = screenTopic(input.topic, {
    supervisorNotes: input.supervisorNotes,
    referenceYear,
  });

  const credibleRelevant = input.sources.filter(
    (s) => s.credibilityScore >= t.minCredibilityScore && s.relevanceScore >= t.minRelevanceScore
  );

  const accessibleSources = credibleRelevant.filter(
    (s) => s.accessStatus === "full_text" || s.accessStatus === "abstract_only"
  );

  const distinctDomains = new Set(credibleRelevant.map(extractDomainOrPublisher)).size;

  const recentSources = credibleRelevant.filter(
    (s) => s.year !== null && s.year !== undefined && referenceYear - s.year <= t.recentYearsWindow
  );
  const recentShare =
    credibleRelevant.length > 0
      ? Number((recentSources.length / credibleRelevant.length).toFixed(2))
      : 0;

  const subtopics = input.subtopics.length > 0 ? input.subtopics : [input.topic];
  const subtopicBreakdown: SubtopicCoverageItem[] = subtopics.map((sub) => {
    const count = credibleRelevant.filter((src) => sourceMatchesSubtopic(src, sub)).length;
    return {
      subtopic: sub,
      credibleSources: count,
      covered: count >= 1,
    };
  });

  const subtopicsCovered = subtopicBreakdown.filter((b) => b.covered).length;
  const subtopicRatio = subtopics.length > 0 ? subtopicsCovered / subtopics.length : 0;

  const coverage = {
    totalSources: input.sources.length,
    credibleRelevantSources: credibleRelevant.length,
    accessibleSources: accessibleSources.length,
    distinctDomains,
    subtopicsCovered,
    totalSubtopics: subtopics.length,
    recentShare,
    subtopicBreakdown,
  };

  const pageRec = computeIdealPagesRecommendation({
    projectType: input.projectType,
    level: input.level,
    subtopicsCovered,
    credibleRelevantSources: credibleRelevant.length,
    requiresPrimaryData: screen.requiresPrimaryData,
  });

  if (screen.status === "not_feasible") {
    return {
      verdict: "not_feasible",
      score: 0,
      reasons: screen.reasons,
      suggestedRefinements: screen.suggestedRefinements,
      requiresPrimaryData: screen.requiresPrimaryData,
      primaryDataNotice: screen.primaryDataNotice,
      coverage,
      ...pageRec,
    };
  }

  const volumeRatio = Math.min(1, credibleRelevant.length / workRules.minCredibleRelevantSources);
  const accessRatio = Math.min(1, accessibleSources.length / workRules.minAccessibleSources);
  const diversityRatio = Math.min(1, distinctDomains / workRules.minDistinctDomains);
  const recencyRatio = Math.min(1, recentShare / t.minRecentShare);

  const score = Math.round(
    volumeRatio * 35 +
      accessRatio * 20 +
      diversityRatio * 15 +
      subtopicRatio * 20 +
      recencyRatio * 10
  );

  if (credibleRelevant.length < workRules.minRefinementSources || accessibleSources.length === 0) {
    const reasons: string[] = [
      `Found only ${credibleRelevant.length} credible, relevant source${credibleRelevant.length === 1 ? "" : "s"} (minimum ${workRules.minCredibleRelevantSources} required for a ${input.projectType} to write without guessing).`,
    ];
    if (accessibleSources.length === 0) {
      reasons.push(
        "No accessible full-text or abstract passages could be verified from the retrieved records."
      );
    }
    return {
      verdict: "not_feasible",
      score: Math.min(score, 35),
      reasons,
      suggestedRefinements: [
        "Broaden overly specific geographic or niche terms, or choose a closely related topic with published peer-reviewed literature.",
        ...buildNarrowingSuggestions(input.topic).slice(0, 1),
      ],
      requiresPrimaryData: screen.requiresPrimaryData,
      primaryDataNotice: screen.primaryDataNotice,
      coverage,
      ...pageRec,
    };
  }

  const refinementGaps: string[] = [...screen.reasons];
  if (credibleRelevant.length < workRules.minCredibleRelevantSources) {
    refinementGaps.push(
      `Found ${credibleRelevant.length} credible sources; ${workRules.minCredibleRelevantSources} or more are needed for full depth.`
    );
  }
  if (accessibleSources.length < workRules.minAccessibleSources) {
    refinementGaps.push(
      `Only ${accessibleSources.length} source${accessibleSources.length === 1 ? "" : "s"} had accessible full text or abstracts (many were paywalled or metadata-only).`
    );
  }
  if (distinctDomains < workRules.minDistinctDomains) {
    refinementGaps.push(
      `Source diversity is narrow (${distinctDomains} distinct publisher/domain${distinctDomains === 1 ? "" : "s"}; at least ${workRules.minDistinctDomains} needed).`
    );
  }
  if (subtopicRatio < t.minSubtopicCoverageRatio) {
    refinementGaps.push(
      `Only ${subtopicsCovered} of ${subtopics.length} planned subtopics have credible source coverage.`
    );
  }

  if (screen.status === "needs_refinement" || refinementGaps.length > 0) {
    return {
      verdict: "needs_refinement",
      score: Math.min(score, 68),
      reasons: refinementGaps,
      suggestedRefinements:
        screen.suggestedRefinements.length > 0
          ? screen.suggestedRefinements
          : buildNarrowingSuggestions(input.topic),
      requiresPrimaryData: screen.requiresPrimaryData,
      primaryDataNotice: screen.primaryDataNotice,
      coverage,
      ...pageRec,
    };
  }

  const positiveReasons = [
    `Verified ${credibleRelevant.length} credible, relevant sources across ${distinctDomains} distinct publishers/domains (${accessibleSources.length} with accessible full text or abstracts).`,
    `Covered ${subtopicsCovered} of ${subtopics.length} planned subtopics (${Math.round(recentShare * 100)}% published within the last ${t.recentYearsWindow} years).`,
  ];
  if (screen.requiresPrimaryData && screen.primaryDataNotice) {
    positiveReasons.push(screen.primaryDataNotice);
  }

  return {
    verdict: "feasible",
    score: Math.max(score, 70),
    reasons: positiveReasons,
    suggestedRefinements: [],
    requiresPrimaryData: screen.requiresPrimaryData,
    primaryDataNotice: screen.primaryDataNotice,
    coverage,
    ...pageRec,
  };
}

export interface AssignmentQuestionEvalInput {
  questionId: string;
  questionText: string;
  subtopics: string[];
  sources: FeasibilitySourceInput[];
}

export interface AssignmentFeasibilitySummary {
  overallVerdict: FeasibilityVerdict;
  feasibleCount: number;
  needsRefinementCount: number;
  notFeasibleCount: number;
  totalIdealPages: number;
  idealPagesReason: string;
  perQuestion: Array<{
    questionId: string;
    questionText: string;
    evaluation: FeasibilityEvaluation;
  }>;
}

export function evaluateAssignmentFeasibility(
  items: AssignmentQuestionEvalInput[],
  referenceYear?: number
): AssignmentFeasibilitySummary {
  const perQuestion = items.map((item) => ({
    questionId: item.questionId,
    questionText: item.questionText,
    evaluation: evaluateFeasibility({
      topic: item.questionText,
      projectType: "assignment",
      subtopics: item.subtopics,
      sources: item.sources,
      referenceYear,
    }),
  }));

  const feasibleCount = perQuestion.filter((q) => q.evaluation.verdict === "feasible").length;
  const needsRefinementCount = perQuestion.filter(
    (q) => q.evaluation.verdict === "needs_refinement"
  ).length;
  const notFeasibleCount = perQuestion.filter(
    (q) => q.evaluation.verdict === "not_feasible"
  ).length;

  let overallVerdict: FeasibilityVerdict = "feasible";
  if (feasibleCount === 0 && notFeasibleCount > 0) {
    overallVerdict = "not_feasible";
  } else if (notFeasibleCount > 0 || needsRefinementCount > 0) {
    overallVerdict = "needs_refinement";
  }

  const totalIdealPages = perQuestion.reduce((sum, q) => sum + q.evaluation.idealPages, 0);

  return {
    overallVerdict,
    feasibleCount,
    needsRefinementCount,
    notFeasibleCount,
    totalIdealPages,
    idealPagesReason: `Summed per-question recommendations across ${items.length} assignment question${items.length === 1 ? "" : "s"} (${totalIdealPages} total pages).`,
    perQuestion,
  };
}
