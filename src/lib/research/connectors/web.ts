import { TRUSTED_INSTITUTIONAL_DOMAINS } from "@/config/research";
import type { SourceType } from "@/db/schema";
import type { RawSourceCandidate } from "@/lib/research/types";
import { buildPoliteUserAgent, fetchWithTimeout, parseSafeYear } from "./http";
import type { ConnectorEnv, ConnectorSearchOptions, SourceConnector } from "./types";

function classifyWebSourceType(url: string): SourceType {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const isInstitutional = TRUSTED_INSTITUTIONAL_DOMAINS.some((domain) =>
      domain.startsWith(".")
        ? host.endsWith(domain)
        : host === domain || host.endsWith(`.${domain}`)
    );
    return isInstitutional ? "institutional" : "web";
  } catch {
    return "web";
  }
}

export const tavilyConnector: SourceConnector = {
  name: "tavily",
  kind: "web",
  isEnabled: (env: ConnectorEnv) => Boolean(env.TAVILY_API_KEY?.trim()),
  async search(query: string, opts: ConnectorSearchOptions): Promise<RawSourceCandidate[]> {
    const apiKey = opts.env.TAVILY_API_KEY?.trim();
    if (!apiKey) return [];

    const res = await fetchWithTimeout(
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: "advanced",
          max_results: Math.min(10, opts.maxResults),
        }),
      },
      opts.timeoutMs,
      opts.fetchFn
    );
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);

    const data = (await res.json()) as {
      results?: Array<{ url?: string; title?: string; content?: string; published_date?: string }>;
    };

    const out: RawSourceCandidate[] = [];
    for (const item of data.results ?? []) {
      const url = item.url?.trim();
      const title = item.title?.trim();
      if (!url || !title) continue;

      out.push({
        url,
        doi: null,
        title,
        authors: [],
        year: parseSafeYear(item.published_date),
        publisher: null,
        venue: null,
        sourceType: classifyWebSourceType(url),
        connectorName: "tavily",
        citationCount: null,
        abstractText: item.content?.trim() || null,
        openAccessPdfUrl: null,
        retrievedAt: opts.now,
      });
    }

    return out;
  },
};

export const braveSearchConnector: SourceConnector = {
  name: "brave",
  kind: "web",
  isEnabled: (env: ConnectorEnv) => Boolean(env.BRAVE_SEARCH_API_KEY?.trim()),
  async search(query: string, opts: ConnectorSearchOptions): Promise<RawSourceCandidate[]> {
    const apiKey = opts.env.BRAVE_SEARCH_API_KEY?.trim();
    if (!apiKey) return [];

    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(10, opts.maxResults)}`;
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          accept: "application/json",
          "x-subscription-token": apiKey,
          "user-agent": buildPoliteUserAgent(opts.env.SCHOLARLY_CONTACT_EMAIL),
        },
      },
      opts.timeoutMs,
      opts.fetchFn
    );
    if (!res.ok) throw new Error(`Brave Search HTTP ${res.status}`);

    const data = (await res.json()) as {
      web?: {
        results?: Array<{ url?: string; title?: string; description?: string; page_age?: string }>;
      };
    };

    const out: RawSourceCandidate[] = [];
    for (const item of data.web?.results ?? []) {
      const targetUrl = item.url?.trim();
      const title = item.title?.trim();
      if (!targetUrl || !title) continue;

      out.push({
        url: targetUrl,
        doi: null,
        title,
        authors: [],
        year: parseSafeYear(item.page_age),
        publisher: null,
        venue: null,
        sourceType: classifyWebSourceType(targetUrl),
        connectorName: "brave",
        citationCount: null,
        abstractText: item.description?.trim() || null,
        openAccessPdfUrl: null,
        retrievedAt: opts.now,
      });
    }

    return out;
  },
};
