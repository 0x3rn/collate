import type { RawSourceCandidate } from "@/lib/research/types";
import { buildPoliteUserAgent, fetchWithTimeout, parseSafeYear, stripMarkupTags } from "./http";
import type { ConnectorEnv, ConnectorSearchOptions, SourceConnector } from "./types";

export function reconstructOpenAlexAbstract(
  invertedIndex: Record<string, number[]> | null | undefined
): string | null {
  if (!invertedIndex || typeof invertedIndex !== "object") return null;
  const positioned: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === "number" && pos >= 0) {
        positioned.push([pos, word]);
      }
    }
  }
  if (positioned.length === 0) return null;
  positioned.sort((a, b) => a[0] - b[0]);
  return (
    positioned
      .map(([, w]) => w)
      .join(" ")
      .trim() || null
  );
}

export const openAlexConnector: SourceConnector = {
  name: "openalex",
  kind: "scholarly",
  isEnabled: () => true,
  async search(query: string, opts: ConnectorSearchOptions): Promise<RawSourceCandidate[]> {
    const mailto = opts.env.SCHOLARLY_CONTACT_EMAIL?.trim() || "research@collate.local";
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${Math.min(25, opts.maxResults)}&mailto=${encodeURIComponent(mailto)}`;

    const res = await fetchWithTimeout(
      url,
      { headers: { "user-agent": buildPoliteUserAgent(mailto), accept: "application/json" } },
      opts.timeoutMs,
      opts.fetchFn
    );
    if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status}`);

    const data = (await res.json()) as {
      results?: Array<{
        id?: string;
        doi?: string | null;
        title?: string | null;
        publication_year?: number | null;
        cited_by_count?: number | null;
        type?: string | null;
        authorships?: Array<{ author?: { display_name?: string | null } }>;
        primary_location?: {
          landing_page_url?: string | null;
          pdf_url?: string | null;
          source?: { display_name?: string | null; host_organization_name?: string | null } | null;
        } | null;
        open_access?: { oa_url?: string | null } | null;
        abstract_inverted_index?: Record<string, number[]> | null;
      }>;
    };

    const out: RawSourceCandidate[] = [];
    for (const item of data.results ?? []) {
      const title = item.title?.trim();
      const targetUrl =
        item.primary_location?.landing_page_url?.trim() ||
        item.open_access?.oa_url?.trim() ||
        item.doi?.trim() ||
        item.id?.trim();
      if (!title || !targetUrl) continue;

      const authors = (item.authorships ?? [])
        .map((a) => a.author?.display_name?.trim())
        .filter((name): name is string => Boolean(name));

      const sourceType =
        item.type === "book" || item.type === "book-chapter"
          ? "book"
          : item.type === "preprint"
            ? "preprint"
            : item.type === "dataset"
              ? "dataset"
              : "peer_reviewed";

      out.push({
        url: targetUrl,
        doi: item.doi ?? null,
        title,
        authors,
        year: parseSafeYear(item.publication_year),
        publisher: item.primary_location?.source?.host_organization_name ?? null,
        venue: item.primary_location?.source?.display_name ?? null,
        sourceType,
        connectorName: "openalex",
        citationCount: typeof item.cited_by_count === "number" ? item.cited_by_count : null,
        abstractText: reconstructOpenAlexAbstract(item.abstract_inverted_index),
        openAccessPdfUrl: item.primary_location?.pdf_url ?? item.open_access?.oa_url ?? null,
        retrievedAt: opts.now,
      });
    }

    return out;
  },
};

