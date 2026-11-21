/**
 * Centralized AI model IDs, token pricing, and spend caps.
 * Model IDs live strictly in config (or runtime env overrides) and are never hard-coded in callers.
 */

export const AI_TASKS = ["draft", "verify", "extract", "classify"] as const;
export type AiTask = (typeof AI_TASKS)[number];

export interface ModelPricingUsdPerMillion {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const DEFAULT_TASK_MODELS: Record<AiTask, string> = {
  draft: "claude-sonnet-4-5",
  verify: "claude-sonnet-4-5",
  extract: "claude-haiku-4-5",
  classify: "claude-haiku-4-5",
};

export const MODEL_PRICING_PER_MILLION_USD: Record<string, ModelPricingUsdPerMillion> = {
  "claude-sonnet-4-5": {
    input: 3.0,
    output: 15.0,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-haiku-4-5": {
    input: 1.0,
    output: 5.0,
    cacheRead: 0.1,
    cacheWrite: 1.25,
  },
  "claude-opus-4-1": {
    input: 15.0,
    output: 75.0,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },
};

const FALLBACK_PRICING: ModelPricingUsdPerMillion = {
  input: 3.0,
  output: 15.0,
  cacheRead: 0.3,
  cacheWrite: 3.75,
};

export const DEFAULT_SPEND_CAPS_USD = {
  perResearchRun: 2.0,
  perChapter: 5.0,
} as const;

export interface ModelEnvOverrides {
  LLM_MODEL_DRAFT?: string;
  LLM_MODEL_VERIFY?: string;
  LLM_MODEL_EXTRACT?: string;
  LLM_MODEL_CLASSIFY?: string;
}

export function resolveModelForTask(task: AiTask, env: ModelEnvOverrides = {}): string {
  const overrideMap: Record<AiTask, string | undefined> = {
    draft: env.LLM_MODEL_DRAFT,
    verify: env.LLM_MODEL_VERIFY,
    extract: env.LLM_MODEL_EXTRACT,
    classify: env.LLM_MODEL_CLASSIFY,
  };

  const candidate = overrideMap[task]?.trim();
  return candidate && candidate.length > 0 ? candidate : DEFAULT_TASK_MODELS[task];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const pricing = MODEL_PRICING_PER_MILLION_USD[model] ?? FALLBACK_PRICING;
  const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;
  const cacheReadCost = ((usage.cacheReadTokens ?? 0) / 1_000_000) * pricing.cacheRead;
  const cacheWriteCost = ((usage.cacheWriteTokens ?? 0) / 1_000_000) * pricing.cacheWrite;

  const total = inputCost + outputCost + cacheReadCost + cacheWriteCost;
  return Number(total.toFixed(6));
}
