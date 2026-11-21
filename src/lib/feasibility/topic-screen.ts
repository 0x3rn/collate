import {
  DISALLOWED_TOPIC_PATTERNS,
  FEASIBILITY_CONFIG,
  PRIMARY_DATA_INDICATORS,
} from "@/config/feasibility";

export type TopicScreenStatus = "ok" | "needs_refinement" | "not_feasible";

export interface TopicScreenResult {
  status: TopicScreenStatus;
  flags: Array<"disallowed" | "nonsense" | "too_vague" | "too_broad" | "future_or_unverifiable">;
  reasons: string[];
  suggestedRefinements: string[];
  requiresPrimaryData: boolean;
  primaryDataIndicators: string[];
  primaryDataNotice: string | null;
}

const GENERIC_UMBRELLA_TERMS = new Set([
  "technology",
  "education",
  "economics",
  "health",
  "healthcare",
  "climate",
  "change",
  "history",
  "science",
  "business",
  "management",
  "finance",
  "law",
  "politics",
  "society",
  "africa",
  "nigeria",
  "world",
  "global",
  "artificial",
  "intelligence",
  "medicine",
  "agriculture",
  "energy",
  "marketing",
]);

function isLikelyNonsenseToken(token: string): boolean {
  if (token.length < 4) return false;
  if (/(.)\1{3,}/.test(token)) return true;
  const letters = token.replace(/[^a-z]/g, "");
  if (letters.length >= 6 && !/[aeiouy]/.test(letters)) return true;
  if (letters.length >= 8 && /[bcdfghjklmnpqrstvwxz]{6,}/.test(letters)) return true;
  return false;
}

export function detectPrimaryDataRequirement(
  topic: string,
  supervisorNotes?: string | null
): {
  requiresPrimaryData: boolean;
  indicators: string[];
  notice: string | null;
} {
  const combined = [topic, supervisorNotes ?? ""].join(" ");
  const matched: string[] = [];

  for (const item of PRIMARY_DATA_INDICATORS) {
    if (item.pattern.test(combined)) {
      matched.push(item.label);
    }
  }

  if (matched.length === 0) {
    return { requiresPrimaryData: false, indicators: [], notice: null };
  }

  return {
    requiresPrimaryData: true,
    indicators: matched,
    notice:
      "This topic calls for primary empirical data (" +
      matched.join(", ") +
      "). Collate never fabricates survey numbers, interviews, or lab outputs (Rule NN-4). For your Results chapter you will be able to upload your own CSV/XLSX dataset, analyze a cited public dataset, or generate a clearly labelled results framework with placeholders.",
  };
}

export function buildNarrowingSuggestions(topic: string): string[] {
  const clean = topic.trim().replace(/[?.!]+$/, "");
  return [
    `${clean}: a comparative analysis of outcomes in a specific country or region (2018–2026)`,
    `Factors influencing the effectiveness of ${clean.toLowerCase()} in a defined sector or institution`,
    `Empirical review of policy and implementation challenges in ${clean.toLowerCase()}`,
  ];
}

export function screenTopic(
  topic: string,
  options: { supervisorNotes?: string | null; referenceYear?: number } = {}
): TopicScreenResult {
  const clean = topic.trim();
  const referenceYear = options.referenceYear ?? new Date().getUTCFullYear();
  const primaryData = detectPrimaryDataRequirement(clean, options.supervisorNotes);

  const flags: TopicScreenResult["flags"] = [];
  const reasons: string[] = [];
  const suggestedRefinements: string[] = [];

  for (const rule of DISALLOWED_TOPIC_PATTERNS) {
    if (rule.pattern.test(clean)) {
      return {
        status: "not_feasible",
        flags: ["disallowed"],
        reasons: [
          "This topic falls into a disallowed or harmful category and cannot be worked on in Collate.",
        ],
        suggestedRefinements: [],
        requiresPrimaryData: false,
        primaryDataIndicators: [],
        primaryDataNotice: null,
      };
    }
  }

  const tokens = clean
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const alphaTokens = tokens.filter((t) => /[a-z]{2,}/.test(t));
  const nonsenseCount = alphaTokens.filter(isLikelyNonsenseToken).length;

  if (
    clean.length < FEASIBILITY_CONFIG.topicGuards.minTopicChars ||
    alphaTokens.length === 0 ||
    (alphaTokens.length > 0 && nonsenseCount / alphaTokens.length >= 0.4)
  ) {
    flags.push("nonsense");
    reasons.push(
      "The topic does not contain a clear, recognizable academic subject. Collate cannot write without guessing."
    );
    return {
      status: "not_feasible",
      flags,
      reasons,
      suggestedRefinements: [
        "Write a clear topic sentence specifying the subject, population or context, and outcome to investigate.",
      ],
      requiresPrimaryData: primaryData.requiresPrimaryData,
      primaryDataIndicators: primaryData.indicators,
      primaryDataNotice: primaryData.notice,
    };
  }

  const yearMatches = clean.match(/\b(20[2-9][0-9])\b/g) ?? [];
  const futureYears = yearMatches.map((y) => Number(y)).filter((y) => y > referenceYear);

  const hasFutureEventWording =
    /\b(outcome|results?|winner|impact|aftermath|post[- ]mortem|performance|retrospective|review)\b/i.test(
      clean
    );

  if (futureYears.length > 0 && hasFutureEventWording) {
    flags.push("future_or_unverifiable");
    reasons.push(
      `This topic asks for outcomes or evaluation of future year(s) (${futureYears.join(", ")}), which have not occurred yet and have no verifiable empirical evidence.`
    );
    return {
      status: "not_feasible",
      flags,
      reasons,
      suggestedRefinements: [
        `Adjust the timeframe to completed years (up to ${referenceYear}) or reframe as a documented policy/forecast literature review.`,
      ],
      requiresPrimaryData: primaryData.requiresPrimaryData,
      primaryDataIndicators: primaryData.indicators,
      primaryDataNotice: primaryData.notice,
    };
  }

  const nonGenericTokens = alphaTokens.filter((t) => !GENERIC_UMBRELLA_TERMS.has(t));
  if (
    alphaTokens.length < FEASIBILITY_CONFIG.topicGuards.minWordCountForBroadCheck &&
    nonGenericTokens.length <= 1
  ) {
    flags.push("too_broad");
    reasons.push(
      "This topic is too broad to research thoroughly without losing focus. Narrow it by sector, population, geography, or timeframe."
    );
    suggestedRefinements.push(...buildNarrowingSuggestions(clean));
    return {
      status: "needs_refinement",
      flags,
      reasons,
      suggestedRefinements,
      requiresPrimaryData: primaryData.requiresPrimaryData,
      primaryDataIndicators: primaryData.indicators,
      primaryDataNotice: primaryData.notice,
    };
  }

  return {
    status: "ok",
    flags,
    reasons,
    suggestedRefinements,
    requiresPrimaryData: primaryData.requiresPrimaryData,
    primaryDataIndicators: primaryData.indicators,
    primaryDataNotice: primaryData.notice,
  };
}