export const crossrefConnector: SourceConnector = {
  name: "crossref",
  kind: "scholarly",
  isEnabled: () => true,
  async search(query: string, opts: ConnectorSearchOptions): Promise<RawSourceCandidate[]> {
    const mailto = opts.env.SCHOLARLY_CONTACT_EMAIL?.trim() || "research@collate.local";
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${Math.min(20, opts.maxResults)}&mailto=${encodeURIComponent(mailto)}`;

    const res = await fetchWithTimeout(
      url,
      { headers: { "user-agent": buildPoliteUserAgent(mailto), accept: "application/json" } },
      opts.timeoutMs,
      opts.fetchFn
    );
    if (!res.ok) throw new Error(`Crossref HTTP ${res.status}`);

    const data = (await res.json()) as {
      message?: {
        items?: Array<{
          DOI?: string;
          URL?: string;
          title?: string[];
          publisher?: string;
          "container-title"?: string[];
          type?: string;
          abstract?: string;
          "is-referenced-by-count"?: number;
          author?: Array<{ given?: string; family?: string; name?: string }>;
          issued?: { "date-parts"?: number[][] };
        }>;
      };
    };

    const out: RawSourceCandidate[] = [];
    for (const item of data.message?.items ?? []) {
      const title = item.title?.[0]?.trim();
      const targetUrl = item.URL?.trim() || (item.DOI ? `https://doi.org/${item.DOI}` : "");
      if (!title || !targetUrl) continue;

      const authors = (item.author ?? [])
        .map((a) => (a.name ? a.name.trim() : [a.given, a.family].filter(Boolean).join(" ").trim()))
        .filter(Boolean);

      const year = parseSafeYear(item.issued?.["date-parts"]?.[0]?.[0]);
      const sourceType =
        item.type === "book" || item.type === "book-chapter"
          ? "book"
          : item.type === "posted-content"
            ? "preprint"
            : item.type === "dataset"
              ? "dataset"
              : "peer_reviewed";

      out.push({
        url: targetUrl,
        doi: item.DOI ?? null,
        title,
        authors,
        year,
        publisher: item.publisher ?? null,
        venue: item["container-title"]?.[0] ?? null,
        sourceType,
        connectorName: "crossref",
        citationCount:
          typeof item["is-referenced-by-count"] === "number"
            ? item["is-referenced-by-count"]
            : null,
        abstractText: stripMarkupTags(item.abstract),
        openAccessPdfUrl: null,
        retrievedAt: opts.now,
      });
    }

    return out;
  },
};

export const semanticScholarConnector: SourceConnector = {
  name: "semantic_scholar",
  kind: "scholarly",
  isEnabled: () => true,
  async search(query: string, opts: ConnectorSearchOptions): Promise<RawSourceCandidate[]> {
    const fields = "title,authors,year,venue,citationCount,abstract,url,externalIds,openAccessPdf";
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${Math.min(20, opts.maxResults)}&fields=${fields}`;

    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": buildPoliteUserAgent(opts.env.SCHOLARLY_CONTACT_EMAIL),
    };
    if (opts.env.SEMANTIC_SCHOLAR_API_KEY?.trim()) {
      headers["x-api-key"] = opts.env.SEMANTIC_SCHOLAR_API_KEY.trim();
    }

    const res = await fetchWithTimeout(url, { headers }, opts.timeoutMs, opts.fetchFn);
    if (!res.ok) throw new Error(`Semantic Scholar HTTP ${res.status}`);

    const data = (await res.json()) as {
      data?: Array<{
        title?: string;
        url?: string;
        year?: number | null;
        venue?: string | null;
        citationCount?: number | null;
        abstract?: string | null;
        authors?: Array<{ name?: string }>;
        externalIds?: { DOI?: string } | null;
        openAccessPdf?: { url?: string } | null;
      }>;
    };

    const out: RawSourceCandidate[] = [];
    for (const item of data.data ?? []) {
      const title = item.title?.trim();
      const targetUrl =
        item.url?.trim() ||
        (item.externalIds?.DOI ? `https://doi.org/${item.externalIds.DOI}` : "");
      if (!title || !targetUrl) continue;

      out.push({
        url: targetUrl,
        doi: item.externalIds?.DOI ?? null,
        title,
        authors: (item.authors ?? []).map((a) => a.name?.trim() ?? "").filter(Boolean),
        year: parseSafeYear(item.year),
        publisher: null,
        venue: item.venue?.trim() || null,
        sourceType: item.venue ? "peer_reviewed" : "preprint",
        connectorName: "semantic_scholar",
        citationCount: typeof item.citationCount === "number" ? item.citationCount : null,
        abstractText: item.abstract?.trim() || null,
        openAccessPdfUrl: item.openAccessPdf?.url?.trim() || null,
        retrievedAt: opts.now,
      });
    }

    return out;
  },
};

