export const BASE_SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
  ["Cross-Origin-Opener-Policy", "same-origin"],
  [
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://www.googletagmanager.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https://upload.wikimedia.org https://thumb.wikimedia.org https://www.google-analytics.com https://www.googletagmanager.com",
      "connect-src 'self' https://challenges.cloudflare.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com",
      "frame-src https://challenges.cloudflare.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  ],
];

const HSTS_VALUE = "max-age=63072000; includeSubDomains; preload";

/**
 * Strips untrusted internal Next.js middleware bypass headers (CVE-2025-29927 defense in depth).
 */
export function sanitizeIncomingRequest(request: Request): Request {
  if (!request.headers.has("x-middleware-subrequest")) {
    return request;
  }
  const headers = new Headers(request.headers);
  headers.delete("x-middleware-subrequest");
  return new Request(request, { headers });
}

/**
 * Attaches baseline security headers to every outgoing Worker response.
 */
export function applySecurityHeaders(response: Response, isProd: boolean): Response {
  const headers = new Headers(response.headers);
  headers.delete("x-powered-by");

  for (const [key, value] of BASE_SECURITY_HEADERS) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  if (isProd && !headers.has("Strict-Transport-Security")) {
    headers.set("Strict-Transport-Security", HSTS_VALUE);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
