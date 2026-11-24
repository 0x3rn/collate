import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estimateCostUsd, parseModelSpec, resolveModelForTask } from "@/config/ai-models";
import { createDb, type AppDb } from "@/db/client";
import { listJobLogsByWorkflow, recordJobLog } from "@/db/queries/jobs-log";
import {
  callLLM,
  hasConfiguredLlmProvider,
  isCloudflareAiGatewayEnabled,
  resolveAnthropicEndpoint,
  resolveDeepSeekEndpoint,
  resolveGoogleEndpoint,
  resolveOpenAIEndpoint,
  type AIGatewayEnv,
} from "@/lib/ai/call-llm";
import { LLMError, sanitizeErrorMessage } from "@/lib/ai/errors";
import { buildDeepSeekRequestBody } from "@/lib/ai/providers/deepseek";
import { buildGoogleRequestBody } from "@/lib/ai/providers/google";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

const GATEWAY_ENV: AIGatewayEnv = {
  USE_CLOUDFLARE_AI_GATEWAY: "true",
  CLOUDFLARE_ACCOUNT_ID: "acct_123",
  CLOUDFLARE_AI_GATEWAY_ID: "collate-gw",
  CLOUDFLARE_AI_GATEWAY_TOKEN: "cf_token_xyz",
  ANTHROPIC_API_KEY: "sk-ant-test-key-000",
  APP_ENV: "staging",
};

const GEMINI_PLATFORM_ENV: AIGatewayEnv = {
  GEMINI_API_KEY: "test-gemini-platform-key-000",
  GEMINI_API_BACKEND: "vertex-express",
  GOOGLE_CLOUD_PROJECT: "545937744162",
  APP_ENV: "prod",
};

const OPENAI_ENV: AIGatewayEnv = {
  OPENAI_API_KEY: "test-openai-key-000",
  APP_ENV: "prod",
};

const DEEPSEEK_ENV: AIGatewayEnv = {
  DEEPSEEK_API_KEY: "test-deepseek-key-000",
  APP_ENV: "prod",
};

