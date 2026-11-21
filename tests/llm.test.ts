import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