export const coreConnector: SourceConnector = {
  name: "core",
  kind: "scholarly",
  isEnabled: (env: ConnectorEnv) => Boolean(env.CORE_API_KEY?.trim()),
  async search(query: string, opts: ConnectorSearchOptions): Promise<RawSourceCandidate[]> {
    const apiKey = opts.env.CORE_API_KEY?.trim();
    if (!apiKey) return [];

    const url = `https://api.core.ac.uk/v3/search/works/?q=${encodeURIComponent(query)}&limit=${Math.min(20, opts.maxResults)}`;
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: "application/json",
          "user-agent": buildPoliteUserAgent(opts.env.SCHOLARLY_CONTACT_EMAIL),
        },
      },
      opts.timeoutMs,
      opts.fetchFn
    );
    if (!res.ok) throw new Error(`CORE HTTP ${res.status}`);

    const data = (await res.json()) as {
      results?: Array<{
        title?: string;
        doi?: string | null;
        yearPublished?: number | null;
        publisher?: string | null;
        abstract?: string | null;
        downloadUrl?: string | null;
        sourceFulltextUrls?: string[];
        authors?: Array<{ name?: string }>;
      }>;
    };

    const out: RawSourceCandidate[] = [];
    for (const item of data.results ?? []) {
      const title = item.title?.trim();
      const targetUrl =
        item.downloadUrl?.trim() ||
        item.sourceFulltextUrls?.[0]?.trim() ||
        (item.doi ? `https://doi.org/${item.doi}` : "");
      if (!title || !targetUrl) continue;

      out.push({
        url: targetUrl,
        doi: item.doi ?? null,
        title,
        authors: (item.authors ?? []).map((a) => a.name?.trim() ?? "").filter(Boolean),
        year: parseSafeYear(item.yearPublished),
        publisher: item.publisher ?? null,
        venue: null,
        sourceType: "peer_reviewed",
        connectorName: "core",
        citationCount: null,
        abstractText: item.abstract?.trim() || null,
        openAccessPdfUrl: item.downloadUrl?.trim() || null,
        retrievedAt: opts.now,
      });
    }

    return out;
  },
};

function extractXmlTagText(xmlChunk: string, tagName: string): string | null {
  const openIdx = xmlChunk.indexOf(`<${tagName}`);
  if (openIdx === -1) return null;
  const contentStart = xmlChunk.indexOf(">", openIdx);
  if (contentStart === -1) return null;
  const closeIdx = xmlChunk.indexOf(`</${tagName}>`, contentStart);
  if (closeIdx === -1) return null;
  return stripMarkupTags(xmlChunk.slice(contentStart + 1, closeIdx));
}

function extractAllXmlTagTexts(xmlChunk: string, tagName: string): string[] {
  const results: string[] = [];
  let cursor = 0;
  const openToken = `<${tagName}`;
  const closeToken = `</${tagName}>`;

  while (cursor < xmlChunk.length) {
    const start = xmlChunk.indexOf(openToken, cursor);
    if (start === -1) break;
    const gt = xmlChunk.indexOf(">", start);
    if (gt === -1) break;
    const end = xmlChunk.indexOf(closeToken, gt);
    if (end === -1) break;
    const cleaned = stripMarkupTags(xmlChunk.slice(gt + 1, end));
    if (cleaned) results.push(cleaned);
    cursor = end + closeToken.length;
  }

  return results;
}

