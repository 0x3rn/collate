import { RESEARCH_CONFIG } from "@/config/research";
import type { SourceAccessStatus, SourceFetchStatus } from "@/db/schema";
import type { R2WritableBucket } from "@/lib/pdf/render-pdf";
import { safePublicFetch } from "@/lib/security/ssrf";
import { buildPoliteUserAgent } from "./connectors/http";
import { extractCleanTextFromHtml, sanitizeUntrustedSourceText } from "./extractor";
import { RobotsChecker } from "./robots";

export interface BrowserRunContentBinding {
  quickAction(action: "content", options: { url: string }): Promise<Response>;
}

export interface FetchSourceInput {
  projectId: string;
  sourceId: string;
  url: string;
  existingAbstract?: string | null;
}

export interface FetchSourceOutcome {
  fetchStatus: SourceFetchStatus;
  accessStatus: SourceAccessStatus;
  extractedText: string | null;
  snapshotR2Key: string | null;
  retrievedAt: Date;
  note?: string;
}

export async function fetchAndSnapshotSource(
  input: FetchSourceInput,
  deps: {
    fetchFn: typeof fetch;
    bucket: R2WritableBucket;
    robots?: RobotsChecker;
    browser?: BrowserRunContentBinding;
    contactEmail?: string;
    timeoutMs?: number;
    now?: Date;
  }
): Promise<FetchSourceOutcome> {
  const now = deps.now ?? new Date();
  const timeoutMs = deps.timeoutMs ?? RESEARCH_CONFIG.caps.perRequestTimeoutMs;
  const robots = deps.robots ?? new RobotsChecker();
  const fallbackAbstract = input.existingAbstract?.trim()
    ? sanitizeUntrustedSourceText(input.existingAbstract)
    : null;

  const allowed = await robots.isUrlAllowed(input.url, {
    fetchFn: deps.fetchFn,
    timeoutMs,
    contactEmail: deps.contactEmail,
  });
  if (!allowed) {
    return {
      fetchStatus: "skipped",
      accessStatus: fallbackAbstract ? "abstract_only" : "metadata_only",
      extractedText: fallbackAbstract,
      snapshotR2Key: null,
      retrievedAt: now,
      note: "Disallowed by robots.txt",
    };
  }

  let response: Response;
  let finalUrl: string;
  try {
    const res = await safePublicFetch(input.url, {
      headers: {
        "user-agent": buildPoliteUserAgent(deps.contactEmail),
        accept: "text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.5",
      },
      timeoutMs,
      fetchFn: deps.fetchFn,
    });
    response = res.response;
    finalUrl = res.finalUrl;
  } catch (err) {
    return {
      fetchStatus: "failed",
      accessStatus: fallbackAbstract ? "abstract_only" : "fetch_failed",
      extractedText: fallbackAbstract,
      snapshotR2Key: null,
      retrievedAt: now,
      note: err instanceof Error ? err.message : String(err),
    };
  }

  if (response.status === 401 || response.status === 402 || response.status === 403) {
    return {
      fetchStatus: "skipped",
      accessStatus: fallbackAbstract ? "abstract_only" : "metadata_only",
      extractedText: fallbackAbstract,
      snapshotR2Key: null,
      retrievedAt: now,
      note: `Restricted or paywalled (HTTP ${response.status})`,
    };
  }

  if (!response.ok) {
    return {
      fetchStatus: "failed",
      accessStatus: fallbackAbstract ? "abstract_only" : "fetch_failed",
      extractedText: fallbackAbstract,
      snapshotR2Key: null,
      retrievedAt: now,
      note: `HTTP ${response.status}`,
    };
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("application/pdf")) {
    const r2Key = `sources/${input.projectId}/${input.sourceId}.json`;
    const text = fallbackAbstract;
    if (text) {
      await deps.bucket.put(
        r2Key,
        JSON.stringify({
          sourceId: input.sourceId,
          url: finalUrl,
          contentType,
          retrievedAt: now.toISOString(),
          text,
        }),
        { httpMetadata: { contentType: "application/json" } }
      );
    }
    return {
      fetchStatus: "fetched",
      accessStatus: text ? "abstract_only" : "metadata_only",
      extractedText: text,
      snapshotR2Key: text ? r2Key : null,
      retrievedAt: now,
      note: "PDF endpoint recorded",
    };
  }

  const rawBody = (await response.text()).slice(0, RESEARCH_CONFIG.caps.maxHtmlBytes);
  let extracted = contentType.includes("text/plain")
    ? { title: null, text: sanitizeUntrustedSourceText(rawBody), needsJsFallback: false }
    : extractCleanTextFromHtml(rawBody);

  if (extracted.needsJsFallback && deps.browser) {
    try {
      const renderedRes = await deps.browser.quickAction("content", { url: finalUrl });
      if (renderedRes.ok) {
        const renderedHtml = (await renderedRes.text()).slice(0, RESEARCH_CONFIG.caps.maxHtmlBytes);
        const rerendered = extractCleanTextFromHtml(renderedHtml);
        if (rerendered.text.length > extracted.text.length) {
          extracted = rerendered;
        }
      }
    } catch {
      // Keep static extraction or abstract fallback
    }
  }

  const hasSubstantialFullText = extracted.text.length >= 400;
  const finalText = hasSubstantialFullText ? extracted.text : (fallbackAbstract ?? extracted.text);
  const accessStatus: SourceAccessStatus = hasSubstantialFullText
    ? "full_text"
    : fallbackAbstract
      ? "abstract_only"
      : finalText.length > 0
        ? "abstract_only"
        : "metadata_only";

  const snapshotR2Key = `sources/${input.projectId}/${input.sourceId}.json`;
  await deps.bucket.put(
    snapshotR2Key,
    JSON.stringify({
      sourceId: input.sourceId,
      url: finalUrl,
      contentType,
      retrievedAt: now.toISOString(),
      accessStatus,
      extractedTitle: extracted.title,
      text: finalText,
    }),
    {
      httpMetadata: { contentType: "application/json" },
      customMetadata: {
        retrievedAt: now.toISOString(),
        accessStatus,
      },
    }
  );

  return {
    fetchStatus: "fetched",
    accessStatus,
    extractedText: finalText || null,
    snapshotR2Key,
    retrievedAt: now,
  };
}
