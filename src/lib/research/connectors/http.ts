export function buildPoliteUserAgent(contactEmail?: string): string {
  const email = contactEmail?.trim() || "research@collate.local";
  return `CollateResearchBot/1.0 (mailto:${email})`;
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchFn: typeof fetch
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function parseSafeYear(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 1800 && raw <= 2100 ? raw : null;
  }
  if (typeof raw === "string" && raw.trim().length >= 4) {
    const year = Number.parseInt(raw.trim().slice(0, 4), 10);
    return Number.isInteger(year) && year >= 1800 && year <= 2100 ? year : null;
  }
  return null;
}

export function stripMarkupTags(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}
