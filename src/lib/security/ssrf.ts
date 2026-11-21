export interface UrlSafetyResult {
  safe: boolean;
  reason?: string;
  parsed?: URL;
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => (/^[0-9]+$/.test(p) ? Number(p) : -1));
  if (nums.some((n) => n < 0 || n > 255)) return false;

  const [a, b] = nums as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedIpv6(rawHost: string): boolean {
  const host = rawHost.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (!host.includes(":")) return false;
  if (host === "::" || host === "::1") return true;
  if (host.startsWith("fc") || host.startsWith("fd")) return true;
  if (
    host.startsWith("fe8") ||
    host.startsWith("fe9") ||
    host.startsWith("fea") ||
    host.startsWith("feb")
  ) {
    return true;
  }
  if (host.startsWith("::ffff:")) {
    const mapped = host.slice("::ffff:".length);
    if (isPrivateIpv4(mapped)) return true;
  }
  return false;
}

export function checkPublicHttpUrl(rawUrl: string): UrlSafetyResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { safe: false, reason: "Malformed URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { safe: false, reason: `Disallowed URL scheme: ${parsed.protocol}` };
  }

  if (parsed.username || parsed.password) {
    return { safe: false, reason: "URLs with embedded credentials are not allowed" };
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) {
    return { safe: false, reason: "Missing hostname" };
  }

  if (
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    return { safe: false, reason: `Blocked internal hostname: ${host}` };
  }

  if (/^(0x[0-9a-f]+|[0-9]+)$/i.test(host)) {
    return { safe: false, reason: "Numeric or hex IP hostnames are blocked" };
  }

  if (isPrivateIpv4(host) || isBlockedIpv6(host)) {
    return { safe: false, reason: `Blocked private or metadata IP address: ${host}` };
  }

  return { safe: true, parsed };
}

export async function safePublicFetch(
  rawUrl: string,
  options: {
    headers?: Record<string, string>;
    timeoutMs: number;
    maxRedirects?: number;
    fetchFn: typeof fetch;
  }
): Promise<{ response: Response; finalUrl: string }> {
  const maxRedirects = options.maxRedirects ?? 5;
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = checkPublicHttpUrl(currentUrl);
    if (!check.safe) {
      throw new Error(`SSRF blocked URL (${currentUrl}): ${check.reason}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    let response: Response;
    try {
      response = await options.fetchFn(currentUrl, {
        method: "GET",
        headers: options.headers,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return { response, finalUrl: currentUrl };
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return { response, finalUrl: currentUrl };
  }

  throw new Error(`Too many redirects fetching ${rawUrl}`);
}
