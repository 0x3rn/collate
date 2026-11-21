import { z } from "zod";
import { RESEARCH_CONFIG } from "@/config/research";
import type { ProjectType } from "@/db/schema";
import { callLLM, type CallLLMContext } from "@/lib/ai/call-llm";

export const QueryPlanSchema = z.object({
  subtopics: z.array(z.string().trim().min(3).max(160)).min(3).max(10),
  keyTerms: z.array(z.string().trim().min(2).max(80)).min(3).max(25),
  synonyms: z.array(z.string().trim().min(2).max(80)).max(25),
  queries: z
    .array(
      z.object({
        query: z.string().trim().min(4).max(220),
        intent: z.enum(["scholarly", "systematic_review", "case_study", "statistics", "web"]),
        subtopic: z.string().trim().min(2).max(160),
      })
    )
    .min(1)
    .max(50),
});

export type QueryPlan = z.infer<typeof QueryPlanSchema>;

export interface PlanQueriesInput {
  workflowId: string;
  projectId?: string;
  topic: string;
  projectType: ProjectType;
  field?: string | null;
  level?: string | null;
  supervisorNotes?: string | null;
  spendCapUsd?: number;
}

function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

function tokenizeTopic(topic: string): string[] {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "into",
    "over",
    "about",
    "impact",
    "study",
    "analysis",
    "effect",
    "effects",
    "role",
  ]);
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !stopWords.has(w));
}

/**
 * Deterministic expansion helper that guarantees 15–40 diverse queries
 * (including systematic review, case study, and statistics queries) even if the LLM under-generates.
 */
export function buildDeterministicQuerySupplement(
  topic: string,
  field?: string | null,
  existingSubtopics: string[] = []
): QueryPlan {
  const cleanTopic = topic.trim();
  const fieldTag = field?.trim() ? ` ${field.trim()}` : "";
  const keywords = Array.from(new Set(tokenizeTopic(cleanTopic))).slice(0, 8);
  const corePhrase = keywords.slice(0, 4).join(" ") || cleanTopic;

  const subtopics =
    existingSubtopics.length >= RESEARCH_CONFIG.queryPlan.minSubtopics
      ? existingSubtopics.slice(0, RESEARCH_CONFIG.queryPlan.maxSubtopics)
      : [
          `Theoretical foundations of ${corePhrase}`,
          `Empirical evidence and outcomes of ${corePhrase}`,
          `Methodology and measurement in ${corePhrase}`,
          `Policy, challenges, and implementation gaps in ${corePhrase}`,
        ];

  const templates: QueryPlan["queries"] = [
    { query: `"${cleanTopic}"`, intent: "scholarly", subtopic: subtopics[0]! },
    {
      query: `systematic review of ${corePhrase}`,
      intent: "systematic_review",
      subtopic: subtopics[1]!,
    },
    {
      query: `meta-analysis ${corePhrase}${fieldTag}`,
      intent: "systematic_review",
      subtopic: subtopics[1]!,
    },
    {
      query: `empirical study ${corePhrase}${fieldTag}`,
      intent: "scholarly",
      subtopic: subtopics[1]!,
    },
    { query: `case study of ${corePhrase}`, intent: "case_study", subtopic: subtopics[1]! },
    { query: `statistics on ${corePhrase}`, intent: "statistics", subtopic: subtopics[1]! },
    {
      query: `quantitative data ${corePhrase} report`,
      intent: "statistics",
      subtopic: subtopics[2]!,
    },
    {
      query: `theoretical framework ${corePhrase}${fieldTag}`,
      intent: "scholarly",
      subtopic: subtopics[0]!,
    },
    {
      query: `literature review ${corePhrase}`,
      intent: "systematic_review",
      subtopic: subtopics[0]!,
    },
    { query: `research methodology ${corePhrase}`, intent: "scholarly", subtopic: subtopics[2]! },
    {
      query: `challenges and barriers ${corePhrase}`,
      intent: "web",
      subtopic: subtopics[3] ?? subtopics[0]!,
    },
    {
      query: `policy implications ${corePhrase}`,
      intent: "web",
      subtopic: subtopics[3] ?? subtopics[0]!,
    },
    { query: `comparative study ${corePhrase}`, intent: "case_study", subtopic: subtopics[1]! },
    {
      query: `longitudinal evaluation ${corePhrase}`,
      intent: "scholarly",
      subtopic: subtopics[2]!,
    },
    {
      query: `official report dataset ${corePhrase}`,
      intent: "statistics",
      subtopic: subtopics[2]!,
    },
    {
      query: `recent trends ${corePhrase} 2022 2023 2024 2025`,
      intent: "web",
      subtopic: subtopics[3] ?? subtopics[0]!,
    },
  ];

  return {
    subtopics,
    keyTerms:
      keywords.length >= 3 ? keywords : [corePhrase, "empirical evidence", "literature review"],
    synonyms: [],
    queries: templates,
  };
}

