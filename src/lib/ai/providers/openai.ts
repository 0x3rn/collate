import { z } from "zod";
import type { TokenUsage } from "@/config/ai-models";
import { LLMError } from "../errors";
import {
  isCloudflareAiGatewayEnabled,
  requireCloudflareGatewayCoords,
  type CloudflareGatewayEnv,
} from "../gateway";

export type OpenAIEndpointUsed = "openai-direct" | "cloudflare-ai-gateway";

export interface OpenAIProviderEnv extends CloudflareGatewayEnv {
  OPENAI_API_KEY?: string;
}

export interface OpenAIResolvedEndpoint {
  url: string;
  headers: Record<string, string>;
  endpointUsed: OpenAIEndpointUsed;
}

export interface OpenAIMessageInput {
  role: "user" | "assistant";
  content: string;
}

export interface OpenAIRequestInput {
  system?: string;
  messages: OpenAIMessageInput[];
  maxTokens: number;
  temperature: number;
}

export interface OpenAIParsedResponse {
  text: string;
  model: string;
  stopReason: string | null;
  usage: Required<TokenUsage>;
}

const OpenAIContentPartSchema = z.object({
  type: z.string().optional(),
  text: z.string().optional(),
});

const OpenAIResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z.array(
    z.object({
      finish_reason: z.string().nullable().optional(),
      message: z.object({
        role: z.string().optional(),
        content: z
          .union([z.string(), z.array(OpenAIContentPartSchema)])
          .nullable()
          .optional(),
        refusal: z.string().nullable().optional(),
      }),
    })
  ),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
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

const OPENAI_REASONING_MODEL_PATTERN = /^(?:o[134](?:$|[-.])|gpt-[5-9](?:$|[-.]))/i;

export function isOpenAIReasoningModel(model: string): boolean {
  return OPENAI_REASONING_MODEL_PATTERN.test(model.trim());
}

export function resolveOpenAIEndpoint(
  env: OpenAIProviderEnv,
  metadata: Record<string, string>
): OpenAIResolvedEndpoint {
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (isCloudflareAiGatewayEnabled(env)) {
    const { accountId, gatewayId, gatewayToken } = requireCloudflareGatewayCoords(env);
    if (!apiKey && !gatewayToken) {
      throw new LLMError({
        code: "CONFIG_ERROR",
        message:
          "OpenAI via Cloudflare AI Gateway requires OPENAI_API_KEY or CLOUDFLARE_AI_GATEWAY_TOKEN.",
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
      url: `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}/openai/chat/completions`,
      headers,
      endpointUsed: "cloudflare-ai-gateway",
    };
  }

  if (!apiKey) {
    throw new LLMError({
      code: "CONFIG_ERROR",
      message: "OPENAI_API_KEY is required for OpenAI models.",
      retryable: false,
    });
  }

  return {
    url: "https://api.openai.com/v1/chat/completions",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    endpointUsed: "openai-direct",
  };
}

export function buildOpenAIRequestBody(
  model: string,
  input: OpenAIRequestInput
): Record<string, unknown> {
  const reasoning = isOpenAIReasoningModel(model);
  const messages: Array<{ role: string; content: string }> = [];

  if (input.system) {
    messages.push({
      role: reasoning ? "developer" : "system",
      content: input.system,
    });
  }

  for (const message of input.messages) {
    messages.push({
      role: message.role,
      content: message.content,
    });
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    max_completion_tokens: input.maxTokens,
  };

  // OpenAI reasoning models (o1/o3/o4-mini/gpt-5*) reject non-default temperature values.
  if (!reasoning) {
    body.temperature = input.temperature;
  }

  return body;
}

export function parseOpenAIResponse(
  rawJson: unknown,
  requestedModel: string
): OpenAIParsedResponse {
  const validated = OpenAIResponseSchema.safeParse(rawJson);
  if (!validated.success) {
    throw new LLMError({
      code: "BAD_RESPONSE",
      message: `Unexpected OpenAI response schema: ${validated.error.issues.map((i) => i.path.join(".")).join(", ")}`,
      retryable: false,
      cause: validated.error,
    });
  }

  const data = validated.data;
  const firstChoice = data.choices[0];
  if (!firstChoice) {
    throw new LLMError({
      code: "BAD_RESPONSE",
      message: "OpenAI returned no response choices",
      retryable: true,
    });
  }

  const rawContent = firstChoice.message.content;
  const text =
    typeof rawContent === "string"
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent
            .filter((part) => typeof part.text === "string")
            .map((part) => part.text ?? "")
            .join("")
        : "";

  const refusal = firstChoice.message.refusal?.trim();
  const finishReason = firstChoice.finish_reason ?? null;

  if (!text.trim()) {
    if (refusal) {
      throw new LLMError({
        code: "BAD_RESPONSE",
        message: `OpenAI refused request: ${refusal}`,
        retryable: false,
      });
    }
    const blocked = finishReason === "content_filter";
    throw new LLMError({
      code: "BAD_RESPONSE",
      message: blocked
        ? "OpenAI filtered the response (content_filter)"
        : "OpenAI returned no text content",
      retryable: !blocked,
    });
  }

  const promptTokens = data.usage?.prompt_tokens ?? 0;
  const cacheReadTokens = Math.min(
    promptTokens,
    data.usage?.prompt_tokens_details?.cached_tokens ?? 0
  );
  const inputTokens = Math.max(0, promptTokens - cacheReadTokens);
  // OpenAI's completion_tokens already includes reasoning_tokens.
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
