import type { CitationVerificationStatus } from "@/db/schema";
import { buildPoliteUserAgent, fetchWithTimeout } from "@/lib/research/connectors/http";
import { computeTitleSimilarity, normalizeDoi, normalizeTitle } from "@/lib/research/dedupe";
import { checkPublicHttpUrl, safePublicFetch } from "@/lib/security/ssrf";

export interface CitationVerificationResult {
  valid: boolean;
  status: CitationVerificationStatus;
  notes: string;
  resolvedTitle?: string;
}

export async function verifyDoiRecord(
  rawDoi: string,
  expectedTitle: string,
  options: { fetchFn?: typeof fetch; timeoutMs?: number; contactEmail?: string } = {}
): Promise<CitationVerificationResult> {
  const normalized = normalizeDoi(rawDoi);
  if (!normalized) {
    return {
      valid: false,
      status: "fake_or_not_found",
      notes: `Invalid DOI format: "${rawDoi}"`,
    };
  }

  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  const url = `https://api.crossref.org/works/${encodeURIComponent(normalized)}`;

  try {
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          accept: "application/json",
          "user-agent": buildPoliteUserAgent(options.contactEmail),
        },
      },
      timeoutMs,
      fetchFn
    );

    if (res.status === 404) {
      return {
        valid: false,
        status: "fake_or_not_found",
        notes: `DOI "${normalized}" does not resolve in Crossref (HTTP 404 — rejected as fake or nonexistent).`,
      };
    }

    if (!res.ok) {
      return {
        valid: false,
        status: "unverified",
        notes: `Crossref returned transient HTTP ${res.status} while checking DOI "${normalized}".`,
      };
    }

    const data = (await res.json()) as { message?: { title?: string[] } };
    const resolvedTitle = data.message?.title?.[0]?.trim();
    if (!resolvedTitle) {
      return {
        valid: false,
        status: "fake_or_not_found",
        notes: `Crossref record for DOI "${normalized}" is missing a verifiable title.`,
      };
    }

    const similarity = computeTitleSimilarity(
      normalizeTitle(expectedTitle),
      normalizeTitle(resolvedTitle)
    );
    if (similarity < 0.55) {
      return {
        valid: false,
        status: "title_mismatch",
        resolvedTitle,
        notes: `DOI "${normalized}" resolves to a different paper ("${resolvedTitle}") than expected ("${expectedTitle}").`,
      };
    }

    return {
      valid: true,
      status: "verified",
      resolvedTitle,
      notes: `DOI "${normalized}" verified in Crossref (title match ${Math.round(similarity * 100)}%).`,
    };
  } catch (err) {
    return {
      valid: false,
      status: "unverified",
      notes: `Network error verifying DOI: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function verifySourceUrlRecord(
  rawUrl: string,
  options: { fetchFn?: typeof fetch; timeoutMs?: number; contactEmail?: string } = {}
): Promise<CitationVerificationResult> {
  const safety = checkPublicHttpUrl(rawUrl);
  if (!safety.safe) {
    return {
      valid: false,
      status: "dead_url",
      notes: `Blocked or invalid URL: ${safety.reason}`,
    };
  }

  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 8000;

  try {
    const { response } = await safePublicFetch(rawUrl, {
      headers: { "user-agent": buildPoliteUserAgent(options.contactEmail) },
      timeoutMs,
      fetchFn,
    });

    if (response.status === 404 || response.status === 410) {
      return {
        valid: false,
        status: "dead_url",
        notes: `Source URL returned HTTP ${response.status} (dead link).`,
      };
    }

    if (response.ok || response.status === 401 || response.status === 403) {
      return {
        valid: true,
        status: "verified",
        notes: `Source URL resolved (HTTP ${response.status}).`,
      };
    }

    return {
      valid: false,
      status: "dead_url",
      notes: `Source URL returned unexpected HTTP ${response.status}.`,
    };
  } catch (err) {
    return {
      valid: false,
      status: "dead_url",
      notes: `Could not reach source URL: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
