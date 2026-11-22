import { eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { citations, sourcePassages, sources } from "@/db/schema";
import type { EmbeddingProvider, VectorStore } from "@/lib/research/embeddings";

export interface RetrievedEvidencePassage {
  passageId: string;
  sourceId: string;
  citationId: string;
  citeKey: string;
  sourceTitle: string;
  year: number | null;
  location: string;
  text: string;
  score: number;
}

function tokenizeQuery(text: string): Set<string> {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "into",
    "about",
    "study",
    "chapter",
    "section",
  ]);
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stopWords.has(w))
  );
}

export async function retrieveEvidencePassages(
  db: AppDb,
  params: {
    projectId: string;
    queryText: string;
    topK?: number;
    sourceTypeFilter?: string[];
    embedder?: EmbeddingProvider;
    vectorStore?: VectorStore;
  }
): Promise<RetrievedEvidencePassage[]> {
  const topK = params.topK ?? 8;

  const projectCitations = await db
    .select()
    .from(citations)
    .where(eq(citations.projectId, params.projectId));

  const validCitationsBySourceId = new Map<string, { citationId: string; citeKey: string }>();
  for (const c of projectCitations) {
    if (
      c.verificationStatus === "fake_or_not_found" ||
      c.verificationStatus === "title_mismatch" ||
      c.verificationStatus === "dead_url"
    ) {
      continue;
    }
    validCitationsBySourceId.set(c.sourceId, { citationId: c.id, citeKey: c.citeKey });
  }

  if (validCitationsBySourceId.size === 0) {
    return [];
  }

  const projectSources = await db
    .select()
    .from(sources)
    .where(eq(sources.projectId, params.projectId));

  const sourceById = new Map(projectSources.map((s) => [s.id, s]));

  const allPassages = await db
    .select()
    .from(sourcePassages)
    .where(eq(sourcePassages.projectId, params.projectId));

  const vectorScoreById = new Map<string, number>();
  if (params.embedder && params.vectorStore) {
    try {
      const [queryVec] = await params.embedder.embed([params.queryText]);
      if (queryVec) {
        const matches = await params.vectorStore.query(queryVec, {
          topK: topK * 2,
          filter: { projectId: params.projectId },
        });
        for (const m of matches) {
          vectorScoreById.set(m.id, m.score);
        }
      }
    } catch {
      // Fall back cleanly to D1 lexical + credibility ranking
    }
  }

  const queryTokens = tokenizeQuery(params.queryText);
  const scored: RetrievedEvidencePassage[] = [];

  for (const psg of allPassages) {
    const cit = validCitationsBySourceId.get(psg.sourceId);
    const src = sourceById.get(psg.sourceId);
    if (!cit || !src) continue;
    if (params.sourceTypeFilter && !params.sourceTypeFilter.includes(src.sourceType)) {
      continue;
    }

    const psgTokens = tokenizeQuery(`${src.title} ${psg.text}`);
    let overlap = 0;
    for (const tok of queryTokens) {
      if (psgTokens.has(tok)) overlap++;
    }
    const lexicalScore = queryTokens.size > 0 ? overlap / queryTokens.size : 0;
    const semanticScore = psg.vectorId ? (vectorScoreById.get(psg.vectorId) ?? 0) : 0;
    const credBonus = (src.credibilityScore / 100) * 0.2;

    const totalScore = Number((semanticScore * 0.55 + lexicalScore * 0.35 + credBonus).toFixed(4));

    scored.push({
      passageId: psg.id,
      sourceId: src.id,
      citationId: cit.citationId,
      citeKey: cit.citeKey,
      sourceTitle: src.title,
      year: src.year,
      location: psg.location,
      text: psg.text,
      score: totalScore,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
