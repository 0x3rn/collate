import { z } from "zod";
import {
  AI_TASKS,
  estimateCostUsd,
  parseModelSpec,
  resolveModelForTask,
  type LLMProvider,
  type ModelEnvOverrides,
  type TokenUsage,
} from "@/config/ai-models";
import type { AppDb } from "@/db/client";
import { recordJobLog, sumWorkflowCostUsd } from "@/db/queries/jobs-log";
import { LLMError, sanitizeErrorMessage } from "./errors";
import {
  isCloudflareAiGatewayEnabled,
  requireCloudflareGatewayCoords,
  type CloudflareGatewayEnv,
} from "./gateway";
import {
  buildDeepSeekRequestBody,
  parseDeepSeekResponse,
  resolveDeepSeekEndpoint,
  type DeepSeekEndpointUsed,
  type DeepSeekProviderEnv,
} from "./providers/deepseek";
import {
  buildGoogleRequestBody,
  parseGoogleResponse,
  resolveGoogleEndpoint,
  type GoogleEndpointUsed,
  type GoogleProviderEnv,
} from "./providers/google";
import {
  buildOpenAIRequestBody,
  parseOpenAIResponse,
  resolveOpenAIEndpoint,
  type OpenAIEndpointUsed,
  type OpenAIProviderEnv,
} from "./providers/openai";

const ANTHROPIC_API_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 120_000;

export const LLMMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1, "Message content cannot be empty"),
});

export const CallLLMInputSchema = z.object({
  workflowId: z.string().trim().min(1, "workflowId is required for cost attribution"),
  projectId: z.string().trim().min(1).optional(),
  step: z.string().trim().min(1, "step name is required"),
  task: z.enum(AI_TASKS),
  system: z.string().trim().min(1).optional(),
  messages: z.array(LLMMessageSchema).min(1, "At least one message is required"),
  maxTokens: z.number().int().min(1).max(32_000).default(2048),
  temperature: z.number().min(0).max(1).default(0.2),
  timeoutMs: z.number().int().min(10).max(300_000).default(DEFAULT_TIMEOUT_MS),
  modelOverride: z.string().trim().min(1).optional(),
  spendCapUsd: z.number().positive().optional(),
});

export type CallLLMInput = z.input<typeof CallLLMInputSchema>;

export interface AIGatewayEnv
  extends
    ModelEnvOverrides,
    CloudflareGatewayEnv,
    GoogleProviderEnv,
    OpenAIProviderEnv,
    DeepSeekProviderEnv {
  ANTHROPIC_API_KEY?: string;
  APP_ENV?: string;
  ALLOW_DIRECT_ANTHROPIC?: string;
}

export interface CallLLMContext {
  db: AppDb;
  env: AIGatewayEnv;
  fetchFn?: typeof fetch;
  nowFn?: () => number;
  idGenerator?: () => string;
}

export type EndpointUsed =
  | "cloudflare-ai-gateway"
  | "anthropic-direct"
  | GoogleEndpointUsed
  | OpenAIEndpointUsed
  | DeepSeekEndpointUsed;

export interface CallLLMResult {
  text: string;
  provider: LLMProvider;
  model: string;
  stopReason: string | null;
  usage: Required<TokenUsage>;
  costEstimateUsd: number;
  latencyMs: number;
  jobLogId: string;
  endpointUsed: EndpointUsed;
}

const AnthropicResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  stop_reason: z.string().nullable().optional(),
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
    })
  ),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    cache_read_input_tokens: z.number().int().nonnegative().optional(),
    cache_creation_input_tokens: z.number().int().nonnegative().optional(),
  }),
});

export interface ResolvedEndpoint {
  url: string;
  headers: Record<string, string>;
  endpointUsed: EndpointUsed;
}

