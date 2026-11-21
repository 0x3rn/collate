function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i] ?? 0);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function generateSecureToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/**
 * Hashes raw bearer/session/reset tokens before storing them in D1
 * so a read-only database compromise cannot hijack active sessions or tokens.
 */
export async function hashTokenSha256(rawToken: string): Promise<string> {
  const encoded = new TextEncoder().encode(rawToken);
  const copy = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  copy.set(encoded);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Prevents open redirects by allowing only safe relative same-origin paths.
 */
export function sanitizeRedirectPath(
  raw: string | null | undefined,
  fallback = "/dashboard"
): string {
  const candidate = raw?.trim();
  if (!candidate) return fallback;
  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//")) return fallback;
  if (candidate.includes("\\") || /[\r\n]/.test(candidate)) return fallback;

  try {
    const parsed = new URL(candidate, "https://collate.local");
    if (parsed.origin !== "https://collate.local") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
