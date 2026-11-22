import type { LineSpacing } from "@/db/schema";
import type { CoverDetails, FrontMatterToggles } from "@/lib/wizard/schema";

export interface ExportFormattingSettings {
  font: string;
  fontSizePt: number;
  lineSpacing: LineSpacing;
  marginsMm: number;
  pageNumbering: boolean;
  frontMatter: FrontMatterToggles;
  cover: CoverDetails;
}

export interface ExportChapterContent {
  number: number;
  title: string;
  markdown: string;
}

export interface TocEntry {
  label: string;
  title: string;
  pageNumber: number;
}

export interface ThesisExportDocument {
  projectTitle: string;
  workTypeLabel: string;
  level?: string | null;
  abstractText?: string;
  formatting: ExportFormattingSettings;
  chapters: ExportChapterContent[];
  bibliographyEntries: string[];
  appendicesMarkdown?: string;
}

export function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function lineHeightCss(spacing: LineSpacing): string {
  if (spacing === "single") return "1.15";
  if (spacing === "one_half") return "1.5";
  return "2.0";
}

function formatInlineMarkdown(raw: string): string {
  const escaped = escapeHtml(raw);
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export function markdownToPrintHtml(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const htmlParts: string[] = [];
  let inList = false;
  let tableRows: string[][] = [];

  const flushList = () => {
    if (inList) {
      htmlParts.push("</ul>");
      inList = false;
    }
  };

  const flushTable = () => {
    if (tableRows.length === 0) return;
    const header = tableRows[0]!;
    const body = tableRows
      .slice(1)
      .filter((r) => !r.every((cell) => /^:?-{2,}:?$/.test(cell.trim())));
    htmlParts.push(
      "<table><thead><tr>" +
        header.map((c) => `<th>${formatInlineMarkdown(c)}</th>`).join("") +
        "</tr></thead><tbody>" +
        body
          .map(
            (r) => "<tr>" + r.map((c) => `<td>${formatInlineMarkdown(c)}</td>`).join("") + "</tr>"
          )
          .join("") +
        "</tbody></table>"
    );
    tableRows = [];
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      flushList();
      const cells = trimmed
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      tableRows.push(cells);
      continue;
    }
    flushTable();

    if (!trimmed) {
      flushList();
      continue;
    }

    if (trimmed.startsWith("### ")) {
      flushList();
      htmlParts.push(`<h3>${formatInlineMarkdown(trimmed.slice(4))}</h3>`);
    } else if (trimmed.startsWith("## ")) {
      flushList();
      htmlParts.push(`<h2>${formatInlineMarkdown(trimmed.slice(3))}</h2>`);
    } else if (trimmed.startsWith("# ")) {
      flushList();
      htmlParts.push(`<h1>${formatInlineMarkdown(trimmed.slice(2))}</h1>`);
    } else if (trimmed.startsWith("> ")) {
      flushList();
      htmlParts.push(`<blockquote>${formatInlineMarkdown(trimmed.slice(2))}</blockquote>`);
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      if (!inList) {
        htmlParts.push("<ul>");
        inList = true;
      }
      htmlParts.push(`<li>${formatInlineMarkdown(trimmed.slice(2))}</li>`);
    } else {
      flushList();
      htmlParts.push(`<p>${formatInlineMarkdown(trimmed)}</p>`);
    }
  }

  flushList();
  flushTable();
  return htmlParts.join("\n");
}

function buildPrintCss(fmt: ExportFormattingSettings): string {
  const safeFont = escapeHtml(fmt.font);
  return `
    @page {
      size: A4;
      margin: ${fmt.marginsMm}mm;
    }
    body {
      font-family: "${safeFont}", Georgia, "Times New Roman", serif;
      font-size: ${fmt.fontSizePt}pt;
      line-height: ${lineHeightCss(fmt.lineSpacing)};
      color: #111111;
      margin: 0;
    }
    .page-break { page-break-before: always; break-before: page; }
    .cover-page {
      min-height: 230mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      text-align: center;
      padding: 18mm 0;
    }
    .cover-title { font-size: 20pt; font-weight: 700; line-height: 1.3; text-transform: uppercase; }
    .cover-meta { font-size: 12pt; line-height: 1.8; }
    h1 { font-size: 16pt; font-weight: 700; margin: 0 0 12pt 0; }
    h2 { font-size: 13.5pt; font-weight: 700; margin: 16pt 0 8pt 0; }
    h3 { font-size: 12pt; font-weight: 700; margin: 12pt 0 6pt 0; }
    p { margin: 0 0 10pt 0; text-align: left; }
    blockquote {
      margin: 10pt 0 10pt 16pt;
      padding-left: 10pt;
      border-left: 2pt solid #555555;
      font-size: ${Math.max(10, fmt.fontSizePt - 1)}pt;
    }
    ul { margin: 0 0 10pt 18pt; padding: 0; }
    li { margin-bottom: 4pt; }
    table { width: 100%; border-collapse: collapse; margin: 12pt 0; font-size: 10pt; line-height: 1.35; }
    th, td { border: 0.75pt solid #444444; padding: 5pt 7pt; text-align: left; }
    th { background: #f2f2f2; font-weight: 700; }
    .toc-row { display: flex; justify-content: space-between; border-bottom: 0.5pt dotted #888888; padding: 4pt 0; }
    .ref-item { padding-left: 12mm; text-indent: -12mm; margin-bottom: 8pt; }
  `;
}

