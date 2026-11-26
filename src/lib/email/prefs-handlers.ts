import { z } from "zod";
import { isAllowedOrigin, jsonNoStore, readSessionTokenFromRequest } from "@/lib/auth/cookies";
import type { HttpAuthDeps } from "@/lib/auth/http-handlers";
import { getSessionFromToken } from "@/lib/auth/service";
import {
  getUserNotificationPrefs,
  recordMarketingPromptChoice,
  updateUserNotificationPrefs,
} from "./notifications";

const PrefsBodySchema = z.object({
  emailChapterReady: z.boolean(),
  emailNeedsAttention: z.boolean(),
  emailProjectComplete: z.boolean(),
  emailReceipts: z.boolean(),
  emailMarketing: z.boolean().optional().default(false),
});

const MarketingPromptSchema = z.object({
  optIn: z.boolean(),
});

export async function handleGetNotificationPrefs(
  request: Request,
  deps: HttpAuthDeps
): Promise<Response> {
  const isProd = deps.appEnv === "prod";
  const session = await getSessionFromToken(
    deps.db,
    readSessionTokenFromRequest(request, isProd),
    deps.nowFn
  );
  if (!session) {
    return jsonNoStore({ ok: false, error: "Authentication required." }, 401);
  }

  const preferences = await getUserNotificationPrefs(deps.db, session.user.id);
  return jsonNoStore({ ok: true, preferences }, 200);
}

export async function handleUpdateNotificationPrefs(
  request: Request,
  deps: HttpAuthDeps
): Promise<Response> {
  if (!isAllowedOrigin(request, deps.appUrl)) {
    return jsonNoStore({ ok: false, error: "Forbidden cross-origin request." }, 403);
  }

  const isProd = deps.appEnv === "prod";
  const session = await getSessionFromToken(
    deps.db,
    readSessionTokenFromRequest(request, isProd),
    deps.nowFn
  );
  if (!session) {
    return jsonNoStore({ ok: false, error: "Authentication required." }, 401);
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
  }

  const parsed = PrefsBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonNoStore({ ok: false, error: "Invalid notification preferences payload." }, 400);
  }

  const now = (deps.nowFn ?? (() => new Date()))();
  const preferences = await updateUserNotificationPrefs(deps.db, session.user.id, parsed.data, now);
  return jsonNoStore({ ok: true, preferences }, 200);
}

export async function handleRespondMarketingPrompt(
  request: Request,
  deps: HttpAuthDeps
): Promise<Response> {
  if (!isAllowedOrigin(request, deps.appUrl)) {
    return jsonNoStore({ ok: false, error: "Forbidden cross-origin request." }, 403);
  }

  const isProd = deps.appEnv === "prod";
  const session = await getSessionFromToken(
    deps.db,
    readSessionTokenFromRequest(request, isProd),
    deps.nowFn
  );
  if (!session) {
    return jsonNoStore({ ok: false, error: "Authentication required." }, 401);
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
  }

  const parsed = MarketingPromptSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonNoStore({ ok: false, error: "Provide optIn (boolean)." }, 400);
  }

  const now = (deps.nowFn ?? (() => new Date()))();
  const result = await recordMarketingPromptChoice(
    deps.db,
    session.user.id,
    parsed.data.optIn,
    now
  );
  return jsonNoStore({ ok: true, emailMarketing: result.emailMarketing }, 200);
}
