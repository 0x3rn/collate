import { asc, eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { citations, sources, type CitationRecord } from "@/db/schema";
import {
  buildCslItemFromSource,
  CslItemSchema,
  generateUniqueCiteKey,
  type CslItem,
} from "@/lib/citations/csl";
import {
  isSubrequestLimitError,
  verifyDoiRecord,
  verifySourceUrlRecord,
} from "@/lib/citations/verifier";
import { normalizeDoi } from "@/lib/research/dedupe";

/**
 * Authoritative scholarly APIs already queried directly during Collate's research sweep.
 * Records returned by these connectors with a valid DOI or official academic URL do not
 * need redundant live HTTP re-fetches during chapter startup (preventing Cloudflare Free-plan
 * 50-subrequest exhaustion on 100+ source projects).
 */
export const TRUSTED_SCHOLARLY_CONNECTORS = new Set([
  "crossref",
  "openalex",
  "semantic_scholar",
  "europe_pmc",
  "pubmed",
  "arxiv",
  "core",
]);

function hasTrustedAcademicIdentifier(item: CslItem): boolean {
  if (item.DOI && normalizeDoi(item.DOI)) return true;
  if (!item.URL) return false;
  try {
    const host = new URL(item.URL).hostname.toLowerCase();
    return (
      host === "arxiv.org" ||
      host.endsWith(".arxiv.org") ||
      host === "doi.org" ||
      host === "dx.doi.org" ||
      host === "europepmc.org" ||
      host.endsWith(".nih.gov") ||
      host === "openalex.org" ||
      host === "semanticscholar.org" ||
      host.endsWith(".semanticscholar.org") ||
      host === "core.ac.uk" ||
      host.endsWith(".core.ac.uk")
    );
  } catch {
    return false;
  }
}

export async function syncCitationRegistryForProject(
  db: AppDb,
  projectId: string,
  now: Date = new Date()
): Promise<CitationRecord[]> {
  const existing = await db
    .select()
    .from(citations)
    .where(eq(citations.projectId, projectId))
    .orderBy(asc(citations.citeKey));

  const existingBySourceId = new Map(existing.map((c) => [c.sourceId, c]));
  const usedKeys = new Set(existing.map((c) => c.citeKey));

  const projectSources = await db
    .select()
    .from(sources)
    .where(eq(sources.projectId, projectId))
    .orderBy(asc(sources.createdAt));

  for (const src of projectSources) {
    if (existingBySourceId.has(src.id)) continue;

    let authors: string[];
    try {
      authors = JSON.parse(src.authorsJson) as string[];
    } catch {
      authors = [];
    }

    const citeKey = generateUniqueCiteKey(
      { authors, publisher: src.publisher, title: src.title, year: src.year },
      usedKeys
    );

    const cslItem = buildCslItemFromSource({
      citeKey,
      title: src.title,
      authors,
      year: src.year,
      venue: src.venue,
      publisher: src.publisher,
      doi: src.doi,
      url: src.url,
      sourceType: src.sourceType,
      retrievedAt: src.retrievedAt,
    });

    await db.insert(citations).values({
      id: `cit_${crypto.randomUUID()}`,
      projectId,
      sourceId: src.id,
      citeKey,
      cslJson: JSON.stringify(cslItem),
      verificationStatus: "unverified",
      createdAt: now,
    });
  }

  return db
    .select()
    .from(citations)
    .where(eq(citations.projectId, projectId))
    .orderBy(asc(citations.citeKey));
}

export async function loadProjectCitationMap(
  db: AppDb,
  projectId: string,
  options: { excludeRejected?: boolean } = {}
): Promise<Map<string, CslItem>> {
  const rows = await db
    .select()
    .from(citations)
    .where(eq(citations.projectId, projectId))
    .orderBy(asc(citations.citeKey));

  const map = new Map<string, CslItem>();
  for (const row of rows) {
    if (
      options.excludeRejected &&
      (row.verificationStatus === "fake_or_not_found" ||
        row.verificationStatus === "title_mismatch" ||
        row.verificationStatus === "dead_url")
    ) {
      continue;
    }
    try {
      const item = CslItemSchema.parse(JSON.parse(row.cslJson));
      map.set(row.citeKey, item);
    } catch {
      // Skip malformed entry
    }
  }
  return map;
}

export async function verifyProjectCitations(
  db: AppDb,
  projectId: string,
  options: {
    fetchFn?: typeof fetch;
    contactEmail?: string;
    now?: Date;
    onlyUnverified?: boolean;
    concurrency?: number;
    /** Restrict verification to citations tied to these source IDs (e.g. sources with passages). */
    sourceIds?: Iterable<string>;
    /** Cap live external HTTP verification checks to stay safely within Worker subrequest budgets. */
    maxExternalChecks?: number;
    /**
     * When true, citations originally retrieved from Collate's trusted scholarly API connectors
     * with a valid DOI or authoritative repository URL are marked verified without burning live
     * external HTTP subrequests.
     */
    autoVerifyTrustedConnectors?: boolean;
  } = {}
): Promise<{ verified: number; rejected: number; unverified: number }> {
  const allRows = await db.select().from(citations).where(eq(citations.projectId, projectId));
  const onlyUnverified = options.onlyUnverified ?? true;
  const allowedSourceIds = options.sourceIds ? new Set(options.sourceIds) : null;
  const rows = allRows.filter((r) => {
    if (onlyUnverified && r.verificationStatus !== "unverified") return false;
    if (allowedSourceIds && !allowedSourceIds.has(r.sourceId)) return false;
    return true;
  });

  if (rows.length === 0) {
    return { verified: 0, rejected: 0, unverified: 0 };
  }

  const now = options.now ?? new Date();
  const concurrency = Math.max(1, Math.min(10, options.concurrency ?? 5));
  const maxExternalChecks =
    typeof options.maxExternalChecks === "number" && options.maxExternalChecks >= 0
      ? options.maxExternalChecks
      : Number.POSITIVE_INFINITY;

  const connectorBySourceId = new Map<string, string>();
  if (options.autoVerifyTrustedConnectors) {
    const projectSources = await db
      .select({ id: sources.id, connectorName: sources.connectorName })
      .from(sources)
      .where(eq(sources.projectId, projectId));
    for (const s of projectSources) {
      connectorBySourceId.set(s.id, s.connectorName);
    }
  }

  let verified = 0;
  let rejected = 0;
  let unverified = 0;

  const rowsNeedingExternalCheck: typeof rows = [];

  for (const row of rows) {
    if (options.autoVerifyTrustedConnectors) {
      const connector = connectorBySourceId.get(row.sourceId) ?? "";
      if (TRUSTED_SCHOLARLY_CONNECTORS.has(connector)) {
        try {
          const item = CslItemSchema.parse(JSON.parse(row.cslJson));
          if (hasTrustedAcademicIdentifier(item)) {
            await db
              .update(citations)
              .set({
                verificationStatus: "verified",
                verificationNotes: `Verified directly via ${connector} scholarly index record.`,
                verifiedAt: now,
              })
              .where(eq(citations.id, row.id));
            verified++;
            continue;
          }
        } catch {
          // Fall through to normal verification
        }
      }
    }
    rowsNeedingExternalCheck.push(row);
  }

  const cappedExternalRows = Number.isFinite(maxExternalChecks)
    ? rowsNeedingExternalCheck.slice(0, maxExternalChecks)
    : rowsNeedingExternalCheck;
  unverified += rowsNeedingExternalCheck.length - cappedExternalRows.length;

  let hitSubrequestLimit = false;
  for (let i = 0; i < cappedExternalRows.length; i += concurrency) {
    if (hitSubrequestLimit) {
      unverified += cappedExternalRows.length - i;
      break;
    }

    const batch = cappedExternalRows.slice(i, i + concurrency);
    const outcomes = await Promise.all(
      batch.map(async (row) => {
        let item: CslItem;
        try {
          item = CslItemSchema.parse(JSON.parse(row.cslJson));
        } catch {
          return null;
        }

        const result = item.DOI
          ? await verifyDoiRecord(item.DOI, item.title, {
              fetchFn: options.fetchFn,
              contactEmail: options.contactEmail,
            })
          : await verifySourceUrlRecord(item.URL ?? "", {
              fetchFn: options.fetchFn,
              contactEmail: options.contactEmail,
            });

        if (isSubrequestLimitError(result.notes)) {
          hitSubrequestLimit = true;
        }

        return { rowId: row.id, previousStatus: row.verificationStatus, result };
      })
    );

    for (const entry of outcomes) {
      if (!entry) continue;
      if (entry.result.status !== entry.previousStatus || entry.result.status === "verified") {
        await db
          .update(citations)
          .set({
            verificationStatus: entry.result.status,
            verificationNotes: entry.result.notes,
            verifiedAt: entry.result.status === "verified" ? now : null,
          })
          .where(eq(citations.id, entry.rowId));
      }

      if (entry.result.status === "verified") verified++;
      else if (entry.result.status === "unverified") unverified++;
      else rejected++;
    }
  }

  return { verified, rejected, unverified };
}
