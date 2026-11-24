import { z } from "zod";
import type { AiTask, TokenUsage } from "@/config/ai-models";
import { LLMError } from "../errors";
import {
  isCloudflareAiGatewayEnabled,
  requireCloudflareGatewayCoords,
  type CloudflareGatewayEnv,
} from "../gateway";

export type GoogleEndpointUsed =
  "google-vertex-express" | "google-ai-studio" | "cloudflare-ai-gateway";

export type GeminiApiBackend = "vertex-express" | "ai-studio";

export interface GoogleProviderEnv extends CloudflareGatewayEnv {
  GEMINI_API_KEY?: string;
  GEMINI_API_BACKEND?: string;
  GEMINI_API_VERSION?: string;
  GOOGLE_CLOUD_PROJECT?: string;
  GOOGLE_CLOUD_LOCATION?: string;
}

export interface GoogleResolvedEndpoint {
  url: string;
  headers: Record<string, string>;
  endpointUsed: GoogleEndpointUsed;
}

export interface GoogleMessageInput {
  role: "user" | "assistant";
  content: string;
}

export interface GoogleRequestInput {
  model?: string;
  task?: AiTask;
  system?: string;
  messages: GoogleMessageInput[];
  maxTokens: number;
  temperature: number;
}

export interface GoogleParsedResponse {
  text: string;
  model: string;
  stopReason: string | null;
  usage: Required<TokenUsage>;
}

const GooglePartSchema = z.object({
  text: z.string().optional(),
  thought: z.boolean().optional(),
});

const GoogleCandidateSchema = z.object({
  content: z
    .object({
      role: z.string().optional(),
      parts: z.array(GooglePartSchema).optional(),
    })
    .optional(),
  finishReason: z.string().nullable().optional(),
});

const GoogleGenerateContentResponseSchema = z.object({
  candidates: z.array(GoogleCandidateSchema).optional(),
  promptFeedback: z
    .object({
      blockReason: z.string().optional(),
    })
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().int().nonnegative().optional(),
      candidatesTokenCount: z.number().int().nonnegative().optional(),
      thoughtsTokenCount: z.number().int().nonnegative().optional(),
      cachedContentTokenCount: z.number().int().nonnegative().optional(),
      totalTokenCount: z.number().int().nonnegative().optional(),
    })
    .optional(),
  modelVersion: z.string().optional(),
});

const NON_RETRYABLE_FINISH_REASONS = new Set([
  "SAFETY",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
  "RECITATION",
]);

export function resolveGeminiBackend(rawBackend?: string): GeminiApiBackend {
  const normalized = rawBackend?.trim().toLowerCase();
  if (
    !normalized ||
    normalized === "vertex-express" ||
    normalized === "vertex" ||
    normalized === "gemini-platform"
  ) {
    return "vertex-express";
  }
  if (
    normalized === "ai-studio" ||
    normalized === "developer" ||
    normalized === "google-ai-studio"
  ) {
    return "ai-studio";
  }
  throw new LLMError({
    code: "CONFIG_ERROR",
    message: `Unsupported GEMINI_API_BACKEND "${rawBackend}". Use "vertex-express" (Google Cloud Gemini Platform) or "ai-studio".`,
    retryable: false,
  });
}

function resolveVertexApiVersion(model: string, override?: string): string {
  const trimmed = override?.trim();
  if (trimmed) return trimmed;
  return /(?:preview|exp)/i.test(model) ? "v1beta1" : "v1";
}

