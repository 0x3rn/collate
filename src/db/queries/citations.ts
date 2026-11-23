import { asc, eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { citations, sources, type CitationRecord } from "@/db/schema";
import {
  buildCslItemFromSource,
  CslItemSchema,
  generateUniqueCiteKey,
  type CslItem,
} from "@/lib/citations/csl";
import { verifyDoiRecord, verifySourceUrlRecord } from "@/lib/citations/verifier";

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
  } = {}
): Promise<{ verified: number; rejected: number; unverified: number }> {
  const allRows = await db.select().from(citations).where(eq(citations.projectId, projectId));
  const onlyUnverified = options.onlyUnverified ?? true;
  const rows = onlyUnverified
    ? allRows.filter((r) => r.verificationStatus === "unverified")
    : allRows;
  const now = options.now ?? new Date();
  const concurrency = Math.max(1, Math.min(10, options.concurrency ?? 5));

  let verified = 0;
  let rejected = 0;
  let unverified = 0;

  for (let i = 0; i < rows.length; i += concurrency) {
    const batch = rows.slice(i, i + concurrency);
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

        return { rowId: row.id, result };
      })
    );

    for (const entry of outcomes) {
      if (!entry) continue;
      await db
        .update(citations)
        .set({
          verificationStatus: entry.result.status,
          verificationNotes: entry.result.notes,
          verifiedAt: now,
        })
        .where(eq(citations.id, entry.rowId));

      if (entry.result.status === "verified") verified++;
      else if (entry.result.status === "unverified") unverified++;
      else rejected++;
    }
  }

  return { verified, rejected, unverified };
}