export function resolveAnthropicEndpoint(
  env: AIGatewayEnv,
  metadata: Record<string, string>
): ResolvedEndpoint {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();

  const baseHeaders: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": ANTHROPIC_API_VERSION,
  };

  if (isCloudflareAiGatewayEnabled(env)) {
    const { accountId, gatewayId, gatewayToken } = requireCloudflareGatewayCoords(env);
    if (!apiKey && !gatewayToken) {
      throw new LLMError({
        code: "CONFIG_ERROR",
        message:
          "AI Gateway requires either ANTHROPIC_API_KEY or CLOUDFLARE_AI_GATEWAY_TOKEN (for BYOK/Unified Billing).",
        retryable: false,
      });
    }

    const headers: Record<string, string> = {
      ...baseHeaders,
      "cf-aig-metadata": JSON.stringify(metadata),
    };
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }
    if (gatewayToken) {
      headers["cf-aig-authorization"] = `Bearer ${gatewayToken}`;
    }

    return {
      url: `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}/anthropic/v1/messages`,
      headers,
      endpointUsed: "cloudflare-ai-gateway",
    };
  }

  if (apiKey) {
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        ...baseHeaders,
        "x-api-key": apiKey,
      },
      endpointUsed: "anthropic-direct",
    };
  }

  throw new LLMError({
    code: "CONFIG_ERROR",
    message:
      "ANTHROPIC_API_KEY is required for Anthropic Claude models (or set USE_CLOUDFLARE_AI_GATEWAY=true with CLOUDFLARE_AI_GATEWAY_TOKEN).",
    retryable: false,
  });
}

/**
 * Returns true when at least one configured LLM provider can serve requests in the given runtime env.
 */
export function hasConfiguredLlmProvider(env: AIGatewayEnv): boolean {
  if (
    env.GEMINI_API_KEY?.trim() ||
    env.OPENAI_API_KEY?.trim() ||
    env.DEEPSEEK_API_KEY?.trim() ||
    env.ANTHROPIC_API_KEY?.trim()
  ) {
    return true;
  }

  return (
    isCloudflareAiGatewayEnabled(env) &&
    Boolean(
      env.CLOUDFLARE_ACCOUNT_ID?.trim() &&
      env.CLOUDFLARE_AI_GATEWAY_ID?.trim() &&
      env.CLOUDFLARE_AI_GATEWAY_TOKEN?.trim()
    )
  );
}

