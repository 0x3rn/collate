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

function formatReadableDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatVersionCreator(createdBy: string): string {
  if (createdBy === "user") return "Author edit";
  if (createdBy === "revision") return "Requested revision";
  return "AI draft";
}

function formatVerificationLabel(status: string): string {
  if (status === "verified") return "Verified";
  if (status === "unverified") return "Pending check";
  if (status === "title_mismatch") return "Needs title check";
  if (status === "dead_url") return "Link unreachable";
  return "Flagged";
}

function formatWorkTypeLabel(type: string): string {
  if (type === "research") return "Research paper";
  if (type === "thesis") return "Thesis";
  if (type === "assignment") return "Assignment";
  return "Project";
}

export function sanitizeProcessLogFilename(title: string, ext: "txt" | "md"): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "collate-project";
  return `${slug}-writing-log.${ext}`;
}

/**
 * Formats the project writing-process log into a student-readable Plain Text (.txt)
 * or Markdown (.md) document suitable for submitting alongside an academic paper.
 */
export function formatWritingProcessLogReport(
  log: WritingProcessLogExport,
  disclosureStatement: string,
  format: "txt" | "md" = "txt"
): string {
  const isMd = format === "md";
  const h1 = (t: string) => (isMd ? `# ${t}` : `${t.toUpperCase()}\n${"=".repeat(t.length)}`);
  const h2 = (t: string) => (isMd ? `## ${t}` : `${t}\n${"-".repeat(t.length)}`);
  const lines: string[] = [];

  lines.push(h1("Writing Process Log"));
  lines.push("");
  lines.push(`- **Work title:** ${log.project.title}`.replaceAll("**", isMd ? "**" : ""));
  lines.push(
    `- **Work type:** ${formatWorkTypeLabel(log.project.type)}`.replaceAll("**", isMd ? "**" : "")
  );
  if (log.project.level) {
    lines.push(`- **Academic level:** ${log.project.level}`.replaceAll("**", isMd ? "**" : ""));
  }
  if (log.project.institution) {
    lines.push(`- **Institution:** ${log.project.institution}`.replaceAll("**", isMd ? "**" : ""));
  }
  lines.push(
    `- **Citation style:** ${log.project.citationStyle.toUpperCase()}`.replaceAll(
      "**",
      isMd ? "**" : ""
    )
  );
  lines.push(
    `- **Generated:** ${formatReadableDate(log.generatedAt)}`.replaceAll("**", isMd ? "**" : "")
  );
  lines.push("");

  lines.push(h2("1. Research and Source Verification History"));
  lines.push("");
  if (log.researchHistory.length === 0) {
    lines.push("No source checks recorded yet.");
  } else {
    log.researchHistory.forEach((run, idx) => {
      lines.push(
        `${idx + 1}. Source check on ${formatReadableDate(run.startedAt)} — Status: ${run.status} | Sources found: ${run.sourcesFound.toLocaleString("en-US")} | Retrieved: ${run.sourcesFetched.toLocaleString("en-US")} | Subtopics covered: ${run.subtopicsCovered}`
      );
    });
  }
  lines.push("");

  lines.push(h2(`2. Verified Sources (${log.verifiedSourcesUsed.length})`));
  lines.push("");
  if (log.verifiedSourcesUsed.length === 0) {
    lines.push("No verified source records saved yet.");
  } else {
    log.verifiedSourcesUsed.forEach((src, idx) => {
      const yearPart = src.year ? ` (${src.year})` : "";
      const idPart = src.doi ? `DOI: ${src.doi}` : src.url || "No link recorded";
      lines.push(
        `${idx + 1}. ${src.title}${yearPart} — ${formatVerificationLabel(src.verificationStatus)} | ${idPart} | Retrieved ${formatReadableDate(src.retrievedAt)}`
      );
    });
  }
  lines.push("");

  lines.push(h2("3. Chapter Drafting and Revision History"));
  lines.push("");
  if (log.chapterDraftingHistory.length === 0) {
    lines.push("No chapters drafted yet.");
  } else {
    for (const ch of log.chapterDraftingHistory) {
      lines.push(
        isMd
          ? `### Chapter ${ch.chapterNumber}: ${ch.chapterTitle} (${ch.status.replace("_", " ")})`
          : `Chapter ${ch.chapterNumber}: ${ch.chapterTitle} (${ch.status.replace("_", " ")})`
      );
      if (ch.versions.length === 0) {
        lines.push("  - Not drafted yet.");
      } else {
        for (const v of ch.versions) {
          const checkText =
            v.originalityPassed === null
              ? "Similarity check not run"
              : `${v.originalityPassed ? "Similarity check passed" : "Flagged for review"}${
                  v.overlapScore !== null ? ` (${v.overlapScore}% source overlap)` : ""
                }`;
          lines.push(
            `  - Version ${v.version} (${formatVersionCreator(v.createdBy)}, ${formatReadableDate(v.createdAt)}): ${v.wordCount.toLocaleString("en-US")} words, ${v.pageCount.toLocaleString("en-US")} pages — ${checkText}`
          );
        }
      }
      lines.push("");
    }
  }

  lines.push(h2("4. AI-Use Disclosure Statement"));
  lines.push("");
  lines.push(disclosureStatement);
  lines.push("");

  return lines.join("\n");
}