export const arxivConnector: SourceConnector = {
  name: "arxiv",
  kind: "scholarly",
  isEnabled: () => true,
  async search(query: string, opts: ConnectorSearchOptions): Promise<RawSourceCandidate[]> {
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${Math.min(15, opts.maxResults)}`;
    const res = await fetchWithTimeout(
      url,
      { headers: { "user-agent": buildPoliteUserAgent(opts.env.SCHOLARLY_CONTACT_EMAIL) } },
      opts.timeoutMs,
      opts.fetchFn
    );
    if (!res.ok) throw new Error(`arXiv HTTP ${res.status}`);

    const xml = await res.text();
    const parts = xml.split("<entry>").slice(1);
    const out: RawSourceCandidate[] = [];

    for (const part of parts) {
      const entryEnd = part.indexOf("</entry>");
      const chunk = entryEnd >= 0 ? part.slice(0, entryEnd) : part;

      const title = extractXmlTagText(chunk, "title");
      const entryUrl = extractXmlTagText(chunk, "id");
      if (!title || !entryUrl) continue;

      const summary = extractXmlTagText(chunk, "summary");
      const published = extractXmlTagText(chunk, "published");
      const doi = extractXmlTagText(chunk, "arxiv:doi");
      const authors = extractAllXmlTagTexts(chunk, "name");
      const pdfUrl = entryUrl.includes("/abs/") ? entryUrl.replace("/abs/", "/pdf/") : null;

      out.push({
        url: entryUrl,
        doi,
        title,
        authors,
        year: parseSafeYear(published),
        publisher: "arXiv",
        venue: "arXiv",
        sourceType: "preprint",
        connectorName: "arxiv",
        citationCount: null,
        abstractText: summary,
        openAccessPdfUrl: pdfUrl,
        retrievedAt: opts.now,
      });
    }

    return out;
  },
};

export const europePmcConnector: SourceConnector = {
  name: "europe_pmc",
  kind: "scholarly",
  isEnabled: () => true,
  async search(query: string, opts: ConnectorSearchOptions): Promise<RawSourceCandidate[]> {
    const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&resultType=core&pageSize=${Math.min(20, opts.maxResults)}`;
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          accept: "application/json",
          "user-agent": buildPoliteUserAgent(opts.env.SCHOLARLY_CONTACT_EMAIL),
        },
      },
      opts.timeoutMs,
      opts.fetchFn
    );
    if (!res.ok) throw new Error(`Europe PMC HTTP ${res.status}`);

    const data = (await res.json()) as {
      resultList?: {
        result?: Array<{
          id?: string;
          source?: string;
          doi?: string;
          title?: string;
          authorString?: string;
          pubYear?: string;
          journalTitle?: string;
          abstractText?: string;
          citedByCount?: number;
          fullTextUrlList?: {
            fullTextUrl?: Array<{
              url?: string;
              documentStyle?: string;
              availabilityCode?: string;
            }>;
          };
        }>;
      };
    };

    const out: RawSourceCandidate[] = [];
    for (const item of data.resultList?.result ?? []) {
      const title = item.title?.trim();
      if (!title) continue;

      const fullTextUrls = item.fullTextUrlList?.fullTextUrl ?? [];
      const pdfEntry = fullTextUrls.find((u) => u.documentStyle === "pdf" && u.url);
      const htmlEntry = fullTextUrls.find((u) => u.url);
      const targetUrl =
        htmlEntry?.url?.trim() ||
        (item.doi
          ? `https://doi.org/${item.doi}`
          : `https://europepmc.org/article/${item.source ?? "MED"}/${item.id ?? ""}`);

      const authors = (item.authorString ?? "")
        .split(",")
        .map((s) => s.trim().replace(/\.$/, ""))
        .filter(Boolean);

      out.push({
        url: targetUrl,
        doi: item.doi ?? null,
        title,
        authors,
        year: parseSafeYear(item.pubYear),
        publisher: null,
        venue: item.journalTitle ?? null,
        sourceType: "peer_reviewed",
        connectorName: "europe_pmc",
        citationCount: typeof item.citedByCount === "number" ? item.citedByCount : null,
        abstractText: stripMarkupTags(item.abstractText),
        openAccessPdfUrl: pdfEntry?.url?.trim() || null,
        retrievedAt: opts.now,
      });
    }

    return out;
  },
};

export const doajConnector: SourceConnector = {
  name: "doaj",
  kind: "scholarly",
  isEnabled: () => true,
  async search(query: string, opts: ConnectorSearchOptions): Promise<RawSourceCandidate[]> {
    const url = `https://doaj.org/api/search/articles/${encodeURIComponent(query)}?pageSize=${Math.min(15, opts.maxResults)}`;
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          accept: "application/json",
          "user-agent": buildPoliteUserAgent(opts.env.SCHOLARLY_CONTACT_EMAIL),
        },
      },
      opts.timeoutMs,
      opts.fetchFn
    );
    if (!res.ok) throw new Error(`DOAJ HTTP ${res.status}`);

    const data = (await res.json()) as {
      results?: Array<{
        bibjson?: {
          title?: string;
          year?: string;
          abstract?: string;
          author?: Array<{ name?: string }>;
          identifier?: Array<{ type?: string; id?: string }>;
          link?: Array<{ type?: string; url?: string }>;
          journal?: { title?: string; publisher?: string };
        };
      }>;
    };

    const out: RawSourceCandidate[] = [];
    for (const item of data.results ?? []) {
      const bib = item.bibjson;
      const title = bib?.title?.trim();
      const doiObj = bib?.identifier?.find((id) => id.type?.toLowerCase() === "doi");
      const fulltextLink = bib?.link?.find((l) => l.type === "fulltext" && l.url);
      const targetUrl =
        fulltextLink?.url?.trim() || (doiObj?.id ? `https://doi.org/${doiObj.id}` : "");
      if (!title || !targetUrl) continue;

      out.push({
        url: targetUrl,
        doi: doiObj?.id ?? null,
        title,
        authors: (bib?.author ?? []).map((a) => a.name?.trim() ?? "").filter(Boolean),
        year: parseSafeYear(bib?.year),
        publisher: bib?.journal?.publisher ?? null,
        venue: bib?.journal?.title ?? null,
        sourceType: "peer_reviewed",
        connectorName: "doaj",
        citationCount: null,
        abstractText: stripMarkupTags(bib?.abstract),
        openAccessPdfUrl: fulltextLink?.url?.trim() || null,
        retrievedAt: opts.now,
      });
    }

    return out;
  },
};
