import { asc, desc, eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import {
  chapters,
  chapterVersions,
  citations,
  originalityReports,
  projects,
  projectSettings,
  researchRuns,
  sources,
} from "@/db/schema";

export interface WritingProcessLogExport {
  generatedAt: string;
  project: {
    id: string;
    title: string;
    type: string;
    level: string | null;
    institution: string | null;
    citationStyle: string;
  };
  researchHistory: Array<{
    runId: string;
    status: string;
    sourcesFound: number;
    sourcesFetched: number;
    subtopicsCovered: number;
    startedAt: string;
    finishedAt: string | null;
  }>;
  verifiedSourcesUsed: Array<{
    citeKey: string;
    title: string;
    year: number | null;
    doi: string | null;
    url: string;
    verificationStatus: string;
    retrievedAt: string;
  }>;
  chapterDraftingHistory: Array<{
    chapterNumber: number;
    chapterTitle: string;
    status: string;
    versions: Array<{
      version: number;
      wordCount: number;
      pageCount: number;
      createdBy: string;
      promptVersion: string;
      createdAt: string;
      originalityPassed: boolean | null;
      overlapScore: number | null;
    }>;
  }>;
}

export async function buildWritingProcessLog(
  db: AppDb,
  projectId: string,
  now: Date = new Date()
): Promise<WritingProcessLogExport | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return null;

  const [settings] = await db
    .select()
    .from(projectSettings)
    .where(eq(projectSettings.projectId, projectId))
    .limit(1);

  const runs = await db
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.projectId, projectId))
    .orderBy(asc(researchRuns.startedAt));

  const citationRows = await db
    .select()
    .from(citations)
    .where(eq(citations.projectId, projectId))
    .orderBy(asc(citations.citeKey));

  const sourceRows = await db.select().from(sources).where(eq(sources.projectId, projectId));
  const sourceById = new Map(sourceRows.map((s) => [s.id, s]));

  const chapterRows = await db
    .select()
    .from(chapters)
    .where(eq(chapters.projectId, projectId))
    .orderBy(asc(chapters.number));

  const reportRows = await db
    .select()
    .from(originalityReports)
    .where(eq(originalityReports.projectId, projectId));
  const reportByVersionId = new Map(reportRows.map((r) => [r.chapterVersionId, r]));

  const chapterDraftingHistory: WritingProcessLogExport["chapterDraftingHistory"] = [];
  for (const ch of chapterRows) {
    if (ch.isAutoReferences) continue;
    const versions = await db
      .select()
      .from(chapterVersions)
      .where(eq(chapterVersions.chapterId, ch.id))
      .orderBy(desc(chapterVersions.version));

    chapterDraftingHistory.push({
      chapterNumber: ch.number,
      chapterTitle: ch.title,
      status: ch.status,
      versions: versions.map((v) => {
        const rep = reportByVersionId.get(v.id);
        return {
          version: v.version,
          wordCount: v.wordCount,
          pageCount: v.pageCount,
          createdBy: v.createdBy,
          promptVersion: v.promptVersion,
          createdAt: v.createdAt.toISOString(),
          originalityPassed: rep ? rep.passed : null,
          overlapScore: rep ? rep.overlapScore : null,
        };
      }),
    });
  }

  return {
    generatedAt: now.toISOString(),
    project: {
      id: project.id,
      title: project.title,
      type: project.type,
      level: project.level,
      institution: project.institution,
      citationStyle: settings?.citationStyle ?? "apa7",
    },
    researchHistory: runs.map((r) => ({
      runId: r.id,
      status: r.status,
      sourcesFound: r.sourcesFound,
      sourcesFetched: r.sourcesFetched,
      subtopicsCovered: r.subtopicsCovered,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    })),
    verifiedSourcesUsed: citationRows.map((c) => {
      const src = sourceById.get(c.sourceId);
      return {
        citeKey: c.citeKey,
        title: src?.title ?? c.citeKey,
        year: src?.year ?? null,
        doi: src?.doi ?? null,
        url: src?.url ?? "",
        verificationStatus: c.verificationStatus,
        retrievedAt: (src?.retrievedAt ?? c.createdAt).toISOString(),
      };
    }),
    chapterDraftingHistory,
  };
}

export function generateAiDisclosureStatement(params: {
  authorName?: string | null;
  institution?: string | null;
  projectTitle: string;
  citationStyle: string;
  verifiedSourceCount: number;
}): string {
  const author = params.authorName?.trim() || "[Author Name]";
  const institution = params.institution?.trim() || "[Institution / Department]";

  return [
    "AI-Assisted Research and Drafting Disclosure Statement",
    "",
    `Work title: ${params.projectTitle}`,
    `Author: ${author}`,
    `Institution: ${institution}`,
    "",
    "Disclosure:",
    `During the preparation of this work, the author used Collate (an evidence-bound research and drafting assistant) to support scholarly literature discovery across ${params.verifiedSourceCount} verified source records, outline organization, citation formatting (${params.citationStyle.toUpperCase()}), and iterative chapter drafting and similarity checks.`,
    "",
    "Author responsibility:",
    "All empirical data (where included), analytical interpretations, citations, and final edits were reviewed and approved by the author in accordance with institutional academic-integrity guidelines. No experimental, survey, or interview data were fabricated by automated tools.",
  ].join("\n");
}