function parseAnthropicResponse(
  rawJson: unknown,
  requestedModel: string
): {
  text: string;
  model: string;
  stopReason: string | null;
  usage: Required<TokenUsage>;
} {
  const validated = AnthropicResponseSchema.safeParse(rawJson);
  if (!validated.success) {
    throw new LLMError({
      code: "BAD_RESPONSE",
      message: `Unexpected provider response schema: ${validated.error.issues.map((i) => i.path.join(".")).join(", ")}`,
      retryable: false,
      cause: validated.error,
    });
  }

  const data = validated.data;
  const text = data.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("");

  if (!text.trim()) {
    throw new LLMError({
      code: "BAD_RESPONSE",
      message: "Provider returned no text content blocks",
      retryable: true,
    });
  }

  return {
    text,
    model: data.model || requestedModel,
    stopReason: data.stop_reason ?? null,
    usage: {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      cacheReadTokens: data.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: data.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

function resolveProviderEndpoint(
  provider: LLMProvider,
  model: string,
  env: AIGatewayEnv,
  metadata: Record<string, string>
): ResolvedEndpoint {
  switch (provider) {
    case "google":
      return resolveGoogleEndpoint(model, env, metadata);
    case "openai":
      return resolveOpenAIEndpoint(env, metadata);
    case "deepseek":
      return resolveDeepSeekEndpoint(env, metadata);
    case "anthropic":
      return resolveAnthropicEndpoint(env, metadata);
  }
}

function buildProviderRequestBody(
  provider: LLMProvider,
  model: string,
  input: z.output<typeof CallLLMInputSchema>
): Record<string, unknown> {
  switch (provider) {
    case "google":
      return buildGoogleRequestBody({
        model,
        task: input.task,
        system: input.system,
        messages: input.messages,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
      });
    case "openai":
      return buildOpenAIRequestBody(model, {
        system: input.system,
        messages: input.messages,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
      });
    case "deepseek":
      return buildDeepSeekRequestBody(model, {
        system: input.system,
        messages: input.messages,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
      });
    case "anthropic":
      return {
        model,
        max_tokens: input.maxTokens,
        temperature: input.temperature,
        messages: input.messages,
        ...(input.system ? { system: input.system } : {}),
      };
  }
}

function parseProviderResponse(
  provider: LLMProvider,
  rawJson: unknown,
  requestedModel: string
): {
  text: string;
  model: string;
  stopReason: string | null;
  usage: Required<TokenUsage>;
} {
  switch (provider) {
    case "google":
      return parseGoogleResponse(rawJson, requestedModel);
    case "openai":
      return parseOpenAIResponse(rawJson, requestedModel);
    case "deepseek":
      return parseDeepSeekResponse(rawJson, requestedModel);
    case "anthropic":
      return parseAnthropicResponse(rawJson, requestedModel);
  }
}

function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const timestamp = Date.parse(headerValue);
  if (!Number.isNaN(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }
  return undefined;
}

function classifyHttpError(
  status: number,
  bodyText: string,
  retryAfterHeader: string | null
): LLMError {
  if (status === 401 || status === 403) {
    return new LLMError({
      code: "AUTH_ERROR",
      message: `Provider authentication failed (HTTP ${status}): ${bodyText}`,
      retryable: false,
      statusCode: status,
    });
  }

  if (status === 429) {
    return new LLMError({
      code: "RATE_LIMITED",
      message: `Provider rate limit hit (HTTP 429): ${bodyText}`,
      retryable: true,
      statusCode: status,
      retryAfterMs: parseRetryAfterMs(retryAfterHeader),
    });
  }

  if (status >= 500 || status === 408) {
    return new LLMError({
      code: "PROVIDER_UNAVAILABLE",
      message: `Provider transient failure (HTTP ${status}): ${bodyText}`,
      retryable: true,
      statusCode: status,
    });
  }

  return new LLMError({
    code: "BAD_RESPONSE",
    message: `Provider rejected request (HTTP ${status}): ${bodyText}`,
    retryable: false,
    statusCode: status,
  });
}

function defaultId(): string {
  return `job_${crypto.randomUUID()}`;
}

export { isCloudflareAiGatewayEnabled } from "./gateway";
export { resolveDeepSeekEndpoint } from "./providers/deepseek";
export { resolveGoogleEndpoint } from "./providers/google";
export { resolveOpenAIEndpoint } from "./providers/openai";

/**
 * Single centralized helper every AI call in Collate must pass through.
 * Enforces input validation, per-task multi-provider model routing
 * (Google Gemini, OpenAI, DeepSeek, Anthropic Claude), spend caps, timeouts,
 * secret redaction, and jobs_log cost auditing.
 */
export async function callLLM(rawInput: CallLLMInput, ctx: CallLLMContext): Promise<CallLLMResult> {
  const parsed = CallLLMInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new LLMError({
      code: "VALIDATION_ERROR",
      message: `Invalid callLLM input: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      retryable: false,
      cause: parsed.error,
    });
  }
  const input = parsed.data;

  const rawModel = input.modelOverride ?? resolveModelForTask(input.task, ctx.env);
  let provider: LLMProvider;
  let model: string;
  try {
    const spec = parseModelSpec(rawModel);
    provider = spec.provider;
    model = spec.model;
  } catch (err) {
    throw new LLMError({
      code: "CONFIG_ERROR",
      message: err instanceof Error ? err.message : String(err),
      retryable: false,
      cause: err,
    });
  }

  const jobLogId = (ctx.idGenerator ?? defaultId)();
  const nowFn = ctx.nowFn ?? (() => Date.now());
  const fetchFn = ctx.fetchFn ?? globalThis.fetch;

  if (input.spendCapUsd !== undefined) {
    const spentSoFar = await sumWorkflowCostUsd(ctx.db, input.workflowId);
    if (spentSoFar >= input.spendCapUsd) {
      const capErr = new LLMError({
        code: "SPEND_CAP_EXCEEDED",
        message: `Workflow ${input.workflowId} reached spend cap ($${spentSoFar.toFixed(4)} >= $${input.spendCapUsd.toFixed(4)})`,
        retryable: false,
      });

      await recordJobLog(ctx.db, {
        id: jobLogId,
        workflowId: input.workflowId,
        projectId: input.projectId ?? null,
        step: input.step,
        provider,
        model,
        status: "failed",
        tokensIn: 0,
        tokensOut: 0,
        costEstimateUsd: 0,
        latencyMs: 0,
        error: capErr.message,
      });

      throw capErr;
    }
  }

  const metadata: Record<string, string> = {
    workflowId: input.workflowId,
    step: input.step,
    task: input.task,
    ...(input.projectId ? { projectId: input.projectId } : {}),
  };

  const endpoint = resolveProviderEndpoint(provider, model, ctx.env, metadata);
  const body = buildProviderRequestBody(provider, model, input);

  const startedAt = nowFn();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetchFn(endpoint.url, {
        method: "POST",
        headers: endpoint.headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      throw new LLMError({
        code: isAbort ? "TIMEOUT" : "PROVIDER_UNAVAILABLE",
        message: isAbort
          ? `LLM request timed out after ${input.timeoutMs}ms`
          : `Network error contacting ${provider} LLM endpoint: ${err instanceof Error ? err.message : String(err)}`,
        retryable: true,
        cause: err,
      });
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw classifyHttpError(response.status, errBody, response.headers.get("retry-after"));
    }

    let rawJson: unknown;
    try {
      rawJson = await response.json();
    } catch (err) {
      throw new LLMError({
        code: "BAD_RESPONSE",
        message: "Provider returned non-JSON response body",
        retryable: false,
        cause: err,
      });
    }

    const parsedResponse = parseProviderResponse(provider, rawJson, model);
    const costEstimateUsd = estimateCostUsd(parsedResponse.model, parsedResponse.usage);
    const latencyMs = Math.max(0, Math.round(nowFn() - startedAt));

    await recordJobLog(ctx.db, {
      id: jobLogId,
      workflowId: input.workflowId,
      projectId: input.projectId ?? null,
      step: input.step,
      provider,
      model: parsedResponse.model,
      status: "succeeded",
      tokensIn: parsedResponse.usage.inputTokens,
      tokensOut: parsedResponse.usage.outputTokens,
      costEstimateUsd,
      latencyMs,
      error: null,
    });

    return {
      text: parsedResponse.text,
      provider,
      model: parsedResponse.model,
      stopReason: parsedResponse.stopReason,
      usage: parsedResponse.usage,
      costEstimateUsd,
      latencyMs,
      jobLogId,
      endpointUsed: endpoint.endpointUsed,
    };
  } catch (err) {
    const llmError =
      err instanceof LLMError
        ? err
        : new LLMError({
            code: "PROVIDER_UNAVAILABLE",
            message: err instanceof Error ? err.message : String(err),
            retryable: false,
            cause: err,
          });

    const latencyMs = Math.max(0, Math.round(nowFn() - startedAt));

    await recordJobLog(ctx.db, {
      id: jobLogId,
      workflowId: input.workflowId,
      projectId: input.projectId ?? null,
      step: input.step,
      provider,
      model,
      status: "failed",
      tokensIn: 0,
      tokensOut: 0,
      costEstimateUsd: 0,
      latencyMs,
      error: sanitizeErrorMessage(llmError.message),
    });

    throw llmError;
  } finally {
    clearTimeout(timer);
  }
}