describe("AI model config, provider routing, and pricing", () => {
  it("defaults tasks to Google Gemini, supports provider-key fallback, and honors mixed env overrides", () => {
    expect(resolveModelForTask("draft")).toBe("gemini-4-neon");
    expect(resolveModelForTask("verify")).toBe("gemini-4-hydrogen");
    expect(resolveModelForTask("extract")).toBe("gemini-3.5-flash-lite");
    expect(resolveModelForTask("classify")).toBe("gemini-4-hydrogen");

    // Anthropic-only env falls back cleanly to Claude 5.5 defaults
    expect(resolveModelForTask("draft", { ANTHROPIC_API_KEY: "sk-ant-only" })).toBe(
      "claude-sonnet-5-5"
    );
    expect(resolveModelForTask("extract", { ANTHROPIC_API_KEY: "sk-ant-only" })).toBe(
      "claude-haiku-5-5"
    );

    // Explicit per-task overrides allow mixing all 4 providers freely
    const mixedEnv = {
      GEMINI_API_KEY: "test-gemini-key-mixed",
      ANTHROPIC_API_KEY: "test-anthropic-key-mixed",
      LLM_MODEL_DRAFT: "claude-opus-5-5",
      LLM_MODEL_VERIFY: "deepseek-v4-pro",
      LLM_MODEL_EXTRACT: "gpt-6-luna",
      LLM_MODEL_CLASSIFY: "google/gemini-3.5-flash-lite",
    };
    expect(resolveModelForTask("draft", mixedEnv)).toBe("claude-opus-5-5");
    expect(resolveModelForTask("verify", mixedEnv)).toBe("deepseek-v4-pro");
    expect(resolveModelForTask("extract", mixedEnv)).toBe("gpt-6-luna");
    expect(resolveModelForTask("classify", mixedEnv)).toBe("google/gemini-3.5-flash-lite");
  });

  it("parses bare and prefixed model specifications and rejects unsupported models", () => {
    expect(parseModelSpec("gemini-3.8-flash")).toEqual({
      provider: "google",
      model: "gemini-3.8-flash",
    });
    expect(parseModelSpec("google/gemini-3.7-flash")).toEqual({
      provider: "google",
      model: "gemini-3.7-flash",
    });
    expect(parseModelSpec("claude-sonnet-5-5")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
    });
    expect(parseModelSpec("anthropic/claude-haiku-5-5")).toEqual({
      provider: "anthropic",
      model: "claude-haiku-5-5",
    });
    expect(parseModelSpec("gpt-6.1-sol")).toEqual({
      provider: "openai",
      model: "gpt-6.1-sol",
    });
    expect(parseModelSpec("gpt-6-luna")).toEqual({
      provider: "openai",
      model: "gpt-6-luna",
    });
    expect(parseModelSpec("o4-mini")).toEqual({
      provider: "openai",
      model: "o4-mini",
    });
    expect(parseModelSpec("openai/o3")).toEqual({
      provider: "openai",
      model: "o3",
    });
    expect(parseModelSpec("deepseek-flash")).toEqual({
      provider: "deepseek",
      model: "deepseek-flash",
    });
    expect(parseModelSpec("deepseek-v4-pro")).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-pro",
    });
    expect(parseModelSpec("deepseek/deepseek-v4-pro")).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-pro",
    });
    expect(() => parseModelSpec("unknown-model-x")).toThrow(/Cannot infer provider/i);
    expect(() => parseModelSpec("mystery/model-1")).toThrow(/Unsupported model provider/i);
  });

  it("calculates token costs accurately for Google Gemini, OpenAI, DeepSeek, and Anthropic Claude", () => {
    const claudeCost = estimateCostUsd("claude-sonnet-5-5", {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 500_000,
      cacheWriteTokens: 200_000,
    });
    // 2.00 + 1.00 + 0.10 + 0.50 = 3.60
    expect(claudeCost).toBeCloseTo(3.6, 6);

    const geminiFlashCost = estimateCostUsd("google/gemini-3.8-flash", {
      inputTokens: 1_000_000,
      outputTokens: 200_000,
      cacheReadTokens: 400_000,
    });
    // 0.75 + 0.75 + (0.4 * 0.075 = 0.03) = 1.53
    expect(geminiFlashCost).toBeCloseTo(1.53, 6);

    const openAiGpt6Cost = estimateCostUsd("gpt-6.1-sol", {
      inputTokens: 1_000_000,
      outputTokens: 200_000,
      cacheReadTokens: 400_000,
    });
    // 2.00 + 2.00 + (0.4 * 0.20 = 0.08) = 4.08
    expect(openAiGpt6Cost).toBeCloseTo(4.08, 6);

    const openAiSnapshotCost = estimateCostUsd("gpt-5.4-2026-03-05", {
      inputTokens: 500_000,
      outputTokens: 100_000,
    });
    // 1.00 + 1.00 = 2.00
    expect(openAiSnapshotCost).toBeCloseTo(2.0, 6);

    const deepSeekCost = estimateCostUsd("deepseek-v4-pro", {
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 500_000,
    });
    // 0.66 + 0.198 + (0.5 * 0.022 = 0.011) = 0.869
    expect(deepSeekCost).toBeCloseTo(0.869, 6);
  });

  it("redacts Anthropic, OpenAI, DeepSeek, Google (AQ. and AIza), header, query, and bearer secrets from error messages", () => {
    // Assemble synthetic token shapes at runtime so static secret scanners do not flag test fixtures
    const syntheticAnthropic = ["sk-ant", "-api03-", "secretValue123"].join("");
    const syntheticOpenAi = ["sk-proj", "-", "OpenAiSecretValue9876543210"].join("");
    const syntheticDeepSeek = ["sk", "-", "0123456789abcdef".repeat(2)].join("");
    const syntheticGeminiPlatform = ["AQ.", "Ab8RN6SuperSecretGeminiKey12345"].join("");
    const syntheticGoogleStudio = ["AIza", "SyD_FakeGoogleApiKey1234567890"].join("");
    const syntheticBearer = ["Bearer ", "eyJhbGciOi", ".token.sig"].join("");

    const clean = sanitizeErrorMessage(
      `Failed with ${syntheticAnthropic}, ${syntheticOpenAi}, ${syntheticDeepSeek}, ${syntheticGeminiPlatform}, ${syntheticGoogleStudio}, x-goog-api-key: rawSecretKey, ?key=querySecret999 and ${syntheticBearer}`
    );
    expect(clean).not.toContain("secretValue123");
    expect(clean).not.toContain("OpenAiSecretValue");
    expect(clean).not.toContain("0123456789abcdef");
    expect(clean).not.toContain("SuperSecretGeminiKey");
    expect(clean).not.toContain("FakeGoogleApiKey");
    expect(clean).not.toContain("rawSecretKey");
    expect(clean).not.toContain("querySecret999");
    expect(clean).not.toContain("eyJhbGciOi");
    expect(clean).toContain("[REDACTED_ANTHROPIC_KEY]");
    expect(clean).toContain("[REDACTED_API_KEY]");
    expect(clean).toContain("[REDACTED_GOOGLE_KEY]");
    expect(clean).toContain("x-goog-api-key: [REDACTED]");
    expect(clean).toContain("?key=[REDACTED]");
    expect(clean).toContain("Bearer [REDACTED_TOKEN]");
  });

  it("detects configured providers accurately via hasConfiguredLlmProvider", () => {
    expect(hasConfiguredLlmProvider({})).toBe(false);
    expect(hasConfiguredLlmProvider(GEMINI_PLATFORM_ENV)).toBe(true);
    expect(hasConfiguredLlmProvider(OPENAI_ENV)).toBe(true);
    expect(hasConfiguredLlmProvider(DEEPSEEK_ENV)).toBe(true);
    expect(hasConfiguredLlmProvider(GATEWAY_ENV)).toBe(true);
    expect(hasConfiguredLlmProvider({ ANTHROPIC_API_KEY: "sk-ant-direct" })).toBe(true);
    expect(
      hasConfiguredLlmProvider({
        CLOUDFLARE_ACCOUNT_ID: "acct_1",
        CLOUDFLARE_AI_GATEWAY_ID: "gw_1",
      })
    ).toBe(false);
  });
});

