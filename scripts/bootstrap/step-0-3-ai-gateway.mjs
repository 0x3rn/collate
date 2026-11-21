import fs from "node:fs";
import path from "node:path";
import { createStepRunner, ROOT } from "./_runner.mjs";

const step = createStepRunner("Phase 0 / Step 0.3 (Cloudflare AI Gateway + callLLM Cost Logging)");

async function main() {
  step.logStep("1. Verifying Step 0.2 database foundation is present");
  for (const required of [
    "src/db/schema.ts",
    "src/db/client.ts",
    "src/db/queries/jobs-log.ts",
    "tests/helpers/in-memory-d1.ts",
  ]) {
    if (!fs.existsSync(path.join(ROOT, required))) {
      throw new Error(`Missing ${required}. Please ensure Step 0.2 completed before Step 0.3.`);
    }
  }
  const drizzleDir = path.join(ROOT, "drizzle");
  const hasMigration =
    fs.existsSync(drizzleDir) && fs.readdirSync(drizzleDir).some((f) => f.endsWith(".sql"));
  if (!hasMigration) {
    throw new Error("No SQL migration found in drizzle/. Please run Step 0.2 first.");
  }
  step.log("  ✓ Step 0.2 database layer and migrations verified");

  step.logStep("2. Adding SQL workflow cost aggregation helper to jobs-log queries");
  step.writeFileEnsureDir(
    "src/db/queries/jobs-log.ts",
    `import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "../client";
import { JOB_STATUSES, jobsLog, type JobLogRecord } from "../schema";

export const RecordJobLogInputSchema = z.object({
  id: z.string().min(1),
  workflowId: z.string().min(1),
  projectId: z.string().min(1).nullable().optional(),
  step: z.string().min(1),
  provider: z.string().min(1).default("anthropic"),
  model: z.string().min(1),
  status: z.enum(JOB_STATUSES),
  tokensIn: z.number().int().nonnegative().default(0),
  tokensOut: z.number().int().nonnegative().default(0),
  costEstimateUsd: z.number().nonnegative().default(0),
  latencyMs: z.number().int().nonnegative().nullable().optional(),
  error: z.string().max(4000).nullable().optional(),
  now: z.date().optional(),
});

export type RecordJobLogInput = z.input<typeof RecordJobLogInputSchema>;

export async function recordJobLog(db: AppDb, rawInput: RecordJobLogInput): Promise<JobLogRecord> {
  const input = RecordJobLogInputSchema.parse(rawInput);
  const [created] = await db
    .insert(jobsLog)
    .values({
      id: input.id,
      workflowId: input.workflowId,
      projectId: input.projectId ?? null,
      step: input.step,
      provider: input.provider,
      model: input.model,
      status: input.status,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      costEstimateUsd: input.costEstimateUsd,
      latencyMs: input.latencyMs ?? null,
      error: input.error ?? null,
      createdAt: input.now ?? new Date(),
    })
    .returning();

  if (!created) {
    throw new Error("Failed to insert jobs_log record");
  }

  return created;
}

export async function listJobLogsByWorkflow(
  db: AppDb,
  workflowId: string
): Promise<JobLogRecord[]> {
  return db
    .select()
    .from(jobsLog)
    .where(eq(jobsLog.workflowId, workflowId))
    .orderBy(desc(jobsLog.createdAt));
}

export async function sumWorkflowCostUsd(db: AppDb, workflowId: string): Promise<number> {
  const rows = await db
    .select({
      total: sql<number>\`coalesce(sum(\${jobsLog.costEstimateUsd}), 0)\`,
    })
    .from(jobsLog)
    .where(eq(jobsLog.workflowId, workflowId));

  return Number(rows[0]?.total ?? 0);
}
`
  );

  step.logStep("3. Writing configurable AI model catalog, pricing, error types, and callLLM()");

  step.writeFileEnsureDir(
    "src/config/ai-models.ts",
    `/**
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
`
  );

  step.writeFileEnsureDir(
    "src/lib/ai/errors.ts",
    `export type LLMErrorCode =
  | "VALIDATION_ERROR"
  | "CONFIG_ERROR"
  | "AUTH_ERROR"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "BAD_RESPONSE"
  | "SPEND_CAP_EXCEEDED";

export interface LLMErrorOptions {
  code: LLMErrorCode;
  message: string;
  retryable: boolean;
  statusCode?: number;
  retryAfterMs?: number;
  cause?: unknown;
}

export class LLMError extends Error {
  public readonly code: LLMErrorCode;
  public readonly retryable: boolean;
  public readonly statusCode?: number;
  public readonly retryAfterMs?: number;

  constructor(options: LLMErrorOptions) {
    super(sanitizeErrorMessage(options.message), { cause: options.cause });
    this.name = "LLMError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/**
 * Removes credential-like tokens before errors are logged to D1 or surfaced in diagnostics.
 */
export function sanitizeErrorMessage(raw: string): string {
  const redacted = raw
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[REDACTED_ANTHROPIC_KEY]")
    .replace(/Bearer\\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/x-api-key\\s*[:=]\\s*[^\\s,;]+/gi, "x-api-key: [REDACTED]");

  return redacted.length > 1000 ? \`\${redacted.slice(0, 997)}...\` : redacted;
}
`
  );

  step.writeFileEnsureDir(
    "src/lib/ai/call-llm.ts",
    `import { z } from "zod";
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
      headers["cf-aig-authorization"] = \`Bearer \${gatewayToken}\`;
    }

    return {
      url: \`https://gateway.ai.cloudflare.com/v1/\${encodeURIComponent(accountId)}/\${encodeURIComponent(gatewayId)}/anthropic/v1/messages\`,
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

function classifyHttpError(status: number, bodyText: string, retryAfterHeader: string | null): LLMError {
  if (status === 401 || status === 403) {
    return new LLMError({
      code: "AUTH_ERROR",
      message: \`Provider authentication failed (HTTP \${status}): \${bodyText}\`,
      retryable: false,
      statusCode: status,
    });
  }

  if (status === 429) {
    return new LLMError({
      code: "RATE_LIMITED",
      message: \`Provider rate limit hit (HTTP 429): \${bodyText}\`,
      retryable: true,
      statusCode: status,
      retryAfterMs: parseRetryAfterMs(retryAfterHeader),
    });
  }

  if (status >= 500 || status === 408) {
    return new LLMError({
      code: "PROVIDER_UNAVAILABLE",
      message: \`Provider transient failure (HTTP \${status}): \${bodyText}\`,
      retryable: true,
      statusCode: status,
    });
  }

  return new LLMError({
    code: "BAD_RESPONSE",
    message: \`Provider rejected request (HTTP \${status}): \${bodyText}\`,
    retryable: false,
    statusCode: status,
  });
}

function defaultId(): string {
  return \`job_\${crypto.randomUUID()}\`;
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
      message: \`Invalid callLLM input: \${parsed.error.issues.map((i) => i.message).join("; ")}\`,
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
        message: \`Workflow \${input.workflowId} reached spend cap ($\${spentSoFar.toFixed(4)} >= $\${input.spendCapUsd.toFixed(4)})\`,
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
          ? \`LLM request timed out after \${input.timeoutMs}ms\`
          : \`Network error contacting AI Gateway: \${err instanceof Error ? err.message : String(err)}\`,
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
        message: \`Unexpected provider response schema: \${validated.error.issues.map((i) => i.path.join(".")).join(", ")}\`,
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
`
  );

  step.logStep("4. Updating .dev.vars.example with AI Gateway variables");
  step.writeFileEnsureDir(
    ".dev.vars.example",
    [
      "# Copy to .dev.vars for local Workers development. Never commit .dev.vars.",
      "# Set staging/prod secrets via: wrangler secret put <NAME> --env <staging|prod>",
      "",
      "# Cloudflare AI Gateway (required in staging/prod)",
      "CLOUDFLARE_ACCOUNT_ID=",
      "CLOUDFLARE_AI_GATEWAY_ID=",
      "CLOUDFLARE_AI_GATEWAY_TOKEN=",
      "",
      "# Anthropic API key (sent via x-api-key unless using AI Gateway BYOK / Unified Billing)",
      "ANTHROPIC_API_KEY=",
      "",
      "# Optional local-only escape hatch if AI Gateway is not configured yet (dev only)",
      "# ALLOW_DIRECT_ANTHROPIC=true",
      "",
      "# Optional model ID overrides (never hard-coded in callers)",
      "# LLM_MODEL_DRAFT=claude-sonnet-4-5",
      "# LLM_MODEL_VERIFY=claude-sonnet-4-5",
      "# LLM_MODEL_EXTRACT=claude-haiku-4-5",
      "# LLM_MODEL_CLASSIFY=claude-haiku-4-5",
      "",
      "# Observability (Step 0.4)",
      "SENTRY_DSN=",
      "",
    ].join("\n")
  );

  step.logStep("5. Writing comprehensive Vitest suite for AI Gateway, pricing, spend caps, and error handling");
  step.writeFileEnsureDir(
    "tests/llm.test.ts",
    `import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estimateCostUsd, resolveModelForTask } from "@/config/ai-models";
import { createDb, type AppDb } from "@/db/client";
import { listJobLogsByWorkflow, recordJobLog } from "@/db/queries/jobs-log";
import { callLLM, resolveAnthropicEndpoint, type AIGatewayEnv } from "@/lib/ai/call-llm";
import { LLMError, sanitizeErrorMessage } from "@/lib/ai/errors";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

const GATEWAY_ENV: AIGatewayEnv = {
  CLOUDFLARE_ACCOUNT_ID: "acct_123",
  CLOUDFLARE_AI_GATEWAY_ID: "collate-gw",
  CLOUDFLARE_AI_GATEWAY_TOKEN: "cf_token_xyz",
  ANTHROPIC_API_KEY: "sk-ant-test-key-000",
  APP_ENV: "staging",
};

describe("AI model config and pricing", () => {
  it("maps tasks to configured models and supports runtime env overrides", () => {
    expect(resolveModelForTask("draft")).toBe("claude-sonnet-4-5");
    expect(resolveModelForTask("verify")).toBe("claude-sonnet-4-5");
    expect(resolveModelForTask("extract")).toBe("claude-haiku-4-5");
    expect(resolveModelForTask("classify")).toBe("claude-haiku-4-5");

    expect(resolveModelForTask("draft", { LLM_MODEL_DRAFT: "claude-opus-4-1" })).toBe(
      "claude-opus-4-1"
    );
  });

  it("calculates token costs including cache read and write tokens", () => {
    const cost = estimateCostUsd("claude-sonnet-4-5", {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 500_000,
      cacheWriteTokens: 200_000,
    });
    // 3.00 + 1.50 + 0.15 + 0.75 = 5.40
    expect(cost).toBeCloseTo(5.4, 6);
  });

  it("redacts API keys and bearer tokens from error messages", () => {
    const clean = sanitizeErrorMessage(
      "Auth failed for sk-ant-api03-secretValue123 and Bearer eyJhbGciOi.token.sig"
    );
    expect(clean).not.toContain("sk-ant-api03");
    expect(clean).not.toContain("eyJhbGciOi");
    expect(clean).toContain("[REDACTED_ANTHROPIC_KEY]");
    expect(clean).toContain("Bearer [REDACTED_TOKEN]");
  });
});

describe("resolveAnthropicEndpoint", () => {
  it("builds Cloudflare AI Gateway Anthropic endpoint with required headers", () => {
    const resolved = resolveAnthropicEndpoint(GATEWAY_ENV, {
      workflowId: "wf_1",
      step: "draft_sec_1",
      task: "draft",
    });

    expect(resolved.endpointUsed).toBe("cloudflare-ai-gateway");
    expect(resolved.url).toBe(
      "https://gateway.ai.cloudflare.com/v1/acct_123/collate-gw/anthropic/v1/messages"
    );
    expect(resolved.headers["x-api-key"]).toBe("sk-ant-test-key-000");
    expect(resolved.headers["cf-aig-authorization"]).toBe("Bearer cf_token_xyz");
    expect(resolved.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("blocks direct Anthropic calls in staging/prod even if ALLOW_DIRECT_ANTHROPIC=true", () => {
    expect(() =>
      resolveAnthropicEndpoint(
        {
          ANTHROPIC_API_KEY: "sk-ant-test",
          ALLOW_DIRECT_ANTHROPIC: "true",
          APP_ENV: "prod",
        },
        { workflowId: "wf_1" }
      )
    ).toThrow(LLMError);
  });
});

describe("callLLM integration with D1 jobs_log", () => {
  let ctx: InMemoryD1Context;
  let db: AppDb;

  beforeEach(() => {
    ctx = createInMemoryD1();
    ctx.applyMigrations();
    db = createDb(ctx.d1);
  });

  afterEach(() => {
    ctx.close();
  });

  it("routes through AI Gateway, returns text, and logs tokens + cost to jobs_log", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const mockFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Response.json({
        id: "msg_123",
        model: "claude-haiku-4-5",
        stop_reason: "end_turn",
        content: [
          { type: "text", text: "Verified " },
          { type: "text", text: "summary." },
        ],
        usage: {
          input_tokens: 2000,
          output_tokens: 500,
        },
      });
    };

    let clock = 1000;
    const result = await callLLM(
      {
        workflowId: "wf_research_1",
        step: "extract_claims",
        task: "extract",
        system: "Extract factual claims only.",
        messages: [{ role: "user", content: "Passage text here." }],
      },
      {
        db,
        env: GATEWAY_ENV,
        fetchFn: mockFetch,
        nowFn: () => {
          clock += 250;
          return clock;
        },
        idGenerator: () => "job_fixed_001",
      }
    );

    expect(capturedUrl).toBe(
      "https://gateway.ai.cloudflare.com/v1/acct_123/collate-gw/anthropic/v1/messages"
    );
    expect(capturedInit?.method).toBe("POST");
    expect(result.text).toBe("Verified summary.");
    expect(result.model).toBe("claude-haiku-4-5");
    expect(result.endpointUsed).toBe("cloudflare-ai-gateway");
    expect(result.latencyMs).toBe(250);
    // haiku-4-5: (2000/1e6)*1.0 + (500/1e6)*5.0 = 0.002 + 0.0025 = 0.0045
    expect(result.costEstimateUsd).toBeCloseTo(0.0045, 6);

    const logs = await listJobLogsByWorkflow(db, "wf_research_1");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      id: "job_fixed_001",
      workflowId: "wf_research_1",
      step: "extract_claims",
      model: "claude-haiku-4-5",
      status: "succeeded",
      tokensIn: 2000,
      tokensOut: 500,
      latencyMs: 250,
      error: null,
    });
    expect(logs[0]?.costEstimateUsd).toBeCloseTo(0.0045, 6);
  });

  it("rejects invalid input before making any HTTP call", async () => {
    let called = false;
    const mockFetch: typeof fetch = async () => {
      called = true;
      return Response.json({});
    };

    await expect(
      callLLM(
        {
          workflowId: "",
          step: "draft",
          task: "draft",
          messages: [],
        },
        { db, env: GATEWAY_ENV, fetchFn: mockFetch }
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", retryable: false });

    expect(called).toBe(false);
  });

  it("enforces workflow spend cap before calling the provider", async () => {
    await recordJobLog(db, {
      id: "job_prior_spend",
      workflowId: "wf_capped",
      step: "previous_step",
      model: "claude-sonnet-4-5",
      status: "succeeded",
      tokensIn: 100_000,
      tokensOut: 50_000,
      costEstimateUsd: 2.5,
    });

    let called = false;
    const mockFetch: typeof fetch = async () => {
      called = true;
      return Response.json({});
    };

    await expect(
      callLLM(
        {
          workflowId: "wf_capped",
          step: "next_step",
          task: "draft",
          spendCapUsd: 2.0,
          messages: [{ role: "user", content: "Write more." }],
        },
        { db, env: GATEWAY_ENV, fetchFn: mockFetch }
      )
    ).rejects.toMatchObject({ code: "SPEND_CAP_EXCEEDED", retryable: false });

    expect(called).toBe(false);
    const logs = await listJobLogsByWorkflow(db, "wf_capped");
    expect(logs).toHaveLength(2);
    expect(logs.some((l) => l.status === "failed" && l.error?.includes("spend cap"))).toBe(true);
  });

  it("classifies HTTP 429 as retryable with Retry-After and logs failure", async () => {
    const mockFetch: typeof fetch = async () =>
      new Response("Too many requests", {
        status: 429,
        headers: { "retry-after": "5" },
      });

    await expect(
      callLLM(
        {
          workflowId: "wf_rate_limit",
          step: "verify_claim",
          task: "verify",
          messages: [{ role: "user", content: "Check claim." }],
        },
        { db, env: GATEWAY_ENV, fetchFn: mockFetch }
      )
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
      statusCode: 429,
      retryAfterMs: 5000,
    });

    const logs = await listJobLogsByWorkflow(db, "wf_rate_limit");
    expect(logs).toHaveLength(1);
    expect(logs[0]?.status).toBe("failed");
  });

  it("classifies HTTP 401 as non-retryable and redacts leaked secrets from jobs_log", async () => {
    const mockFetch: typeof fetch = async () =>
      new Response("Invalid key sk-ant-api03-LEAKEDSECRET999", { status: 401 });

    await expect(
      callLLM(
        {
          workflowId: "wf_auth_err",
          step: "classify_chapter",
          task: "classify",
          messages: [{ role: "user", content: "Chapter 1: Introduction" }],
        },
        { db, env: GATEWAY_ENV, fetchFn: mockFetch }
      )
    ).rejects.toMatchObject({
      code: "AUTH_ERROR",
      retryable: false,
      statusCode: 401,
    });

    const logs = await listJobLogsByWorkflow(db, "wf_auth_err");
    expect(logs).toHaveLength(1);
    expect(logs[0]?.error).not.toContain("LEAKEDSECRET999");
    expect(logs[0]?.error).toContain("[REDACTED_ANTHROPIC_KEY]");
  });

  it("classifies request timeout as retryable TIMEOUT", async () => {
    const mockFetch: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const abortErr = new Error("The operation was aborted");
          abortErr.name = "AbortError";
          reject(abortErr);
        });
      });

    await expect(
      callLLM(
        {
          workflowId: "wf_timeout",
          step: "draft_slow",
          task: "draft",
          timeoutMs: 25,
          messages: [{ role: "user", content: "Draft section." }],
        },
        { db, env: GATEWAY_ENV, fetchFn: mockFetch }
      )
    ).rejects.toMatchObject({
      code: "TIMEOUT",
      retryable: true,
    });
  });

  it("rejects malformed provider JSON cleanly", async () => {
    const mockFetch: typeof fetch = async () => Response.json({ unexpected: true });

    await expect(
      callLLM(
        {
          workflowId: "wf_bad_json",
          step: "extract_bad",
          task: "extract",
          messages: [{ role: "user", content: "Extract this." }],
        },
        { db, env: GATEWAY_ENV, fetchFn: mockFetch }
      )
    ).rejects.toMatchObject({
      code: "BAD_RESPONSE",
      retryable: false,
    });
  });
});
`
  );

  step.logStep("6. Formatting and running full verification gate (Step 0.1 + 0.2 + 0.3)");
  await step.run("pnpm", ["run", "format"]);
  await step.run("pnpm", ["run", "verify"]);

  step.logStep("7. Updating PROGRESS.md after verified pass");
  const progressPath = path.join(ROOT, "PROGRESS.md");
  if (fs.existsSync(progressPath)) {
    let content = fs.readFileSync(progressPath, "utf8");
    content = content.replace(
      "- [ ] Step 0.3: AI Gateway configured + `callLLM()` helper logging tokens and cost to `jobs_log`",
      "- [x] Step 0.3: AI Gateway configured + `callLLM()` helper logging tokens and cost to `jobs_log` (verified with Vitest + D1 integration tests)"
    );
    fs.writeFileSync(progressPath, content, "utf8");
    step.log("  ✓ Updated PROGRESS.md");
  }

  await step.gitCommit(
    "Add AI Gateway client with configurable models, spend caps, and token cost logging"
  );

  step.log("");
  step.log("========================================");
  step.log("✓ Step 0.3 PASSED all verification gates and committed!");
  step.log("========================================");
}

step.execute(main);
