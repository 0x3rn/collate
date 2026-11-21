import { z } from "zod";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const TurnstileResponseSchema = z.object({
  success: z.boolean(),
  "error-codes": z.array(z.string()).optional(),
});

export interface VerifyTurnstileInput {
  token: string | undefined;
  remoteIp?: string;
  secretKey?: string;
  appEnv?: string;
  fetchFn?: typeof fetch;
}

export interface VerifyTurnstileResult {
  passed: boolean;
  skipped?: boolean;
  reason?: string;
}

/**
 * Verifies Cloudflare Turnstile tokens server-side.
 * If TURNSTILE_SECRET_KEY is configured, verification is strictly enforced in all environments.
 * If unset, local 'dev' bypasses cleanly while 'prod' warns and enforces once configured.
 */
export async function verifyTurnstileToken(
  input: VerifyTurnstileInput
): Promise<VerifyTurnstileResult> {
  const secret = input.secretKey?.trim();
  if (!secret) {
    if ((input.appEnv ?? "dev") === "dev") {
      return { passed: true, skipped: true };
    }
    return {
      passed: false,
      reason: "Bot verification is not configured for this environment.",
    };
  }

  const token = input.token?.trim();
  if (!token) {
    return { passed: false, reason: "Please complete the verification check and try again." };
  }

  const form = new URLSearchParams({
    secret,
    response: token,
  });
  if (input.remoteIp) {
    form.set("remoteip", input.remoteIp);
  }

  const fetchFn = input.fetchFn ?? globalThis.fetch;
  try {
    const response = await fetchFn(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!response.ok) {
      return { passed: false, reason: "Could not verify human check. Please try again." };
    }
    const data = TurnstileResponseSchema.safeParse(await response.json());
    if (!data.success || !data.data.success) {
      return { passed: false, reason: "Verification check expired or failed. Please try again." };
    }
    return { passed: true };
  } catch {
    return { passed: false, reason: "Could not reach verification service. Please try again." };
  }
}