export function resolveGoogleEndpoint(
  model: string,
  env: GoogleProviderEnv,
  metadata: Record<string, string>
): GoogleResolvedEndpoint {
  const backend = resolveGeminiBackend(env.GEMINI_API_BACKEND);
  const apiKey = env.GEMINI_API_KEY?.trim();

  if (backend === "vertex-express") {
    if (!apiKey) {
      throw new LLMError({
        code: "CONFIG_ERROR",
        message:
          "GEMINI_API_KEY is required for Google Gemini models (set your Google Cloud Gemini Platform API key).",
        retryable: false,
      });
    }

    const apiVersion = resolveVertexApiVersion(model, env.GEMINI_API_VERSION);
    const project = env.GOOGLE_CLOUD_PROJECT?.trim();

    if (project) {
      const location = env.GOOGLE_CLOUD_LOCATION?.trim() || "global";
      // Cloudflare AI Gateway supports regional Vertex AI routes (not locations/global).
      if (isCloudflareAiGatewayEnabled(env) && location !== "global") {
        const { accountId, gatewayId, gatewayToken } = requireCloudflareGatewayCoords(env);
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "cf-aig-metadata": JSON.stringify(metadata),
          "x-goog-api-key": apiKey,
        };
        if (gatewayToken) {
          headers["cf-aig-authorization"] = `Bearer ${gatewayToken}`;
        }
        return {
          url: `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}/google-vertex-ai/${encodeURIComponent(apiVersion)}/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`,
          headers,
          endpointUsed: "cloudflare-ai-gateway",
        };
      }

      const host =
        location === "global"
          ? "aiplatform.googleapis.com"
          : `${encodeURIComponent(location)}-aiplatform.googleapis.com`;
      return {
        url: `https://${host}/${encodeURIComponent(apiVersion)}/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`,
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey,
        },
        endpointUsed: "google-vertex-express",
      };
    }

    if (/^gemini-4(?:$|-)/i.test(model)) {
      throw new LLMError({
        code: "CONFIG_ERROR",
        message: `Model "${model}" is served on Vertex AI's global endpoint and requires GOOGLE_CLOUD_PROJECT (your GCP project ID or number) alongside GEMINI_API_KEY.`,
        retryable: false,
      });
    }

    return {
      url: `https://aiplatform.googleapis.com/${encodeURIComponent(apiVersion)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`,
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      endpointUsed: "google-vertex-express",
    };
  }

  // ai-studio backend: routes through Cloudflare AI Gateway ONLY when USE_CLOUDFLARE_AI_GATEWAY=true
  const apiVersion = env.GEMINI_API_VERSION?.trim() || "v1beta";
  if (isCloudflareAiGatewayEnabled(env)) {
    const { accountId, gatewayId, gatewayToken } = requireCloudflareGatewayCoords(env);
    if (!apiKey && !gatewayToken) {
      throw new LLMError({
        code: "CONFIG_ERROR",
        message:
          "Google AI Studio via Cloudflare AI Gateway requires GEMINI_API_KEY or CLOUDFLARE_AI_GATEWAY_TOKEN.",
        retryable: false,
      });
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "cf-aig-metadata": JSON.stringify(metadata),
    };
    if (apiKey) {
      headers["x-goog-api-key"] = apiKey;
    }
    if (gatewayToken) {
      headers["cf-aig-authorization"] = `Bearer ${gatewayToken}`;
    }

    return {
      url: `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}/google-ai-studio/${encodeURIComponent(apiVersion)}/models/${encodeURIComponent(model)}:generateContent`,
      headers,
      endpointUsed: "cloudflare-ai-gateway",
    };
  }

  if (!apiKey) {
    throw new LLMError({
      code: "CONFIG_ERROR",
      message: "GEMINI_API_KEY is required for Google Gemini models.",
      retryable: false,
    });
  }

  return {
    url: `https://generativelanguage.googleapis.com/${encodeURIComponent(apiVersion)}/models/${encodeURIComponent(model)}:generateContent`,
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    endpointUsed: "google-ai-studio",
  };
}

function isGoogleThinkingModel(model?: string): boolean {
  if (!model) return false;
  return /^gemini-(?:3|4)(?:$|[.-])/i.test(model.trim());
}

function isGemini4Model(model?: string): boolean {
  if (!model) return false;
  return /^gemini-4(?:$|-)/i.test(model.trim());
}

