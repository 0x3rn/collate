import { LLMError } from "./errors";

export interface CloudflareGatewayEnv {
  USE_CLOUDFLARE_AI_GATEWAY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_GATEWAY_ID?: string;
  CLOUDFLARE_AI_GATEWAY_TOKEN?: string;
}

/**
 * Explicit master switch for routing provider requests through Cloudflare AI Gateway.
 * Always defaults to false so storing gateway tokens/IDs in secrets never activates it silently.
 */
export function isCloudflareAiGatewayEnabled(env: CloudflareGatewayEnv): boolean {
  return env.USE_CLOUDFLARE_AI_GATEWAY?.trim().toLowerCase() === "true";
}

export function requireCloudflareGatewayCoords(env: CloudflareGatewayEnv): {
  accountId: string;
  gatewayId: string;
  gatewayToken?: string;
} {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const gatewayId = env.CLOUDFLARE_AI_GATEWAY_ID?.trim();
  const gatewayToken = env.CLOUDFLARE_AI_GATEWAY_TOKEN?.trim() || undefined;

  if (!accountId || !gatewayId) {
    throw new LLMError({
      code: "CONFIG_ERROR",
      message:
        "USE_CLOUDFLARE_AI_GATEWAY=true requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_GATEWAY_ID.",
      retryable: false,
    });
  }

  return { accountId, gatewayId, gatewayToken };
}