export function buildFrontMatterHtml(doc: ThesisExportDocument, tocEntries: TocEntry[]): string {
  const fm = doc.formatting.frontMatter;
  const cover = doc.formatting.cover;
  const blocks: string[] = [];

  if (fm.coverPage) {
    blocks.push(`<section class="cover-page">
      <div class="cover-meta">
        <div><strong>${escapeHtml(cover.institution || "[Institution Name]")}</strong></div>
        ${cover.department ? `<div>${escapeHtml(cover.department)}</div>` : ""}
      </div>
      <div class="cover-title">${escapeHtml(doc.projectTitle)}</div>
      <div class="cover-meta">
        <div><strong>${escapeHtml(cover.authorName || "[Author Name]")}</strong></div>
        <div>${escapeHtml(doc.workTypeLabel)}${doc.level ? ` · ${escapeHtml(doc.level)}` : ""}</div>
        ${cover.supervisor ? `<div>Supervisor: ${escapeHtml(cover.supervisor)}</div>` : ""}
        <div>${escapeHtml(cover.submissionDate || new Date().getUTCFullYear().toString())}</div>
      </div>
    </section>`);
  }

  if (fm.certification) {
    blocks.push(`<section class="page-break">
      <h1>Certification / Declaration</h1>
      <p>I declare that this ${escapeHtml(doc.workTypeLabel.toLowerCase())} titled "${escapeHtml(doc.projectTitle)}" was prepared and verified by ${escapeHtml(cover.authorName || "[Author Name]")} in accordance with departmental guidelines.</p>
      <p style="margin-top: 28pt;">Signature: ____________________________ &nbsp;&nbsp; Date: ________________</p>
    </section>`);
  }

  if (fm.dedication) {
    blocks.push(`<section class="page-break">
      <h1>Dedication</h1>
      <p>[Add your personal dedication here.]</p>
    </section>`);
  }

  if (fm.acknowledgements) {
    blocks.push(`<section class="page-break">
      <h1>Acknowledgements</h1>
      <p>Grateful acknowledgement is extended to ${escapeHtml(cover.supervisor || "my supervisor")}, faculty mentors, and all researchers whose verified works informed this study.</p>
    </section>`);
  }

  if (fm.preface) {
    blocks.push(`<section class="page-break">
      <h1>Preface</h1>
      <p>This work examines ${escapeHtml(doc.projectTitle)} through evidence-bound synthesis of verified scholarly and institutional records.</p>
    </section>`);
  }

  if (fm.abstract) {
    blocks.push(`<section class="page-break">
      <h1>Abstract</h1>
      <p>${escapeHtml(doc.abstractText?.trim() || `This ${doc.workTypeLabel.toLowerCase()} investigates ${doc.projectTitle} using verified scholarly literature and structured chapter analysis.`)}</p>
    </section>`);
  }

  if (fm.tableOfContents) {
    const rows = tocEntries
      .map(
        (entry) =>
          `<div class="toc-row"><span><strong>${escapeHtml(entry.label)}</strong> ${escapeHtml(entry.title)}</span><span>${entry.pageNumber}</span></div>`
      )
      .join("\n");
    blocks.push(`<section class="page-break">
      <h1>Table of Contents</h1>
      ${rows}
    </section>`);
  }

  if (fm.listOfFiguresAndTables) {
    blocks.push(`<section class="page-break">
      <h1>List of Figures and Tables</h1>
      <p>Tables and figures appear in their respective results and analysis chapters.</p>
    </section>`);
  }

  if (blocks.length === 0) return "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(doc.projectTitle)} — Front Matter</title>
    <style>${buildPrintCss(doc.formatting)}</style>
  </head>
  <body>${blocks.join("\n")}</body>
</html>`;
}

export function buildChapterHtmlDocument(
  chapter: ExportChapterContent,
  formatting: ExportFormattingSettings
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Chapter ${chapter.number}: ${escapeHtml(chapter.title)}</title>
    <style>${buildPrintCss(formatting)}</style>
  </head>
  <body>
    <article>${markdownToPrintHtml(chapter.markdown)}</article>
  </body>
</html>`;
}

export function buildReferencesHtmlDocument(
  bibliographyEntries: string[],
  formatting: ExportFormattingSettings,
  appendicesMarkdown?: string
): string {
  const refItems = bibliographyEntries
    .map((entry) => `<p class="ref-item">${escapeHtml(entry)}</p>`)
    .join("\n");

  const appendixBlock =
    formatting.frontMatter.appendices && appendicesMarkdown?.trim()
      ? `<section class="page-break"><h1>Appendices</h1>${markdownToPrintHtml(appendicesMarkdown)}</section>`
      : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>References</title>
    <style>${buildPrintCss(formatting)}</style>
  </head>
  <body>
    <section>
      <h1>References</h1>
      ${refItems || "<p>No cited references recorded yet.</p>"}
    </section>
    ${appendixBlock}
  </body>
</html>`;
}