function resolveGemini4ThinkingLevel(model: string, task?: AiTask): "MEDIUM" | "HIGH" {
  // gemini-4-hydrogen completes HIGH thinking reliably (~26-39s), ideal for strict
  // claim verification, classification, and extraction.
  if (
    /^gemini-4-hydrogen(?:$|-)/i.test(model.trim()) &&
    (task === "verify" || task === "classify" || task === "extract")
  ) {
    return "HIGH";
  }
  // For heavy flagship Gemini 4 models (e.g. gemini-4-neon, where HIGH can exceed 90s),
  // MEDIUM delivers ~3,500+ thinking tokens reliably across drafting, classification, and extraction.
  return "MEDIUM";
}

export const GOOGLE_THINKING_TOKEN_HEADROOM = 8192;

export function buildGoogleRequestBody(input: GoogleRequestInput): Record<string, unknown> {
  // Gemini 3.x and 4.x thinking models count internal thoughtsTokenCount inside maxOutputTokens.
  // Add 8,192 tokens of thinking headroom so deep reasoning never starves visible academic prose.
  const effectiveMaxOutputTokens = isGoogleThinkingModel(input.model)
    ? Math.min(24576, input.maxTokens + GOOGLE_THINKING_TOKEN_HEADROOM)
    : input.maxTokens;

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: effectiveMaxOutputTokens,
    temperature: input.temperature,
  };

  if (isGemini4Model(input.model) && input.model) {
    generationConfig.thinkingConfig = {
      thinkingLevel: resolveGemini4ThinkingLevel(input.model, input.task),
    };
  }

  const body: Record<string, unknown> = {
    contents: input.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig,
  };

  if (input.system) {
    body.systemInstruction = {
      parts: [{ text: input.system }],
    };
  }

  return body;
}

export function parseGoogleResponse(
  rawJson: unknown,
  requestedModel: string
): GoogleParsedResponse {
  const validated = GoogleGenerateContentResponseSchema.safeParse(rawJson);
  if (!validated.success) {
    throw new LLMError({
      code: "BAD_RESPONSE",
      message: `Unexpected Google Gemini response schema: ${validated.error.issues.map((i) => i.path.join(".")).join(", ")}`,
      retryable: false,
      cause: validated.error,
    });
  }

  const data = validated.data;
  const blockReason = data.promptFeedback?.blockReason;
  const firstCandidate = data.candidates?.[0];

  if (!firstCandidate) {
    throw new LLMError({
      code: "BAD_RESPONSE",
      message: blockReason
        ? `Google Gemini blocked the prompt (${blockReason})`
        : "Google Gemini returned no response candidates",
      retryable: !blockReason,
    });
  }

  const parts = firstCandidate.content?.parts ?? [];
  const text = parts
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("");

  const finishReason = firstCandidate.finishReason ?? null;

  if (!text.trim()) {
    const blockedFinish = finishReason !== null && NON_RETRYABLE_FINISH_REASONS.has(finishReason);
    const thoughtsCount = data.usageMetadata?.thoughtsTokenCount ?? 0;
    const reasonDetail = [
      finishReason ? `finishReason=${finishReason}` : null,
      thoughtsCount > 0 ? `thoughtsTokenCount=${thoughtsCount}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    throw new LLMError({
      code: "BAD_RESPONSE",
      message: blockedFinish
        ? `Google Gemini stopped without text output (${finishReason})`
        : reasonDetail
          ? `Google Gemini returned no text content parts (${reasonDetail})`
          : "Google Gemini returned no text content parts",
      retryable: !blockedFinish,
    });
  }

  const promptTokens = data.usageMetadata?.promptTokenCount ?? 0;
  const cacheReadTokens = Math.min(promptTokens, data.usageMetadata?.cachedContentTokenCount ?? 0);
  const inputTokens = Math.max(0, promptTokens - cacheReadTokens);
  // Google bills reasoning/thinking tokens at the output token rate.
  const outputTokens =
    (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0);

  const normalizedModel = (data.modelVersion?.trim() || requestedModel).replace(/^models\//i, "");

  return {
    text,
    model: normalizedModel,
    stopReason: finishReason,
    usage: {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens: 0,
    },
  };
}
