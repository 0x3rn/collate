import type { DeduplicatedSource } from "@/lib/research/types";
import { buildPoliteUserAgent, fetchWithTimeout } from "./http";

export interface UnpaywallOptions {
  email?: string;
  timeoutMs: number;
  fetchFn: typeof fetch;
  maxLookups?: number;
}

export async function enrichSourcesWithUnpaywall(
  sources: DeduplicatedSource[],
  options: UnpaywallOptions
): Promise<{ checked: number; enriched: number }> {
  const email = options.email?.trim() || "research@collate.local";
  const maxLookups = options.maxLookups ?? 20;

  let checked = 0;
  let enriched = 0;

  for (const src of sources) {
    if (checked >= maxLookups) break;
    if (!src.doi || src.openAccessPdfUrl) continue;

    checked++;
    const url = `https://api.unpaywall.org/v2/${encodeURIComponent(src.doi)}?email=${encodeURIComponent(email)}`;
    try {
      const res = await fetchWithTimeout(
        url,
        { headers: { accept: "application/json", "user-agent": buildPoliteUserAgent(email) } },
        options.timeoutMs,
        options.fetchFn
      );
      if (!res.ok) continue;

      const data = (await res.json()) as {
        is_oa?: boolean;
        best_oa_location?: { url_for_pdf?: string | null; url?: string | null } | null;
      };

      const oaUrl =
        data.best_oa_location?.url_for_pdf?.trim() || data.best_oa_location?.url?.trim() || null;
      if (data.is_oa && oaUrl) {
        src.openAccessPdfUrl = oaUrl;
        if (!src.connectorNames.includes("unpaywall")) {
          src.connectorNames.push("unpaywall");
        }
        enriched++;
      }
    } catch {
      // Unpaywall enrichment is best-effort and must never fail the sweep
    }
  }

  return { checked, enriched };
}
