import { z } from "zod";
import type { AiTask, TokenUsage } from "@/config/ai-models";
import { LLMError } from "../errors";
import {
  isCloudflareAiGatewayEnabled,
  requireCloudflareGatewayCoords,
  type CloudflareGatewayEnv,
} from "../gateway";

export type DeepSeekEndpointUsed = "deepseek-direct" | "cloudflare-ai-gateway";

export interface DeepSeekProviderEnv extends CloudflareGatewayEnv {
  DEEPSEEK_API_KEY?: string;
}

export interface DeepSeekResolvedEndpoint {
  url: string;
  headers: Record<string, string>;
  endpointUsed: DeepSeekEndpointUsed;
}

export interface DeepSeekMessageInput {
  role: "user" | "assistant";
  content: string;
}

export interface DeepSeekRequestInput {
  task?: AiTask;
  system?: string;
  messages: DeepSeekMessageInput[];
  maxTokens: number;
  temperature: number;
}

export interface DeepSeekParsedResponse {
  text: string;
  model: string;
  stopReason: string | null;
  usage: Required<TokenUsage>;
}

const DeepSeekResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z.array(
    z.object({
      finish_reason: z.string().nullable().optional(),
      message: z.object({
        role: z.string().optional(),
        content: z.string().nullable().optional(),
        reasoning_content: z.string().nullable().optional(),
      }),
    })
  ),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
      prompt_cache_hit_tokens: z.number().int().nonnegative().optional(),
      prompt_cache_miss_tokens: z.number().int().nonnegative().optional(),
      prompt_tokens_details: z
        .object({
          cached_tokens: z.number().int().nonnegative().optional(),
        })
        .optional(),
      completion_tokens_details: z
        .object({
          reasoning_tokens: z.number().int().nonnegative().optional(),
        })
        .optional(),
    })
    .optional(),
});

const DEEPSEEK_REASONING_MODEL_PATTERN = /(?:reasoner|flash|v4|chat|(?:-|_)r1(?:$|-))/i;

export const DEEPSEEK_THINKING_TOKEN_HEADROOM = 8192;

export function isDeepSeekReasoningModel(model: string): boolean {
  return DEEPSEEK_REASONING_MODEL_PATTERN.test(model.trim());
}

export function resolveDeepSeekEndpoint(
  env: DeepSeekProviderEnv,
  metadata: Record<string, string>
): DeepSeekResolvedEndpoint {
  const apiKey = env.DEEPSEEK_API_KEY?.trim();

  if (isCloudflareAiGatewayEnabled(env)) {
    const { accountId, gatewayId, gatewayToken } = requireCloudflareGatewayCoords(env);
    if (!apiKey && !gatewayToken) {
      throw new LLMError({
        code: "CONFIG_ERROR",
        message:
          "DeepSeek via Cloudflare AI Gateway requires DEEPSEEK_API_KEY or CLOUDFLARE_AI_GATEWAY_TOKEN.",
        retryable: false,
      });
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "cf-aig-metadata": JSON.stringify(metadata),
    };
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }
    if (gatewayToken) {
      headers["cf-aig-authorization"] = `Bearer ${gatewayToken}`;
    }

    return {
      url: `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}/deepseek/chat/completions`,
      headers,
      endpointUsed: "cloudflare-ai-gateway",
    };
  }

  if (!apiKey) {
    throw new LLMError({
      code: "CONFIG_ERROR",
      message: "DEEPSEEK_API_KEY is required for DeepSeek models.",
      retryable: false,
    });
  }

  return {
    url: "https://api.deepseek.com/chat/completions",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    endpointUsed: "deepseek-direct",
  };
}

export function buildDeepSeekRequestBody(
  model: string,
  input: DeepSeekRequestInput
): Record<string, unknown> {
  const messages: Array<{ role: string; content: string }> = [];

  if (input.system) {
    messages.push({ role: "system", content: input.system });
  }

  for (const message of input.messages) {
    messages.push({ role: message.role, content: message.content });
  }

  const reasoningEnabled = isDeepSeekReasoningModel(model);
  // DeepSeek counts internal reasoning_content tokens inside max_tokens.
  // Keep HIGH reasoning effort with +8,192 headroom so deep reasoning never starves output.
  const effectiveMaxTokens = reasoningEnabled
    ? Math.min(65536, input.maxTokens + DEEPSEEK_THINKING_TOKEN_HEADROOM)
    : input.maxTokens;

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: effectiveMaxTokens,
  };

  if (reasoningEnabled) {
    body.thinking = { type: "enabled" };
    body.reasoning_effort = "high";
  } else {
    body.temperature = input.temperature;
  }

  return body;
}

export function parseDeepSeekResponse(
  rawJson: unknown,
  requestedModel: string
): DeepSeekParsedResponse {
  const validated = DeepSeekResponseSchema.safeParse(rawJson);
  if (!validated.success) {
    throw new LLMError({
      code: "BAD_RESPONSE",
      message: `Unexpected DeepSeek response schema: ${validated.error.issues.map((i) => i.path.join(".")).join(", ")}`,
      retryable: false,
      cause: validated.error,
    });
  }

  const data = validated.data;
  const firstChoice = data.choices[0];
  if (!firstChoice) {
    throw new LLMError({
      code: "BAD_RESPONSE",
      message: "DeepSeek returned no response choices",
      retryable: true,
    });
  }

  // Strictly return final content only (never leak reasoning_content into prose or JSON outputs).
  const text = firstChoice.message.content ?? "";
  const finishReason = firstChoice.finish_reason ?? null;

  if (!text.trim()) {
    const blocked = finishReason === "content_filter";
    const reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    const reasonDetail = [
      finishReason ? `finishReason=${finishReason}` : null,
      reasoningTokens > 0 ? `reasoningTokens=${reasoningTokens}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    throw new LLMError({
      code: "BAD_RESPONSE",
      message: blocked
        ? "DeepSeek filtered the response (content_filter)"
        : reasonDetail
          ? `DeepSeek returned no text content (${reasonDetail})`
          : "DeepSeek returned no text content",
      retryable: !blocked,
    });
  }

  const promptTokens = data.usage?.prompt_tokens ?? 0;
  const cacheReadTokens = Math.min(
    promptTokens,
    data.usage?.prompt_cache_hit_tokens ?? data.usage?.prompt_tokens_details?.cached_tokens ?? 0
  );
  const inputTokens =
    data.usage?.prompt_cache_miss_tokens !== undefined
      ? data.usage.prompt_cache_miss_tokens
      : Math.max(0, promptTokens - cacheReadTokens);
  const outputTokens = data.usage?.completion_tokens ?? 0;

  return {
    text,
    model: data.model?.trim() || requestedModel,
    stopReason: finishReason,
    usage: {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens: 0,
    },
  };
}
