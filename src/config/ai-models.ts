/**
 * Centralized AI model IDs, provider routing, token pricing, and spend caps.
 * Model IDs live strictly in config (or runtime env overrides) and are never hard-coded in callers.
 */

export const AI_TASKS = ["draft", "verify", "extract", "classify"] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const LLM_PROVIDERS = ["google", "anthropic", "openai", "deepseek"] as const;
export type LLMProvider = (typeof LLM_PROVIDERS)[number];

export interface ModelPricingUsdPerMillion {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const PROVIDER_DEFAULT_MODELS: Record<LLMProvider, Record<AiTask, string>> = {
  google: {
    draft: "gemini-4-neon",
    verify: "gemini-4-hydrogen",
    extract: "gemini-3.5-flash-lite",
    classify: "gemini-4-hydrogen",
  },
  anthropic: {
    draft: "claude-sonnet-5-5",
    verify: "claude-sonnet-5-5",
    extract: "claude-haiku-5-5",
    classify: "claude-haiku-5-5",
  },
  openai: {
    draft: "gpt-6.1-sol",
    verify: "gpt-6.1-sol",
    extract: "gpt-6-luna",
    classify: "gpt-6-luna",
  },
  deepseek: {
    draft: "deepseek-v4-pro",
    verify: "deepseek-v4-pro",
    extract: "deepseek-flash",
    classify: "deepseek-flash",
  },
};

export const DEFAULT_TASK_MODELS: Record<AiTask, string> = PROVIDER_DEFAULT_MODELS.google;

export const MODEL_PRICING_PER_MILLION_USD: Record<string, ModelPricingUsdPerMillion> = {
  // Google Gemini models (Vertex AI / Gemini Platform standard paid-tier USD per 1M tokens)
  "gemini-4-neon": {
    input: 3.0,
    output: 15.0,
    cacheRead: 0.15,
    cacheWrite: 0,
  },
  "gemini-4-carbon": {
    input: 2.0,
    output: 10.0,
    cacheRead: 0.1,
    cacheWrite: 0,
  },
  "gemini-4-argon": {
    input: 2.0,
    output: 10.0,
    cacheRead: 0.1,
    cacheWrite: 0,
  },
  "gemini-4-hydrogen": {
    input: 1.5,
    output: 7.5,
    cacheRead: 0.075,
    cacheWrite: 0,
  },
  "gemini-3.8-flash": {
    input: 0.75,
    output: 3.75,
    cacheRead: 0.075,
    cacheWrite: 0,
  },
  "gemini-3.7-flash": {
    input: 0.75,
    output: 3.75,
    cacheRead: 0.075,
    cacheWrite: 0,
  },
  "gemini-3.5-flash": {
    input: 0.5,
    output: 3.0,
    cacheRead: 0.05,
    cacheWrite: 0,
  },
  "gemini-3.5-flash-lite": {
    input: 0.3,
    output: 2.5,
    cacheRead: 0.03,
    cacheWrite: 0,
  },
  "gemini-3.1-flash-lite": {
    input: 0.25,
    output: 1.5,
    cacheRead: 0.025,
    cacheWrite: 0,
  },
  "gemini-3.1-pro-preview": {
    input: 2.0,
    output: 12.0,
    cacheRead: 0.2,
    cacheWrite: 0,
  },
  "gemini-3-flash-preview": {
    input: 0.5,
    output: 3.0,
    cacheRead: 0.05,
    cacheWrite: 0,
  },

  // Anthropic Claude models (current Claude 5.x + legacy 4.x)
  "claude-fable-5-2": {
    input: 8.0,
    output: 40.0,
    cacheRead: 0.8,
    cacheWrite: 10.0,
  },
  "claude-opus-5-5": {
    input: 4.0,
    output: 20.0,
    cacheRead: 0.4,
    cacheWrite: 5.0,
  },
  "claude-sonnet-5-5": {
    input: 2.0,
    output: 10.0,
    cacheRead: 0.2,
    cacheWrite: 2.5,
  },
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
  },
  "claude-opus-5": {
    input: 4.0,
    output: 20.0,
    cacheRead: 0.4,
    cacheWrite: 5.0,
  },
  "claude-sonnet-5": {
    input: 2.0,
    output: 10.0,
    cacheRead: 0.2,
    cacheWrite: 2.5,
  },
  "claude-sonnet-4-6": {
    input: 3.0,
    output: 15.0,
    cacheRead: 0.3,
    cacheWrite: 3.75,
  },
  "claude-opus-4-6": {
    input: 15.0,
    output: 75.0,
    cacheRead: 1.5,
    cacheWrite: 18.75,
  },
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

