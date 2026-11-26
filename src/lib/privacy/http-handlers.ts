import { eq } from "drizzle-orm";
import { z } from "zod";
import { auditLog, users } from "@/db/schema";
import { isAllowedOrigin, jsonNoStore, readSessionTokenFromRequest } from "@/lib/auth/cookies";
import type { HttpAuthDeps } from "@/lib/auth/http-handlers";
import { getSessionFromToken } from "@/lib/auth/service";
import {
  ANALYTICS_CONSENT_CHOICES,
  resolveSignedInConsent,
  SIGNED_IN_CONSENT_TTL_MS,
} from "./cookie-consent";

const UpdateCookieConsentSchema = z.object({
  choice: z.enum(ANALYTICS_CONSENT_CHOICES),
});

/**
 * GET /api/account/cookie-consent
 * Returns whether the caller is signed in and their current consent state.
 * Signed-in acceptances persist permanently on the account; signed-in declines older
 * than 7 days are actively discarded in D1 so the user is asked again.
 */
export async function handleGetCookieConsent(
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
    return jsonNoStore({ ok: true, signedIn: false, status: "prompt", expiresAt: null }, 200);
  }

  const now = (deps.nowFn ?? (() => new Date()))();
  const [row] = await deps.db
    .select({
      analyticsConsent: users.analyticsConsent,
      analyticsConsentAt: users.analyticsConsentAt,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const evaluated = resolveSignedInConsent(
    {
      choice: row?.analyticsConsent ?? null,
      recordedAt: row?.analyticsConsentAt ?? null,
    },
    now
  );

  if (evaluated.expired) {
    await deps.db
      .update(users)
      .set({
        analyticsConsent: null,
        analyticsConsentAt: null,
        updatedAt: now,
      })
      .where(eq(users.id, session.user.id));
  }

  return jsonNoStore(
    {
      ok: true,
      signedIn: true,
      status: evaluated.status,
      expiresAt: evaluated.expiresAt ? evaluated.expiresAt.toISOString() : null,
    },
    200
  );
}

/**
 * POST /api/account/cookie-consent
 * Records a signed-in user's cookie preference choice (permanent when accepted, 7 days when declined).
 */
export async function handleSaveCookieConsent(
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

  const parsed = UpdateCookieConsentSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonNoStore({ ok: false, error: "Choose either accepted or declined." }, 400);
  }

  const now = (deps.nowFn ?? (() => new Date()))();
  const expiresAt =
    parsed.data.choice === "declined" ? new Date(now.getTime() + SIGNED_IN_CONSENT_TTL_MS) : null;

  await deps.db
    .update(users)
    .set({
      analyticsConsent: parsed.data.choice,
      analyticsConsentAt: now,
      updatedAt: now,
    })
    .where(eq(users.id, session.user.id));

  await deps.db.insert(auditLog).values({
    id: `aud_${crypto.randomUUID()}`,
    actorUserId: session.user.id,
    action: "privacy.cookie_consent_updated",
    entityType: "user",
    entityId: session.user.id,
    metadataJson: JSON.stringify({
      choice: parsed.data.choice,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    }),
    createdAt: now,
  });

  return jsonNoStore(
    {
      ok: true,
      choice: parsed.data.choice,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    },
    200
  );
}
