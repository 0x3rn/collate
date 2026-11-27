import { asc, desc, eq } from "drizzle-orm";
import { PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib";
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
  useChapters?: boolean;
}): string {
  const author = params.authorName?.trim() || "[Author Name]";
  const institution = params.institution?.trim() || "[Institution / Department]";
  const draftingUnit = (params.useChapters ?? true) ? "chapter" : "section";

  return [
    "AI-Assisted Research and Drafting Disclosure Statement",
    "",
    `Work title: ${params.projectTitle}`,
    `Author: ${author}`,
    `Institution: ${institution}`,
    "",
    "Disclosure:",
    `During the preparation of this work, the author used Collate (an evidence-bound research and drafting assistant) to support literature discovery across ${params.verifiedSourceCount} verified source records, outline organization, citation formatting (${params.citationStyle.toUpperCase()}), and iterative ${draftingUnit} drafting and similarity checks.`,
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

function formatVersionLabel(version: number, createdBy: string): string {
  if (version === 1 && createdBy !== "user") return "Original draft";
  if (createdBy === "user") return "Author edit";
  if (createdBy === "revision") return "Collate revision";
  return "Collate draft";
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

export function sanitizeProcessLogFilename(title: string, ext: "txt" | "md" | "pdf"): string {
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
        `${idx + 1}. Source check on ${formatReadableDate(run.startedAt)} | Status: ${run.status} | Sources found: ${run.sourcesFound.toLocaleString("en-US")} | Retrieved: ${run.sourcesFetched.toLocaleString("en-US")} | Subtopics covered: ${run.subtopicsCovered}`
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
        `${idx + 1}. ${src.title}${yearPart} | ${formatVerificationLabel(src.verificationStatus)} | ${idPart} | Retrieved ${formatReadableDate(src.retrievedAt)}`
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
            `  - Version ${v.version} (${formatVersionLabel(v.version, v.createdBy)}, ${formatReadableDate(v.createdAt)}): ${v.wordCount.toLocaleString("en-US")} words, ${v.pageCount.toLocaleString("en-US")} pages | ${checkText}`
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

function toPdfSafeWinAnsi(text: string): string {
  return text
    .replaceAll("\u2014", " - ")
    .replaceAll("\u2013", "-")
    .replaceAll("\u2018", "'")
    .replaceAll("\u2019", "'")
    .replaceAll("\u201c", '"')
    .replaceAll("\u201d", '"')
    .replaceAll("\u2026", "...")
    .replaceAll("\u00b7", " | ")
    .replaceAll("\u2022", "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, " ");
}

function wrapPdfLine(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const safe = toPdfSafeWinAnsi(text);
  if (!safe.trim()) return [""];
  const words = safe.split(/\s+/);
  const out: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      if (current) out.push(current);
      // Break extremely long unspaced strings (such as long URLs or DOIs) safely
      if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
        let chunk = "";
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, fontSize) > maxWidth && chunk) {
            out.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Generates a clean, paginated A4 PDF of the Writing Process Log & Disclosure Statement
 * directly via pdf-lib (zero external Browser Run subrequests; works offline and on Free tier).
 */
export async function formatWritingProcessLogPdf(
  log: WritingProcessLogExport,
  disclosureStatement: string
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${log.project.title} | Writing Process Log`);
  doc.setAuthor("Collate");

  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);

  const pageWidth = 595.28; // A4 pt
  const pageHeight = 841.89;
  const marginX = 52;
  const topY = pageHeight - 56;
  const bottomY = 58;
  const contentWidth = pageWidth - marginX * 2;

  const ink = rgb(0.09, 0.1, 0.13);
  const muted = rgb(0.38, 0.41, 0.46);
  const accent = rgb(0.09, 0.25, 0.46);
  const ruleColor = rgb(0.86, 0.88, 0.91);

  let page = doc.addPage([pageWidth, pageHeight]);
  let cursorY = topY;

  function ensureSpace(heightNeeded: number) {
    if (cursorY - heightNeeded < bottomY) {
      page = doc.addPage([pageWidth, pageHeight]);
      cursorY = topY;
    }
  }

  function drawParagraph(
    text: string,
    opts: {
      font?: PDFFont;
      size?: number;
      color?: ReturnType<typeof rgb>;
      indent?: number;
      lineGap?: number;
      after?: number;
    } = {}
  ) {
    const font = opts.font ?? bodyFont;
    const size = opts.size ?? 10;
    const color = opts.color ?? ink;
    const indent = opts.indent ?? 0;
    const lineHeight = size + (opts.lineGap ?? 4);
    const wrapped = wrapPdfLine(text, font, size, contentWidth - indent);

    for (const line of wrapped) {
      ensureSpace(lineHeight);
      if (line.length > 0) {
        page.drawText(line, { x: marginX + indent, y: cursorY - size, size, font, color });
      }
      cursorY -= lineHeight;
    }
    cursorY -= opts.after ?? 4;
  }

  function drawSectionHeading(title: string) {
    cursorY -= 8;
    ensureSpace(32);
    page.drawText(toPdfSafeWinAnsi(title), {
      x: marginX,
      y: cursorY - 12,
      size: 12,
      font: boldFont,
      color: accent,
    });
    cursorY -= 18;
    page.drawLine({
      start: { x: marginX, y: cursorY },
      end: { x: pageWidth - marginX, y: cursorY },
      thickness: 0.75,
      color: ruleColor,
    });
    cursorY -= 10;
  }

  // Document Header
  drawParagraph("WRITING PROCESS LOG", {
    font: boldFont,
    size: 9,
    color: accent,
    after: 2,
  });
  drawParagraph(log.project.title, {
    font: serifBold,
    size: 17,
    color: ink,
    lineGap: 5,
    after: 8,
  });

  const metaItems = [
    `Work type: ${formatWorkTypeLabel(log.project.type)}`,
    log.project.level ? `Level: ${log.project.level}` : null,
    log.project.institution ? `Institution: ${log.project.institution}` : null,
    `Citation style: ${log.project.citationStyle.toUpperCase()}`,
    `Generated: ${formatReadableDate(log.generatedAt)}`,
  ].filter(Boolean) as string[];

  drawParagraph(metaItems.join("  |  "), {
    font: bodyFont,
    size: 9,
    color: muted,
    after: 10,
  });

  // 1. Research History
  drawSectionHeading("1. Research and Source Verification History");
  if (log.researchHistory.length === 0) {
    drawParagraph("No source checks recorded yet.", { color: muted });
  } else {
    log.researchHistory.forEach((run, idx) => {
      drawParagraph(
        `${idx + 1}. Source check on ${formatReadableDate(run.startedAt)} - Status: ${run.status} | Sources found: ${run.sourcesFound.toLocaleString("en-US")} | Retrieved: ${run.sourcesFetched.toLocaleString("en-US")} | Subtopics covered: ${run.subtopicsCovered}`,
        { size: 9.5, after: 4 }
      );
    });
  }

  // 2. Verified Sources
  drawSectionHeading(`2. Verified Sources (${log.verifiedSourcesUsed.length})`);
  if (log.verifiedSourcesUsed.length === 0) {
    drawParagraph("No verified source records saved yet.", { color: muted });
  } else {
    log.verifiedSourcesUsed.forEach((src, idx) => {
      const yearPart = src.year ? ` (${src.year})` : "";
      const idPart = src.doi ? `DOI: ${src.doi}` : src.url || "No link recorded";
      drawParagraph(
        `${idx + 1}. ${src.title}${yearPart} - ${formatVerificationLabel(src.verificationStatus)} | ${idPart} | Retrieved ${formatReadableDate(src.retrievedAt)}`,
        { size: 9, after: 3 }
      );
    });
  }

  // 3. Chapter Drafting History
  drawSectionHeading("3. Chapter Drafting and Revision History");
  if (log.chapterDraftingHistory.length === 0) {
    drawParagraph("No chapters drafted yet.", { color: muted });
  } else {
    for (const ch of log.chapterDraftingHistory) {
      drawParagraph(
        `Chapter ${ch.chapterNumber}: ${ch.chapterTitle} (${ch.status.replaceAll("_", " ")})`,
        { font: boldFont, size: 10, after: 2 }
      );
      if (ch.versions.length === 0) {
        drawParagraph("Not drafted yet.", { size: 9.5, color: muted, indent: 12, after: 4 });
      } else {
        for (const v of ch.versions) {
          const checkText =
            v.originalityPassed === null
              ? "Similarity check not run"
              : `${v.originalityPassed ? "Similarity check passed" : "Flagged for review"}${
                  v.overlapScore !== null ? ` (${v.overlapScore}% source overlap)` : ""
                }`;
          drawParagraph(
            `- Version ${v.version} (${formatVersionLabel(v.version, v.createdBy)}, ${formatReadableDate(v.createdAt)}): ${v.wordCount.toLocaleString("en-US")} words, ${v.pageCount.toLocaleString("en-US")} pages - ${checkText}`,
            { size: 9.5, indent: 12, after: 3 }
          );
        }
      }
    }
  }

  // 4. AI-Use Disclosure Statement
  drawSectionHeading("4. Optional AI-Use Disclosure Statement");
  for (const para of disclosureStatement.split(/\r?\n/)) {
    if (!para.trim()) {
      cursorY -= 6;
    } else {
      drawParagraph(para, { size: 9.5, after: 3 });
    }
  }

  // Page numbers footer
  const pages = doc.getPages();
  pages.forEach((p, idx) => {
    const label = `Collate Writing Process Log  |  Page ${idx + 1} of ${pages.length}`;
    const width = bodyFont.widthOfTextAtSize(label, 8.5);
    p.drawText(label, {
      x: (pageWidth - width) / 2,
      y: 28,
      size: 8.5,
      font: bodyFont,
      color: muted,
    });
  });

  return doc.save();
}
