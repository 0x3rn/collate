import { and, eq, sql } from "drizzle-orm";
import { evidenceFromRequest, TERMS_VERSION } from "@/lib/billing/evidence";
import { accounts, auditLog, sessions, users } from "@/db/schema";
import { buildSignupAlert } from "@/lib/notify/admin-alerts";
import { logEvent } from "@/lib/observability/logger";
import { buildSessionCookieHeader, extractClientIp, parseCookieHeader } from "./cookies";
import { type HttpAuthDeps, readRequestGeo } from "./http-handlers";
import { consumeAuthRateLimit } from "./rate-limit";
import { SESSION_TTL_MS } from "./service";
import { generateSecureToken, hashTokenSha256, sanitizeRedirectPath } from "./tokens";

/**
 * "Sign in with Google" / "Sign up with Google" (OAuth 2.0 authorization code flow with PKCE).
 *
 * No bot check is needed here: Google itself authenticates the person. A random state value and
 * PKCE verifier are kept in a short-lived, HttpOnly cookie scoped to the callback, so a callback
 * that did not start in this browser is refused. Only Google-verified email addresses are
 * accepted; an existing Collate account with the same address is linked to Google.
 */

export interface GoogleAuthConfig {
  clientId?: string;
  clientSecret?: string;
}

export interface GoogleAuthDeps extends HttpAuthDeps {
  google: GoogleAuthConfig;
}

const FLOW_COOKIE = "collate_google_flow";
const FLOW_COOKIE_PATH = "/api/auth/google";
const FLOW_TTL_SECONDS = 600;

export function isGoogleAuthConfigured(config: GoogleAuthConfig): boolean {
  return Boolean(config.clientId?.trim() && config.clientSecret?.trim());
}