  // OpenAI models (GPT-6.x, GPT-5.x, GPT-4.x, o3/o4-mini)
  "gpt-6-astra": {
    input: 10.0,
    output: 50.0,
    cacheRead: 1.0,
    cacheWrite: 0,
  },
  "gpt-6.2-sol": {
    input: 2.0,
    output: 10.0,
    cacheRead: 0.2,
    cacheWrite: 0,
  },
  "gpt-6.1-sol": {
    input: 2.0,
    output: 10.0,
    cacheRead: 0.2,
    cacheWrite: 0,
  },
  "gpt-6.1-terra": {
    input: 2.0,
    output: 12.0,
    cacheRead: 0.2,
    cacheWrite: 0,
  },
  "gpt-6-sol": {
    input: 2.0,
    output: 10.0,
    cacheRead: 0.2,
    cacheWrite: 0,
  },
  "gpt-6-luna": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0,
  },
  "gpt-5.6-sol": {
    input: 4.0,
    output: 20.0,
    cacheRead: 0.4,
    cacheWrite: 0,
  },
  "gpt-5.6-terra": {
    input: 2.0,
    output: 12.0,
    cacheRead: 0.2,
    cacheWrite: 0,
  },
  "gpt-5.6-luna": {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0,
  },
  "gpt-5.5": {
    input: 2.0,
    output: 10.0,
    cacheRead: 0.2,
    cacheWrite: 0,
  },
  "gpt-5.4": {
    input: 2.0,
    output: 10.0,
    cacheRead: 0.2,
    cacheWrite: 0,
  },
  "gpt-5.4-mini": {
    input: 0.25,
    output: 2.0,
    cacheRead: 0.025,
    cacheWrite: 0,
  },
  "gpt-5.4-nano": {
    input: 0.05,
    output: 0.4,
    cacheRead: 0.005,
    cacheWrite: 0,
  },
  "gpt-5": {
    input: 1.25,
    output: 10.0,
    cacheRead: 0.125,
    cacheWrite: 0,
  },
  "gpt-5-mini": {
    input: 0.25,
    output: 2.0,
    cacheRead: 0.025,
    cacheWrite: 0,
  },
  "gpt-5-nano": {
    input: 0.05,
    output: 0.4,
    cacheRead: 0.005,
    cacheWrite: 0,
  },
  "gpt-4.1": {
    input: 2.0,
    output: 8.0,
    cacheRead: 0.5,
    cacheWrite: 0,
  },
  "gpt-4.1-mini": {
    input: 0.4,
    output: 1.6,
    cacheRead: 0.1,
    cacheWrite: 0,
  },
  "gpt-4o": {
    input: 2.5,
    output: 10.0,
    cacheRead: 1.25,
    cacheWrite: 0,
  },
  o3: {
    input: 2.0,
    output: 8.0,
    cacheRead: 0.5,
    cacheWrite: 0,
  },
  "o4-mini": {
    input: 1.1,
    output: 4.4,
    cacheRead: 0.275,
    cacheWrite: 0,
  },

  // DeepSeek models (active V4 / V4.1 official API IDs, off-peak standard USD per 1M tokens)
  "deepseek-v4-pro": {
    input: 0.66,
    output: 1.98,
    cacheRead: 0.022,
    cacheWrite: 0,
  },
  "deepseek-flash": {
    input: 0.15,
    output: 0.6,
    cacheRead: 0.003,
    cacheWrite: 0,
  },
};

const FALLBACK_PRICING: ModelPricingUsdPerMillion = {
  input: 2.0,
  output: 10.0,
  cacheRead: 0.2,
  cacheWrite: 0,
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
  GEMINI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
}

export interface ParsedModelSpec {
  provider: LLMProvider;
  model: string;
}

const OPENAI_BARE_MODEL_PATTERN = /^(?:gpt-|chatgpt-|o[134](?:$|[-.]))/i;

/**
 * Resolves the provider and bare model ID from a configured model string.
 * Supports bare IDs ("gemini-3.8-flash", "gpt-6.1-sol", "deepseek-v4-pro", "claude-sonnet-5-5")
 * or explicit prefixes ("google/...", "openai/...", "deepseek/...", "anthropic/...").
 */