export function normalizeAndBoundQueryPlan(
  rawPlan: QueryPlan,
  topic: string,
  field?: string | null
): QueryPlan {
  const seen = new Set<string>();
  const dedupedQueries: QueryPlan["queries"] = [];

  for (const item of rawPlan.queries) {
    const key = item.query.toLowerCase().replace(/\s+/g, " ").trim();
    if (!seen.has(key)) {
      seen.add(key);
      dedupedQueries.push({ ...item, query: item.query.trim() });
    }
  }

  if (dedupedQueries.length < RESEARCH_CONFIG.queryPlan.minQueries) {
    const supplement = buildDeterministicQuerySupplement(topic, field, rawPlan.subtopics);
    for (const item of supplement.queries) {
      const key = item.query.toLowerCase().replace(/\s+/g, " ").trim();
      if (!seen.has(key) && dedupedQueries.length < RESEARCH_CONFIG.queryPlan.maxQueries) {
        seen.add(key);
        dedupedQueries.push(item);
      }
    }
  }

  const boundedQueries = dedupedQueries.slice(0, RESEARCH_CONFIG.queryPlan.maxQueries);
  const subtopics = Array.from(new Set(rawPlan.subtopics)).slice(
    0,
    RESEARCH_CONFIG.queryPlan.maxSubtopics
  );

  return {
    subtopics,
    keyTerms: Array.from(new Set(rawPlan.keyTerms)).slice(0, 20),
    synonyms: Array.from(new Set(rawPlan.synonyms)).slice(0, 20),
    queries: boundedQueries,
  };
}

/**
 * Generates subtopics, key terms, synonyms, and 15–40 diverse search queries using callLLM().
 */
export async function planResearchQueries(
  input: PlanQueriesInput,
  ctx?: CallLLMContext
): Promise<{ plan: QueryPlan; usedFallback: boolean }> {
  const cleanTopic = input.topic.trim();
  if (cleanTopic.length < 4) {
    throw new Error("Topic must be at least 4 characters to plan research queries.");
  }

  if (!ctx) {
    const fallback = buildDeterministicQuerySupplement(cleanTopic, input.field);
    return {
      plan: normalizeAndBoundQueryPlan(fallback, cleanTopic, input.field),
      usedFallback: true,
    };
  }

  const systemPrompt = [
    "You are an academic research librarian planning a comprehensive literature and web search.",
    "Return ONLY a single valid JSON object matching this schema:",
    "{",
    '  "subtopics": ["3 to 8 distinct subtopics covering the topic thoroughly"],',
    '  "keyTerms": ["5 to 15 core domain terms"],',
    '  "synonyms": ["3 to 15 alternative academic/regional terms"],',
    '  "queries": [',
    '    { "query": "search query", "intent": "scholarly|systematic_review|case_study|statistics|web", "subtopic": "matching subtopic" }',
    "  ]",
    "}",
    "Generate 18 to 30 diverse queries including systematic review, case study, empirical study, and statistics phrasing.",
    "Never include prose outside the JSON object.",
  ].join("\n");

  const userPrompt = [
    `Work type: ${input.projectType}`,
    `Topic: ${cleanTopic}`,
    input.field ? `Field: ${input.field}` : "",
    input.level ? `Academic level: ${input.level}` : "",
    input.supervisorNotes ? `Notes: ${input.supervisorNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const llmResult = await callLLM(
    {
      workflowId: input.workflowId,
      projectId: input.projectId,
      step: "research_query_plan",
      task: "extract",
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 2400,
      temperature: 0.2,
      spendCapUsd: input.spendCapUsd ?? RESEARCH_CONFIG.caps.defaultSpendCapUsd,
    },
    ctx
  );

  const jsonSlice = extractFirstJsonObject(llmResult.text);
  if (jsonSlice) {
    try {
      const parsed = QueryPlanSchema.safeParse(JSON.parse(jsonSlice));
      if (parsed.success) {
        return {
          plan: normalizeAndBoundQueryPlan(parsed.data, cleanTopic, input.field),
          usedFallback: false,
        };
      }
    } catch {
      // Fall through to deterministic supplement below
    }
  }

  const fallback = buildDeterministicQuerySupplement(cleanTopic, input.field);
  return {
    plan: normalizeAndBoundQueryPlan(fallback, cleanTopic, input.field),
    usedFallback: true,
  };
}