describe("Provider endpoint resolution", () => {
  it("builds Google Cloud Gemini Platform (Vertex Express Mode) endpoints with x-goog-api-key and global project routing for Gemini 4", () => {
    const projectlessEnv: AIGatewayEnv = {
      GEMINI_API_KEY: GEMINI_PLATFORM_ENV.GEMINI_API_KEY,
      GEMINI_API_BACKEND: "vertex-express",
    };
    const stable = resolveGoogleEndpoint("gemini-3.8-flash", projectlessEnv, {
      workflowId: "wf_g1",
    });
    expect(stable.endpointUsed).toBe("google-vertex-express");
    expect(stable.url).toBe(
      "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.8-flash:generateContent"
    );
    expect(stable.headers["x-goog-api-key"]).toBe(GEMINI_PLATFORM_ENV.GEMINI_API_KEY);

    const preview = resolveGoogleEndpoint("gemini-3-flash-preview", projectlessEnv, {
      workflowId: "wf_g2",
    });
    expect(preview.url).toBe(
      "https://aiplatform.googleapis.com/v1beta1/publishers/google/models/gemini-3-flash-preview:generateContent"
    );

    const gemini4Global = resolveGoogleEndpoint("gemini-4-neon", GEMINI_PLATFORM_ENV, {
      workflowId: "wf_g4",
    });
    expect(gemini4Global.url).toBe(
      "https://aiplatform.googleapis.com/v1/projects/545937744162/locations/global/publishers/google/models/gemini-4-neon:generateContent"
    );
    expect(gemini4Global.headers["x-goog-api-key"]).toBe(GEMINI_PLATFORM_ENV.GEMINI_API_KEY);

    const regional = resolveGoogleEndpoint(
      "gemini-3.8-flash",
      {
        ...GEMINI_PLATFORM_ENV,
        GOOGLE_CLOUD_LOCATION: "us-central1",
      },
      { workflowId: "wf_g_reg" }
    );
    expect(regional.url).toBe(
      "https://us-central1-aiplatform.googleapis.com/v1/projects/545937744162/locations/us-central1/publishers/google/models/gemini-3.8-flash:generateContent"
    );

    // Gemini 4 models require GOOGLE_CLOUD_PROJECT so requests hit locations/global rather than regional 404
    expect(() =>
      resolveGoogleEndpoint("gemini-4-hydrogen", projectlessEnv, { workflowId: "wf_g4_err" })
    ).toThrow(/GOOGLE_CLOUD_PROJECT/i);
  });

  it("keeps Cloudflare AI Gateway OFF by default even when gateway tokens are stored in secrets, and enables it only when USE_CLOUDFLARE_AI_GATEWAY=true", () => {
    expect(isCloudflareAiGatewayEnabled({})).toBe(false);
    expect(isCloudflareAiGatewayEnabled({ USE_CLOUDFLARE_AI_GATEWAY: "false" })).toBe(false);
    expect(isCloudflareAiGatewayEnabled({ USE_CLOUDFLARE_AI_GATEWAY: "true" })).toBe(true);

    const storedGatewaySecretsOff: AIGatewayEnv = {
      USE_CLOUDFLARE_AI_GATEWAY: "false",
      CLOUDFLARE_ACCOUNT_ID: "acct_123",
      CLOUDFLARE_AI_GATEWAY_ID: "collate-gw",
      CLOUDFLARE_AI_GATEWAY_TOKEN: "cf_tok_stored_unused",
      ANTHROPIC_API_KEY: "sk-ant-test",
      OPENAI_API_KEY: OPENAI_ENV.OPENAI_API_KEY,
      DEEPSEEK_API_KEY: DEEPSEEK_ENV.DEEPSEEK_API_KEY,
      GEMINI_API_KEY: "test-gemini-studio-key-000",
      GEMINI_API_BACKEND: "ai-studio",
    };

    // None of the 4 providers route through Cloudflare AI Gateway while switch is false/unset
    expect(resolveAnthropicEndpoint(storedGatewaySecretsOff, {}).endpointUsed).toBe(
      "anthropic-direct"
    );
    expect(resolveOpenAIEndpoint(storedGatewaySecretsOff, {}).endpointUsed).toBe("openai-direct");
    expect(resolveDeepSeekEndpoint(storedGatewaySecretsOff, {}).endpointUsed).toBe(
      "deepseek-direct"
    );
    expect(
      resolveGoogleEndpoint("gemini-3.8-flash", storedGatewaySecretsOff, {}).endpointUsed
    ).toBe("google-ai-studio");

    // Flipping USE_CLOUDFLARE_AI_GATEWAY=true routes them through Cloudflare AI Gateway
    const switchedOn: AIGatewayEnv = {
      ...storedGatewaySecretsOff,
      USE_CLOUDFLARE_AI_GATEWAY: "true",
    };
    expect(resolveAnthropicEndpoint(switchedOn, {}).endpointUsed).toBe("cloudflare-ai-gateway");
    expect(resolveOpenAIEndpoint(switchedOn, {}).endpointUsed).toBe("cloudflare-ai-gateway");
    expect(resolveDeepSeekEndpoint(switchedOn, {}).endpointUsed).toBe("cloudflare-ai-gateway");
    expect(resolveGoogleEndpoint("gemini-3.8-flash", switchedOn, {}).endpointUsed).toBe(
      "cloudflare-ai-gateway"
    );
  });

  it("supports Google AI Studio direct and Cloudflare AI Gateway routing when GEMINI_API_BACKEND=ai-studio", () => {
    const direct = resolveGoogleEndpoint(
      "gemini-3.8-flash",
      {
        GEMINI_API_KEY: "test-gemini-studio-key-000",
        GEMINI_API_BACKEND: "ai-studio",
      },
      { workflowId: "wf_studio" }
    );
    expect(direct.endpointUsed).toBe("google-ai-studio");
    expect(direct.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent"
    );

    const viaGateway = resolveGoogleEndpoint(
      "gemini-3.8-flash",
      {
        USE_CLOUDFLARE_AI_GATEWAY: "true",
        GEMINI_API_KEY: "test-gemini-studio-key-000",
        GEMINI_API_BACKEND: "ai-studio",
        CLOUDFLARE_ACCOUNT_ID: "acct_123",
        CLOUDFLARE_AI_GATEWAY_ID: "collate-gw",
        CLOUDFLARE_AI_GATEWAY_TOKEN: "cf_tok",
      },
      { workflowId: "wf_studio_gw" }
    );
    expect(viaGateway.endpointUsed).toBe("cloudflare-ai-gateway");
    expect(viaGateway.url).toBe(
      "https://gateway.ai.cloudflare.com/v1/acct_123/collate-gw/google-ai-studio/v1beta/models/gemini-3.8-flash:generateContent"
    );
    expect(viaGateway.headers["cf-aig-authorization"]).toBe("Bearer cf_tok");
  });

  it("rejects missing GEMINI_API_KEY or unsupported GEMINI_API_BACKEND with CONFIG_ERROR", () => {
    expect(() => resolveGoogleEndpoint("gemini-2.5-pro", {}, { workflowId: "wf_x" })).toThrow(
      LLMError
    );
    expect(() =>
      resolveGoogleEndpoint(
        "gemini-2.5-pro",
        { GEMINI_API_KEY: "test-gemini-key-bad-backend", GEMINI_API_BACKEND: "bad-backend" },
        { workflowId: "wf_x" }
      )
    ).toThrow(LLMError);
  });

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

  it("routes Anthropic directly when ANTHROPIC_API_KEY is set without a gateway token and rejects missing keys", () => {
    const direct = resolveAnthropicEndpoint(
      {
        ANTHROPIC_API_KEY: "sk-ant-test",
        CLOUDFLARE_ACCOUNT_ID: "acct_123",
        CLOUDFLARE_AI_GATEWAY_ID: "my-gateway",
        APP_ENV: "prod",
      },
      { workflowId: "wf_1" }
    );
    expect(direct.endpointUsed).toBe("anthropic-direct");
    expect(direct.url).toBe("https://api.anthropic.com/v1/messages");
    expect(direct.headers["x-api-key"]).toBe("sk-ant-test");

    expect(() => resolveAnthropicEndpoint({}, { workflowId: "wf_missing" })).toThrow(LLMError);
  });

  it("builds OpenAI direct and Cloudflare AI Gateway endpoints and rejects missing OPENAI_API_KEY", () => {
    const direct = resolveOpenAIEndpoint(OPENAI_ENV, { workflowId: "wf_oai" });
    expect(direct.endpointUsed).toBe("openai-direct");
    expect(direct.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(direct.headers.authorization).toBe(`Bearer ${OPENAI_ENV.OPENAI_API_KEY}`);

    const gateway = resolveOpenAIEndpoint(
      {
        ...OPENAI_ENV,
        USE_CLOUDFLARE_AI_GATEWAY: "true",
        CLOUDFLARE_ACCOUNT_ID: "acct_123",
        CLOUDFLARE_AI_GATEWAY_ID: "collate-gw",
        CLOUDFLARE_AI_GATEWAY_TOKEN: "cf_tok",
      },
      { workflowId: "wf_oai_gw" }
    );
    expect(gateway.endpointUsed).toBe("cloudflare-ai-gateway");
    expect(gateway.url).toBe(
      "https://gateway.ai.cloudflare.com/v1/acct_123/collate-gw/openai/chat/completions"
    );
    expect(gateway.headers["cf-aig-authorization"]).toBe("Bearer cf_tok");

    expect(() => resolveOpenAIEndpoint({}, { workflowId: "wf_oai_missing" })).toThrow(LLMError);
  });

  it("builds DeepSeek direct and Cloudflare AI Gateway endpoints and rejects missing DEEPSEEK_API_KEY", () => {
    const direct = resolveDeepSeekEndpoint(DEEPSEEK_ENV, { workflowId: "wf_ds" });
    expect(direct.endpointUsed).toBe("deepseek-direct");
    expect(direct.url).toBe("https://api.deepseek.com/chat/completions");
    expect(direct.headers.authorization).toBe(`Bearer ${DEEPSEEK_ENV.DEEPSEEK_API_KEY}`);

    const gateway = resolveDeepSeekEndpoint(
      {
        ...DEEPSEEK_ENV,
        USE_CLOUDFLARE_AI_GATEWAY: "true",
        CLOUDFLARE_ACCOUNT_ID: "acct_123",
        CLOUDFLARE_AI_GATEWAY_ID: "collate-gw",
        CLOUDFLARE_AI_GATEWAY_TOKEN: "cf_tok",
      },
      { workflowId: "wf_ds_gw" }
    );
    expect(gateway.endpointUsed).toBe("cloudflare-ai-gateway");
    expect(gateway.url).toBe(
      "https://gateway.ai.cloudflare.com/v1/acct_123/collate-gw/deepseek/chat/completions"
    );
    expect(gateway.headers["cf-aig-authorization"]).toBe("Bearer cf_tok");

    expect(() => resolveDeepSeekEndpoint({}, { workflowId: "wf_ds_missing" })).toThrow(LLMError);
  });
});

describe("callLLM integration with D1 jobs_log (Google Gemini + Anthropic Claude)", () => {
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

  it("calls Google Cloud Gemini Platform, filters thinking parts, counts thoughts in output tokens, and logs provider='google'", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};

    const mockFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;

      return Response.json({
        modelVersion: "gemini-4-neon",
        candidates: [
          {
            finishReason: "STOP",
            content: {
              role: "model",
              parts: [
                { text: "Internal hidden reasoning chain", thought: true },
                { text: "Verified evidence " },
                { text: "draft paragraph." },
              ],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 3000,
          cachedContentTokenCount: 1000,
          candidatesTokenCount: 400,
          thoughtsTokenCount: 100,
          totalTokenCount: 3500,
        },
      });
    };

    let clock = 2000;
    const result = await callLLM(
      {
        workflowId: "wf_gemini_1",
        step: "draft_chapter_1",
        task: "draft",
        system: "Write strictly from stored evidence.",
        messages: [
          { role: "user", content: "Draft section 1.1." },
          { role: "assistant", content: "Previous context." },
          { role: "user", content: "Continue." },
        ],
        maxTokens: 4096,
        temperature: 0.25,
      },
      {
        db,
        env: GEMINI_PLATFORM_ENV,
        fetchFn: mockFetch,
        nowFn: () => {
          clock += 320;
          return clock;
        },
        idGenerator: () => "job_gemini_001",
      }
    );

    expect(capturedUrl).toBe(
      "https://aiplatform.googleapis.com/v1/projects/545937744162/locations/global/publishers/google/models/gemini-4-neon:generateContent"
    );
    expect(capturedHeaders["x-goog-api-key"]).toBe(GEMINI_PLATFORM_ENV.GEMINI_API_KEY);
    expect(capturedBody).toMatchObject({
      systemInstruction: { parts: [{ text: "Write strictly from stored evidence." }] },
      contents: [
        { role: "user", parts: [{ text: "Draft section 1.1." }] },
        { role: "model", parts: [{ text: "Previous context." }] },
        { role: "user", parts: [{ text: "Continue." }] },
      ],
      generationConfig: {
        // Default 4096 + 8192 thinking token headroom for Gemini 4 models; MEDIUM effort for draft
        maxOutputTokens: 12288,
        temperature: 0.25,
        thinkingConfig: { thinkingLevel: "MEDIUM" },
      },
    });

    expect(result.provider).toBe("google");
    expect(result.endpointUsed).toBe("google-vertex-express");
    expect(result.model).toBe("gemini-4-neon");
    expect(result.text).toBe("Verified evidence draft paragraph.");
    expect(result.text).not.toContain("Internal hidden reasoning");
    expect(result.stopReason).toBe("STOP");
    expect(result.usage).toEqual({
      inputTokens: 2000, // 3000 prompt - 1000 cached
      outputTokens: 500, // 400 candidates + 100 thoughts
      cacheReadTokens: 1000,
      cacheWriteTokens: 0,
    });
    // gemini-4-neon: (2000/1e6)*3.0 + (500/1e6)*15.0 + (1000/1e6)*0.15 = 0.006 + 0.0075 + 0.00015 = 0.01365
    expect(result.costEstimateUsd).toBeCloseTo(0.01365, 6);

    const logs = await listJobLogsByWorkflow(db, "wf_gemini_1");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      id: "job_gemini_001",
      provider: "google",
      model: "gemini-4-neon",
      status: "succeeded",
      tokensIn: 2000,
      tokensOut: 500,
      latencyMs: 320,
      error: null,
    });

    // Verify task-aware thinking levels & headroom:
    // - gemini-4-hydrogen verify -> MEDIUM (+8192)
    // - classify / extract / short drafts -> LOW (+4096)
    const verifyBody = buildGoogleRequestBody({
      model: "gemini-4-hydrogen",
      task: "verify",
      messages: [{ role: "user", content: "Check claims." }],
      maxTokens: 1600,
      temperature: 0.1,
    });
    expect(verifyBody.generationConfig).toEqual({
      maxOutputTokens: 1600 + 8192,
      temperature: 0.1,
      thinkingConfig: { thinkingLevel: "MEDIUM" },
    });

    const classifyBody = buildGoogleRequestBody({
      model: "gemini-4-hydrogen",
      task: "classify",
      messages: [{ role: "user", content: "Classify chapter." }],
      maxTokens: 500,
      temperature: 0.1,
    });
    expect(classifyBody.generationConfig).toEqual({
      maxOutputTokens: 500 + 4096,
      temperature: 0.1,
      thinkingConfig: { thinkingLevel: "LOW" },
    });

    const extractBody = buildGoogleRequestBody({
      model: "gemini-4-hydrogen",
      task: "extract",
      messages: [{ role: "user", content: "Extract claims." }],
      maxTokens: 800,
      temperature: 0.1,
    });
    expect(extractBody.generationConfig).toEqual({
      maxOutputTokens: 800 + 4096,
      temperature: 0.1,
      thinkingConfig: { thinkingLevel: "LOW" },
    });

    const shortDraftBody = buildGoogleRequestBody({
      model: "gemini-4-neon",
      task: "draft",
      messages: [{ role: "user", content: "Write concise 250-word section." }],
      maxTokens: 1400,
      temperature: 0.2,
    });
    expect(shortDraftBody.generationConfig).toEqual({
      maxOutputTokens: 1400 + 4096,
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: "LOW" },
    });

    const neonClassifyBody = buildGoogleRequestBody({
      model: "gemini-4-neon",
      task: "classify",
      messages: [{ role: "user", content: "Classify topic." }],
      maxTokens: 500,
      temperature: 0.1,
    });
    expect(neonClassifyBody.generationConfig).toEqual({
      maxOutputTokens: 500 + 4096,
      temperature: 0.1,
      thinkingConfig: { thinkingLevel: "LOW" },
    });
  });

  it("supports mixing Google Gemini and Anthropic Claude across tasks within one workflow", async () => {
    const calledUrls: string[] = [];
    const mixedEnv: AIGatewayEnv = {
      ...GATEWAY_ENV,
      ...GEMINI_PLATFORM_ENV,
      LLM_MODEL_DRAFT: "gemini-2.5-pro",
      LLM_MODEL_VERIFY: "claude-sonnet-4-5",
    };

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      calledUrls.push(url);
      if (url.includes("aiplatform.googleapis.com")) {
        return Response.json({
          modelVersion: "gemini-2.5-pro",
          candidates: [
            { finishReason: "STOP", content: { parts: [{ text: "Draft from Gemini." }] } },
          ],
          usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 },
        });
      }
      return Response.json({
        id: "msg_mix",
        model: "claude-sonnet-4-5",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Verified by Claude." }],
        usage: { input_tokens: 1000, output_tokens: 150 },
      });
    };

    const draftRes = await callLLM(
      {
        workflowId: "wf_mixed",
        step: "draft_sec",
        task: "draft",
        messages: [{ role: "user", content: "Write section." }],
      },
      { db, env: mixedEnv, fetchFn: mockFetch }
    );
    const verifyRes = await callLLM(
      {
        workflowId: "wf_mixed",
        step: "verify_sec",
        task: "verify",
        messages: [{ role: "user", content: "Verify claims." }],
      },
      { db, env: mixedEnv, fetchFn: mockFetch }
    );

    expect(draftRes.provider).toBe("google");
    expect(verifyRes.provider).toBe("anthropic");
    expect(calledUrls[0]).toContain("aiplatform.googleapis.com");
    expect(calledUrls[1]).toContain("gateway.ai.cloudflare.com");

    const logs = await listJobLogsByWorkflow(db, "wf_mixed");
    expect(logs).toHaveLength(2);
    expect(new Set(logs.map((l) => l.provider))).toEqual(new Set(["google", "anthropic"]));
  });

  it("handles Google Gemini safety-blocked prompts and 403 permission failures cleanly with key redaction", async () => {
    const blockedFetch: typeof fetch = async () =>
      Response.json({
        promptFeedback: { blockReason: "SAFETY" },
      });

    await expect(
      callLLM(
        {
          workflowId: "wf_gemini_block",
          step: "draft_blocked",
          task: "draft",
          messages: [{ role: "user", content: "Blocked content." }],
        },
        { db, env: GEMINI_PLATFORM_ENV, fetchFn: blockedFetch }
      )
    ).rejects.toMatchObject({
      code: "BAD_RESPONSE",
      retryable: false,
    });

    const syntheticLeakedGemini = ["AQ.", "Ab8RN6LeakedGeminiKey1234567890"].join("");
    const authFailFetch: typeof fetch = async () =>
      new Response(
        `Permission denied for ${syntheticLeakedGemini} on aiplatform.endpoints.predict`,
        { status: 403 }
      );

    await expect(
      callLLM(
        {
          workflowId: "wf_gemini_403",
          step: "draft_403",
          task: "draft",
          messages: [{ role: "user", content: "Test." }],
        },
        { db, env: GEMINI_PLATFORM_ENV, fetchFn: authFailFetch }
      )
    ).rejects.toMatchObject({
      code: "AUTH_ERROR",
      retryable: false,
      statusCode: 403,
    });

    const logs = await listJobLogsByWorkflow(db, "wf_gemini_403");
    expect(logs).toHaveLength(1);
    expect(logs[0]?.provider).toBe("google");
    expect(logs[0]?.error).not.toContain("LeakedGeminiKey");
    expect(logs[0]?.error).toContain("[REDACTED_GOOGLE_KEY]");
  });

  it("calls OpenAI gpt-5 (developer role, max_completion_tokens, omitted temperature) and gpt-4.1 (temperature preserved) and handles refusals", async () => {
    const capturedBodies: Array<Record<string, unknown>> = [];
    const mockFetch: typeof fetch = async (_input, init) => {
      const parsed = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      capturedBodies.push(parsed);

      if (parsed.model === "gpt-4.1-mini") {
        return Response.json({
          id: "chatcmpl_41",
          model: "gpt-4.1-mini",
          choices: [
            {
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: [{ type: "text", text: "Structured extract." }],
              },
            },
          ],
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 200,
          },
        });
      }

      return Response.json({
        id: "chatcmpl_5",
        model: "gpt-5-2025-08-07",
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: "Evidence-backed draft from GPT-5." },
          },
        ],
        usage: {
          prompt_tokens: 3000,
          completion_tokens: 500,
          prompt_tokens_details: { cached_tokens: 1000 },
          completion_tokens_details: { reasoning_tokens: 150 },
        },
      });
    };

    const gpt5Res = await callLLM(
      {
        workflowId: "wf_openai_1",
        step: "draft_gpt5",
        task: "draft",
        system: "Write strictly from evidence.",
        messages: [{ role: "user", content: "Draft section." }],
        maxTokens: 4096,
        temperature: 0.2,
      },
      {
        db,
        env: { ...OPENAI_ENV, LLM_MODEL_DRAFT: "gpt-5" },
        fetchFn: mockFetch,
      }
    );

    expect(capturedBodies[0]).toMatchObject({
      model: "gpt-5",
      max_completion_tokens: 4096,
      messages: [
        { role: "developer", content: "Write strictly from evidence." },
        { role: "user", content: "Draft section." },
      ],
    });
    expect(capturedBodies[0]?.temperature).toBeUndefined();
    expect(gpt5Res.provider).toBe("openai");
    expect(gpt5Res.endpointUsed).toBe("openai-direct");
    expect(gpt5Res.text).toBe("Evidence-backed draft from GPT-5.");
    expect(gpt5Res.usage).toEqual({
      inputTokens: 2000,
      outputTokens: 500,
      cacheReadTokens: 1000,
      cacheWriteTokens: 0,
    });
    // gpt-5: (2000/1e6)*1.25 + (500/1e6)*10.0 + (1000/1e6)*0.125 = 0.007625
    expect(gpt5Res.costEstimateUsd).toBeCloseTo(0.007625, 6);

    const gpt41Res = await callLLM(
      {
        workflowId: "wf_openai_1",
        step: "extract_41",
        task: "extract",
        system: "Extract JSON.",
        messages: [{ role: "user", content: "Source text." }],
        temperature: 0.15,
      },
      {
        db,
        env: { ...OPENAI_ENV, LLM_MODEL_EXTRACT: "gpt-4.1-mini" },
        fetchFn: mockFetch,
      }
    );

    expect(capturedBodies[1]).toMatchObject({
      model: "gpt-4.1-mini",
      temperature: 0.15,
      messages: [
        { role: "system", content: "Extract JSON." },
        { role: "user", content: "Source text." },
      ],
    });
    expect(gpt41Res.text).toBe("Structured extract.");

    const refusalFetch: typeof fetch = async () =>
      Response.json({
        model: "gpt-5",
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: null, refusal: "Disallowed request." },
          },
        ],
      });

    await expect(
      callLLM(
        {
          workflowId: "wf_openai_refusal",
          step: "draft_refused",
          task: "draft",
          messages: [{ role: "user", content: "Refused." }],
        },
        {
          db,
          env: { ...OPENAI_ENV, LLM_MODEL_DRAFT: "gpt-5" },
          fetchFn: refusalFetch,
        }
      )
    ).rejects.toMatchObject({ code: "BAD_RESPONSE", retryable: false });
  });

  it("calls DeepSeek deepseek-v4-pro (strips reasoning_content, uses cache hit/miss tokens) and supports 4-provider mixing in one workflow", async () => {
    const calledUrls: string[] = [];
    let deepSeekBody: Record<string, unknown> = {};

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      calledUrls.push(url);

      if (url.includes("api.deepseek.com")) {
        deepSeekBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return Response.json({
          id: "ds_1",
          model: "deepseek-v4-pro",
          choices: [
            {
              finish_reason: "stop",
              message: {
                role: "assistant",
                reasoning_content: "Private chain-of-thought that must NEVER leak.",
                content: "Final verified conclusion from DeepSeek.",
              },
            },
          ],
          usage: {
            prompt_tokens: 2000,
            completion_tokens: 400,
            prompt_cache_hit_tokens: 1200,
            prompt_cache_miss_tokens: 800,
          },
        });
      }

      if (url.includes("aiplatform.googleapis.com")) {
        return Response.json({
          modelVersion: "gemini-3.8-flash",
          candidates: [
            { finishReason: "STOP", content: { parts: [{ text: "Draft from Gemini." }] } },
          ],
          usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 100 },
        });
      }

      if (url.includes("api.openai.com")) {
        return Response.json({
          model: "gpt-6-luna",
          choices: [
            {
              finish_reason: "stop",
              message: { role: "assistant", content: "Extracted by OpenAI." },
            },
          ],
          usage: { prompt_tokens: 500, completion_tokens: 100 },
        });
      }

      return Response.json({
        id: "msg_claude",
        model: "claude-haiku-5-5",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Classified by Claude." }],
        usage: { input_tokens: 500, output_tokens: 80 },
      });
    };

    const allFourEnv: AIGatewayEnv = {
      ...GEMINI_PLATFORM_ENV,
      ...OPENAI_ENV,
      ...DEEPSEEK_ENV,
      ...GATEWAY_ENV,
      // Keep gateway switch OFF even though gateway token is stored -> all 4 hit direct endpoints
      USE_CLOUDFLARE_AI_GATEWAY: "false",
      LLM_MODEL_DRAFT: "gemini-4-neon",
      LLM_MODEL_VERIFY: "deepseek-v4-pro",
      LLM_MODEL_EXTRACT: "gpt-6-luna",
      LLM_MODEL_CLASSIFY: "claude-haiku-5-5",
    };

    const draft = await callLLM(
      {
        workflowId: "wf_all_four",
        step: "s1_draft",
        task: "draft",
        messages: [{ role: "user", content: "Draft." }],
      },
      { db, env: allFourEnv, fetchFn: mockFetch }
    );
    const verify = await callLLM(
      {
        workflowId: "wf_all_four",
        step: "s2_verify",
        task: "verify",
        system: "Check claims.",
        messages: [{ role: "user", content: "Verify." }],
        maxTokens: 3000,
        temperature: 0.2,
      },
      { db, env: allFourEnv, fetchFn: mockFetch }
    );
    const extract = await callLLM(
      {
        workflowId: "wf_all_four",
        step: "s3_extract",
        task: "extract",
        messages: [{ role: "user", content: "Extract." }],
      },
      { db, env: allFourEnv, fetchFn: mockFetch }
    );
    const classify = await callLLM(
      {
        workflowId: "wf_all_four",
        step: "s4_classify",
        task: "classify",
        messages: [{ role: "user", content: "Classify." }],
      },
      { db, env: allFourEnv, fetchFn: mockFetch }
    );

    expect(draft.provider).toBe("google");
    expect(verify.provider).toBe("deepseek");
    expect(extract.provider).toBe("openai");
    expect(classify.provider).toBe("anthropic");

    expect(deepSeekBody).toMatchObject({
      model: "deepseek-v4-pro",
      max_tokens: 3000 + 8192,
      thinking: { type: "enabled" },
      reasoning_effort: "high",
    });
    expect(deepSeekBody.temperature).toBeUndefined();

    const deepSeekFlashBody = buildDeepSeekRequestBody("deepseek-flash", {
      task: "extract",
      system: "Extract JSON.",
      messages: [{ role: "user", content: "Extract structured claims." }],
      maxTokens: 1200,
      temperature: 0.1,
    });
    expect(deepSeekFlashBody).toMatchObject({
      model: "deepseek-flash",
      max_tokens: 1200 + 8192,
      thinking: { type: "enabled" },
      reasoning_effort: "high",
    });
    expect(deepSeekFlashBody.temperature).toBeUndefined();
    expect(verify.text).toBe("Final verified conclusion from DeepSeek.");
    expect(verify.text).not.toContain("Private chain-of-thought");
    expect(verify.usage).toEqual({
      inputTokens: 800,
      outputTokens: 400,
      cacheReadTokens: 1200,
      cacheWriteTokens: 0,
    });
    // deepseek-v4-pro: (800/1e6)*0.66 + (400/1e6)*1.98 + (1200/1e6)*0.022 = 0.000528 + 0.000792 + 0.0000264 = 0.0013464 -> 0.001346
    expect(verify.costEstimateUsd).toBeCloseTo(0.001346, 6);

    expect(calledUrls[0]).toContain("aiplatform.googleapis.com");
    expect(calledUrls[1]).toContain("api.deepseek.com");
    expect(calledUrls[2]).toContain("api.openai.com");
    expect(calledUrls[3]).toContain("api.anthropic.com");

    const logs = await listJobLogsByWorkflow(db, "wf_all_four");
    expect(logs).toHaveLength(4);
    expect(new Set(logs.map((l) => l.provider))).toEqual(
      new Set(["google", "deepseek", "openai", "anthropic"])
    );
  });

  it("routes Anthropic through AI Gateway, returns text, and logs tokens + cost to jobs_log", async () => {
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
    expect(result.provider).toBe("anthropic");
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
      provider: "anthropic",
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
        { db, env: GEMINI_PLATFORM_ENV, fetchFn: mockFetch }
      )
    ).rejects.toMatchObject({ code: "SPEND_CAP_EXCEEDED", retryable: false });

    expect(called).toBe(false);
    const logs = await listJobLogsByWorkflow(db, "wf_capped");
    expect(logs).toHaveLength(2);
    expect(
      logs.some(
        (l) => l.status === "failed" && l.provider === "google" && l.error?.includes("spend cap")
      )
    ).toBe(true);
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
    const syntheticLeakedAnthropic = ["sk-ant", "-api03-", "LEAKEDSECRET999"].join("");
    const mockFetch: typeof fetch = async () =>
      new Response(`Invalid key ${syntheticLeakedAnthropic}`, { status: 401 });

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