export function parseModelSpec(rawModel: string): ParsedModelSpec {
  const trimmed = rawModel.trim();
  if (!trimmed) {
    throw new Error("Model ID cannot be empty.");
  }

  const slashIdx = trimmed.indexOf("/");
  if (slashIdx > 0) {
    const prefix = trimmed.slice(0, slashIdx).toLowerCase();
    const model = trimmed.slice(slashIdx + 1).trim();
    if (!model) {
      throw new Error(`Invalid model specification "${trimmed}": missing model name after "/".`);
    }
    if (prefix === "google" || prefix === "gemini" || prefix === "google-vertex") {
      return { provider: "google", model };
    }
    if (prefix === "anthropic" || prefix === "claude") {
      return { provider: "anthropic", model };
    }
    if (prefix === "openai") {
      return { provider: "openai", model };
    }
    if (prefix === "deepseek") {
      return { provider: "deepseek", model };
    }
    throw new Error(
      `Unsupported model provider prefix "${prefix}" in "${trimmed}". Supported providers: google, openai, deepseek, anthropic.`
    );
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("gemini-") || lower === "gemini") {
    return { provider: "google", model: trimmed };
  }
  if (lower.startsWith("claude-") || lower === "claude") {
    return { provider: "anthropic", model: trimmed };
  }
  if (OPENAI_BARE_MODEL_PATTERN.test(trimmed)) {
    return { provider: "openai", model: trimmed };
  }
  if (lower.startsWith("deepseek-") || lower === "deepseek") {
    return { provider: "deepseek", model: trimmed };
  }

  throw new Error(
    `Cannot infer provider for model "${trimmed}". Use a gemini-*, gpt-*/o3/o4-mini, deepseek-*, or claude-* model ID (or prefix with "google/", "openai/", "deepseek/", or "anthropic/").`
  );
}

export function resolveModelForTask(task: AiTask, env: ModelEnvOverrides = {}): string {
  const overrideMap: Record<AiTask, string | undefined> = {
    draft: env.LLM_MODEL_DRAFT,
    verify: env.LLM_MODEL_VERIFY,
    extract: env.LLM_MODEL_EXTRACT,
    classify: env.LLM_MODEL_CLASSIFY,
  };

  const candidate = overrideMap[task]?.trim();
  if (candidate && candidate.length > 0) {
    return candidate;
  }

  if (env.GEMINI_API_KEY?.trim()) {
    return PROVIDER_DEFAULT_MODELS.google[task];
  }
  if (env.ANTHROPIC_API_KEY?.trim()) {
    return PROVIDER_DEFAULT_MODELS.anthropic[task];
  }
  if (env.OPENAI_API_KEY?.trim()) {
    return PROVIDER_DEFAULT_MODELS.openai[task];
  }
  if (env.DEEPSEEK_API_KEY?.trim()) {
    return PROVIDER_DEFAULT_MODELS.deepseek[task];
  }

  return DEFAULT_TASK_MODELS[task];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

function lookupModelPricing(rawModel: string): ModelPricingUsdPerMillion {
  const trimmed = rawModel.trim();
  const bare = trimmed.includes("/") ? trimmed.slice(trimmed.indexOf("/") + 1) : trimmed;

  const exact = MODEL_PRICING_PER_MILLION_USD[bare];
  if (exact) return exact;

  // Handle versioned snapshots returned by providers (e.g. "gpt-5.4-2026-03-05", "claude-haiku-4-5-20251001")
  const strippedVersion = bare.replace(/-(?:\d{4}-\d{2}-\d{2}|\d{8}|\d{3}|latest)$/i, "");
  const normalized = MODEL_PRICING_PER_MILLION_USD[strippedVersion];
  if (normalized) return normalized;

  return FALLBACK_PRICING;
}

export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const pricing = lookupModelPricing(model);
  const inputCost = (usage.inputTokens / 1_000_000) * pricing.input;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.output;
  const cacheReadCost = ((usage.cacheReadTokens ?? 0) / 1_000_000) * pricing.cacheRead;
  const cacheWriteCost = ((usage.cacheWriteTokens ?? 0) / 1_000_000) * pricing.cacheWrite;

  const total = inputCost + outputCost + cacheReadCost + cacheWriteCost;
  return Number(total.toFixed(6));
}
