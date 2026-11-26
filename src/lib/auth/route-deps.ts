import "server-only";
import { env } from "cloudflare:workers";
import { createDb } from "@/db/client";
import { type CloudflareEmailBinding, createEmailSender } from "@/lib/email/mailer";
import { createTelegramNotifier } from "@/lib/notify/admin-alerts";
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
      EMAIL_REPLY_TO: runtimeEnv.EMAIL_REPLY_TO,
      APP_URL: runtimeEnv.APP_URL,
      binding: (env as unknown as { EMAIL?: CloudflareEmailBinding }).EMAIL ?? null,
    }),
    appUrl: resolveAppUrl(request, runtimeEnv.APP_URL),
    appEnv,
    turnstileSecretKey: runtimeEnv.TURNSTILE_SECRET_KEY,
    adminNotifier: createTelegramNotifier(runtimeEnv),
  };
}

/** Request settings plus the Google sign-in credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). */
export function buildGoogleAuthDeps(request: Request): import("./google").GoogleAuthDeps {
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  return {
    ...buildWorkerAuthDeps(request),
    google: {
      clientId: runtimeEnv.GOOGLE_CLIENT_ID,
      clientSecret: runtimeEnv.GOOGLE_CLIENT_SECRET,
    },
  };
}

/** True when Google sign-in is set up, so pages can show the button. */
export function isGoogleSignInEnabled(): boolean {
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  return Boolean(runtimeEnv.GOOGLE_CLIENT_ID?.trim() && runtimeEnv.GOOGLE_CLIENT_SECRET?.trim());
}
