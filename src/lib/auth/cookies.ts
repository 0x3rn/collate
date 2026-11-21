export const PROD_SESSION_COOKIE = "__Host-collate_session";
export const DEV_SESSION_COOKIE = "collate_session";

export function getSessionCookieName(isProd: boolean): string {
  return isProd ? PROD_SESSION_COOKIE : DEV_SESSION_COOKIE;
}

export function buildSessionCookieHeader(
  token: string,
  maxAgeSeconds: number,
  isProd: boolean
): string {
  const name = getSessionCookieName(isProd);
  const parts = [
    `${name}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ];
  if (isProd) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function buildClearSessionCookieHeader(isProd: boolean): string {
  return buildSessionCookieHeader("", 0, isProd);
}

export function parseCookieHeader(header: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!header) return map;

  for (const pair of header.split(";")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = pair.slice(0, eqIdx).trim();
    const rawVal = pair.slice(eqIdx + 1).trim();
    if (!key) continue;
    try {
      map.set(key, decodeURIComponent(rawVal));
    } catch {
      map.set(key, rawVal);
    }
  }
  return map;
}

export function readSessionTokenFromRequest(request: Request, isProd: boolean): string | undefined {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  if (isProd) {
    return cookies.get(PROD_SESSION_COOKIE) || undefined;
  }
  return cookies.get(DEV_SESSION_COOKIE) || cookies.get(PROD_SESSION_COOKIE) || undefined;
}

export function extractClientIp(request: Request): string {
  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return "127.0.0.1";
}

/**
 * Defense-in-depth CSRF check for state-changing POST endpoints alongside SameSite=Lax cookies.
 * Allows requests with no Origin header (same-origin/non-browser) and verifies matching origin when present.
 */
export function isAllowedOrigin(request: Request, configuredAppUrl?: string): boolean {
  const originHeader = request.headers.get("origin")?.trim();
  if (!originHeader) return true;

  const allowedOrigins = new Set<string>();
  try {
    allowedOrigins.add(new URL(request.url).origin);
  } catch {
    // Ignore malformed request URL
  }
  if (configuredAppUrl) {
    try {
      allowedOrigins.add(new URL(configuredAppUrl).origin);
    } catch {
      // Ignore malformed APP_URL
    }
  }

  return allowedOrigins.has(originHeader);
}

export function jsonNoStore(
  body: Record<string, unknown>,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      pragma: "no-cache",
      ...extraHeaders,
    },
  });
}