function redirectUri(appUrl: string): string {
  let base = appUrl.trim();
  while (base.endsWith("/")) base = base.slice(0, -1);
  return `${base}/api/auth/google/callback`;
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let binary = "";
  for (const b of new Uint8Array(digest)) binary += String.fromCharCode(b);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function flowCookie(value: string, maxAge: number, isProd: boolean): string {
  return [
    `${FLOW_COOKIE}=${value}`,
    `Path=${FLOW_COOKIE_PATH}`,
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(isProd ? ["Secure"] : []),
  ].join("; ");
}

function redirectTo(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}

function toBase64Url(text: string): string {
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string {
  const b64 = value.replaceAll("-", "+").replaceAll("_", "/");
  return atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
}

function signInError(isProd: boolean): Response {
  return redirectTo("/sign-in?google=error", [flowCookie("", 0, isProd)]);
}

/** GET /api/auth/google/start?next=/dashboard */
export async function handleGoogleStart(request: Request, deps: GoogleAuthDeps): Promise<Response> {
  const isProd = deps.appEnv === "prod";
  if (!isGoogleAuthConfigured(deps.google)) {
    return redirectTo("/sign-in?google=unavailable");
  }
  const url = new URL(request.url);
  const next = sanitizeRedirectPath(url.searchParams.get("next"), "/dashboard");
  // Set by the sign-up page's tick box. Without it Google can sign in existing accounts only.
  const termsAccepted = url.searchParams.get("terms") === "accepted";
  const state = generateSecureToken(24);
  const verifier = generateSecureToken(48);

  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", deps.google.clientId!.trim());
  auth.searchParams.set("redirect_uri", redirectUri(deps.appUrl));
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "openid email profile");
  auth.searchParams.set("state", state);
  auth.searchParams.set("code_challenge", await pkceChallenge(verifier));
  auth.searchParams.set("code_challenge_method", "S256");
  auth.searchParams.set("prompt", "select_account");

  const payload = toBase64Url(JSON.stringify({ state, verifier, next, termsAccepted }));
  return redirectTo(auth.toString(), [flowCookie(payload, FLOW_TTL_SECONDS, isProd)]);
}

interface GoogleProfile {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
}

/** GET /api/auth/google/callback?code=...&state=... */
export async function handleGoogleCallback(
  request: Request,
  deps: GoogleAuthDeps
): Promise<Response> {
  const isProd = deps.appEnv === "prod";
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const now = (deps.nowFn ?? (() => new Date()))();
  if (!isGoogleAuthConfigured(deps.google)) return signInError(isProd);

  const rl = await consumeAuthRateLimit(
    deps.db,
    "googleSignIn",
    extractClientIp(request),
    now.getTime()
  );
  if (!rl.allowed) return redirectTo("/sign-in?google=rate_limited", [flowCookie("", 0, isProd)]);

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const rawFlow = parseCookieHeader(request.headers.get("cookie")).get(FLOW_COOKIE);
  let flow: { state?: string; verifier?: string; next?: string; termsAccepted?: boolean } = {};
  try {
    flow = rawFlow ? (JSON.parse(fromBase64Url(rawFlow)) as typeof flow) : {};
  } catch {
    flow = {};
  }
  if (!code || !state || !flow.state || !flow.verifier || state !== flow.state) {
    return signInError(isProd);
  }

  let profile: GoogleProfile;
  try {
    const tokenRes = await fetchFn("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: deps.google.clientId!.trim(),
        client_secret: deps.google.clientSecret!.trim(),
        redirect_uri: redirectUri(deps.appUrl),
        grant_type: "authorization_code",
        code_verifier: flow.verifier,
      }),
    });
    if (!tokenRes.ok) throw new Error(`token HTTP ${tokenRes.status}`);
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) throw new Error("no access token");
    const infoRes = await fetchFn("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!infoRes.ok) throw new Error(`userinfo HTTP ${infoRes.status}`);
    profile = (await infoRes.json()) as GoogleProfile;
  } catch (err) {
    logEvent("warn", "google_signin_exchange_failed", {
      data: { reason: err instanceof Error ? err.message : String(err) },
    });
    return signInError(isProd);
  }

  const email = profile.email?.trim().toLowerCase();
  if (!profile.sub || !email || profile.email_verified !== true) {
    return redirectTo("/sign-in?google=unverified", [flowCookie("", 0, isProd)]);
  }

  // Find or create the user, linking Google to an existing account with the same address.
  let userId: string;
  let created = false;
  const [linked] = await deps.db
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(and(eq(accounts.providerId, "google"), eq(accounts.accountId, profile.sub)))
    .limit(1);
  if (linked) {
    userId = linked.userId;
  } else {
    const [existing] = await deps.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      userId = existing.id;
      if (!existing.emailVerified) {
        // The address was never proven, so whoever set that password may not own it (someone
        // could pre-register a victim's email). Google has now proven ownership: drop the
        // unproven password and any sessions before linking.
        await deps.db
          .delete(accounts)
          .where(and(eq(accounts.userId, existing.id), eq(accounts.providerId, "credential")));
        await deps.db.delete(sessions).where(eq(sessions.userId, existing.id));
        await deps.db
          .update(users)
          .set({ emailVerified: true, updatedAt: now })
          .where(eq(users.id, existing.id));
      }
    } else {
      // A new account needs the Terms agreement from the sign-up page's tick box.
      if (flow.termsAccepted !== true) {
        return redirectTo("/sign-up?google=terms", [flowCookie("", 0, isProd)]);
      }
      userId = `usr_${crypto.randomUUID()}`;
      created = true;
      await deps.db.insert(users).values({
        id: userId,
        email,
        emailVerified: true,
        name: (profile.name?.trim() || email.split("@")[0]!).slice(0, 100),
        creditsBalance: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    await deps.db.insert(accounts).values({
      id: `acc_${crypto.randomUUID()}`,
      userId,
      accountId: profile.sub,
      providerId: "google",
      createdAt: now,
      updatedAt: now,
    });
  }

  const rawSessionToken = generateSecureToken(32);
  const geo = readRequestGeo(request);
  await deps.db.insert(sessions).values({
    id: `ses_${crypto.randomUUID()}`,
    userId,
    token: await hashTokenSha256(rawSessionToken),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    ipAddress: extractClientIp(request),
    userAgent: request.headers.get("user-agent")?.slice(0, 300) ?? null,
    city: geo.city?.slice(0, 80) ?? null,
    country: geo.country?.slice(0, 2) ?? null,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await deps.db.insert(auditLog).values({
    id: `aud_${crypto.randomUUID()}`,
    actorUserId: userId,
    action: created ? "auth.signup_google" : "auth.signin_google",
    entityType: "user",
    entityId: userId,
    metadataJson: JSON.stringify({
      ...evidenceFromRequest(request),
      ...(created ? { termsVersion: TERMS_VERSION, termsAccepted: true } : {}),
    }),
    createdAt: now,
  });

  if (created && deps.adminNotifier) {
    const [countRow] = await deps.db.select({ total: sql<number>`count(*)` }).from(users);
    await deps.adminNotifier.send(
      buildSignupAlert({
        name: profile.name?.trim() || email,
        email,
        totalUsers: Number(countRow?.total ?? 0),
      }).replace("Email not verified yet.", "Signed up with Google.")
    );
  }

  return redirectTo(sanitizeRedirectPath(flow.next, "/dashboard"), [
    buildSessionCookieHeader(rawSessionToken, Math.floor(SESSION_TTL_MS / 1000), isProd),
    flowCookie("", 0, isProd),
  ]);
}
