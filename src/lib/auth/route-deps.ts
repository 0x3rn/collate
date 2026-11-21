import "server-only";
import { env } from "cloudflare:workers";
import { createDb } from "@/db/client";
import { createEmailSender } from "@/lib/email/mailer";
import type { HttpAuthDeps } from "./http-handlers";

function resolveAppUrl(request: Request, configuredUrl?: string): string {
  const trimmed = configuredUrl?.trim();
  if (trimmed) return trimmed;
  try {
    return new URL(request.url).origin;
  } catch {
    return "http://localhost:5173";
  }
}

export function buildWorkerAuthDeps(request: Request): HttpAuthDeps {
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  const appEnv = runtimeEnv.APP_ENV?.trim() || "dev";

  return {
    db: createDb(env.DB),
    mailer: createEmailSender({
      EMAIL_PROVIDER: runtimeEnv.EMAIL_PROVIDER,
      EMAIL_FROM: runtimeEnv.EMAIL_FROM,
      RESEND_API_KEY: runtimeEnv.RESEND_API_KEY,
    }),
    appUrl: resolveAppUrl(request, runtimeEnv.APP_URL),
    appEnv,
    turnstileSecretKey: runtimeEnv.TURNSTILE_SECRET_KEY,
  };
}
