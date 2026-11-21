import { z } from "zod";
import {
  AI_TASKS,
  estimateCostUsd,
  resolveModelForTask,
  type ModelEnvOverrides,
  type TokenUsage,
} from "@/config/ai-models";
import type { AppDb } from "@/db/client";
import { recordJobLog, sumWorkflowCostUsd } from "@/db/queries/jobs-log";
import { LLMError, sanitizeErrorMessage } from "./errors";

const ANTHROPIC_API_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 60_000;

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

export interface AIGatewayEnv extends ModelEnvOverrides {
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_GATEWAY_ID?: string;
  CLOUDFLARE_AI_GATEWAY_TOKEN?: string;
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

export interface CallLLMResult {
  text: string;
  model: string;
  stopReason: string | null;
  usage: Required<TokenUsage>;
  costEstimateUsd: number;
  latencyMs: number;
  jobLogId: string;
  endpointUsed: "cloudflare-ai-gateway" | "anthropic-direct";
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
  endpointUsed: "cloudflare-ai-gateway" | "anthropic-direct";
}

export function resolveAnthropicEndpoint(
  env: AIGatewayEnv,
  metadata: Record<string, string>
): ResolvedEndpoint {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const gatewayId = env.CLOUDFLARE_AI_GATEWAY_ID?.trim();
  const gatewayToken = env.CLOUDFLARE_AI_GATEWAY_TOKEN?.trim();
  const apiKey = env.ANTHROPIC_API_KEY?.trim();

  const baseHeaders: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": ANTHROPIC_API_VERSION,
  };

  if (accountId && gatewayId) {
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

  const allowDirect = env.ALLOW_DIRECT_ANTHROPIC === "true" && (env.APP_ENV ?? "dev") === "dev";
  if (allowDirect) {
    if (!apiKey) {
      throw new LLMError({
        code: "CONFIG_ERROR",
        message: "ANTHROPIC_API_KEY is required when ALLOW_DIRECT_ANTHROPIC=true.",
        retryable: false,
      });
    }
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
      "Cloudflare AI Gateway is not configured (set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_GATEWAY_ID).",
    retryable: false,
  });
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

/**
 * Single centralized helper every AI call in Collate must pass through.
 * Enforces input validation, spend caps, AI Gateway routing, timeouts, and jobs_log cost auditing.
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

  const model = input.modelOverride ?? resolveModelForTask(input.task, ctx.env);
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
        provider: "anthropic",
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

  const endpoint = resolveAnthropicEndpoint(ctx.env, {
    workflowId: input.workflowId,
    step: input.step,
    task: input.task,
    ...(input.projectId ? { projectId: input.projectId } : {}),
  });

  const body: Record<string, unknown> = {
    model,
    max_tokens: input.maxTokens,
    temperature: input.temperature,
    messages: input.messages,
  };
  if (input.system) {
    body.system = input.system;
  }

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
          : `Network error contacting AI Gateway: ${err instanceof Error ? err.message : String(err)}`,
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

    const usage: Required<TokenUsage> = {
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      cacheReadTokens: data.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: data.usage.cache_creation_input_tokens ?? 0,
    };

    const actualModel = data.model || model;
    const costEstimateUsd = estimateCostUsd(actualModel, usage);
    const latencyMs = Math.max(0, Math.round(nowFn() - startedAt));

    await recordJobLog(ctx.db, {
      id: jobLogId,
      workflowId: input.workflowId,
      projectId: input.projectId ?? null,
      step: input.step,
      provider: "anthropic",
      model: actualModel,
      status: "succeeded",
      tokensIn: usage.inputTokens,
      tokensOut: usage.outputTokens,
      costEstimateUsd,
      latencyMs,
      error: null,
    });

    return {
      text,
      model: actualModel,
      stopReason: data.stop_reason ?? null,
      usage,
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
      provider: "anthropic",
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
