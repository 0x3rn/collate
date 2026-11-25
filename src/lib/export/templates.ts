import type { LineSpacing, PageSize } from "@/db/schema";
import type { CoverDetails, FrontMatterToggles } from "@/lib/wizard/schema";
import { parseMarkdownToBlocks } from "@/lib/writing/editor-blocks";
import type { ResolvedExportFigureAsset } from "./figure-assets";
import {
  computeControlledFigureDimensions,
  formatFigureAttributionForDisplay,
} from "./figure-layout";
import { keepWordsTogether } from "./keep-together";
import { getPageSizeSpec } from "./page-sizes";

export interface ExportFormattingSettings {
  font: string;
  fontSizePt: number;
  lineSpacing: LineSpacing;
  marginsMm: number;
  pageSize?: PageSize;
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
  resolvedFigures?: Record<string, ResolvedExportFigureAsset>;
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
  const escaped = escapeHtml(keepWordsTogether(raw));
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export function markdownToPrintHtml(
  markdown: string,
  resolvedFigures?: Record<string, ResolvedExportFigureAsset>
): string {
  const blocks = parseMarkdownToBlocks(markdown);
  const htmlParts: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "page_break": {
        htmlParts.push('<div class="page-break"></div>');
        break;
      }
      case "heading": {
        const tag =
          block.level === 1 ? "h1" : block.level === 2 ? "h2" : block.level === 3 ? "h3" : "h4";
        htmlParts.push(`<${tag}>${formatInlineMarkdown(block.text)}</${tag}>`);
        break;
      }
      case "paragraph": {
        htmlParts.push(
          block.text.trim().length === 0
            ? '<p class="blank-line">&nbsp;</p>'
            : `<p>${formatInlineMarkdown(block.text)}</p>`
        );
        break;
      }
      case "blockquote": {
        htmlParts.push(`<blockquote>${formatInlineMarkdown(block.text)}</blockquote>`);
        break;
      }
      case "bullet_list": {
        htmlParts.push(
          "<ul>" +
            block.items.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join("") +
            "</ul>"
        );
        break;
      }
      case "table": {
        const rows = block.raw
          .split(/\r?\n/)
          .map((line) =>
            line
              .trim()
              .slice(1, -1)
              .split("|")
              .map((c) => c.trim())
          )
          .filter((r) => r.length > 0);
        if (rows.length === 0) break;
        const header = rows[0]!;
        const body = rows
          .slice(1)
          .filter((r) => !r.every((cell) => /^:?-{2,}:?$/.test(cell.trim())));
        htmlParts.push(
          "<table><thead><tr>" +
            header.map((c) => `<th>${formatInlineMarkdown(c)}</th>`).join("") +
            "</tr></thead><tbody>" +
            body
              .map(
                (r) =>
                  "<tr>" + r.map((c) => `<td>${formatInlineMarkdown(c)}</td>`).join("") + "</tr>"
              )
              .join("") +
            "</tbody></table>"
        );
        break;
      }
      case "figure": {
        const asset = resolvedFigures?.[block.figure.url];
        const captionHtml = `<div class="figure-caption">${formatInlineMarkdown(block.figure.caption)}</div>`;
        const cleanAttr = formatFigureAttributionForDisplay(
          block.figure.attribution,
          block.figure.sourceUrl
        ).displayText;
        const attrHtml = cleanAttr
          ? `<div class="figure-attribution">${escapeHtml(cleanAttr)}</div>`
          : "";

        // Never hot-link an external image into the PDF renderer: if the figure could not be
        // fetched and embedded, a remote <img> can hang the renderer until it times out and
        // fails the whole export. Degrade to caption + attribution instead.
        if (!asset) {
          htmlParts.push(
            `<figure class="academic-figure"><figcaption>${captionHtml}${attrHtml}</figcaption></figure>`
          );
          break;
        }

        const natW = asset.naturalWidth ?? block.figure.width;
        const natH = asset.naturalHeight ?? block.figure.height;
        const dims = computeControlledFigureDimensions(natW, natH, {
          maxWidthPx: 560,
          maxHeightPx: 370,
        });

        htmlParts.push(
          `<figure class="academic-figure">` +
            `<img src="${asset.dataUrl}" alt="${escapeHtml(block.figure.alt)}" width="${dims.widthPx}" height="${dims.heightPx}" style="width:${dims.widthPx}px;max-width:100%;height:auto;max-height:105mm;" />` +
            `<figcaption>${captionHtml}${attrHtml}</figcaption>` +
            `</figure>`
        );
        break;
      }
    }
  }

  return htmlParts.join("\n");
}

function buildPrintCss(fmt: ExportFormattingSettings): string {
  const safeFont = escapeHtml(fmt.font);
  const pageSpec = getPageSizeSpec(fmt.pageSize);
  return `
    @page {
      size: ${pageSpec.cssPageSize};
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
    figure.academic-figure {
      margin: 16pt auto;
      text-align: center;
      page-break-inside: avoid;
      break-inside: avoid;
    }
    figure.academic-figure img {
      display: block;
      margin: 0 auto;
      max-width: 100%;
      max-height: 105mm;
      width: auto;
      height: auto;
      object-fit: contain;
    }
    figure.academic-figure figcaption {
      margin-top: 6pt;
      text-align: center;
    }
    figure.academic-figure .figure-caption {
      font-size: 10pt;
      color: #111111;
      line-height: 1.4;
    }
    figure.academic-figure .figure-attribution {
      margin-top: 2pt;
      font-size: 8pt;
      color: #555555;
      line-height: 1.35;
      word-break: break-word;
    }
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
    h4 { font-size: 11.5pt; font-weight: 700; margin: 10pt 0 4pt 0; }
    p { margin: 0 0 10pt 0; text-align: left; }
    p.blank-line { margin: 0 0 10pt 0; min-height: 1em; }
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
    <title>${escapeHtml(doc.projectTitle)} | Front Matter</title>
    <style>${buildPrintCss(doc.formatting)}</style>
  </head>
  <body>${blocks.join("\n")}</body>
</html>`;
}

export function buildChapterHtmlDocument(
  chapter: ExportChapterContent,
  formatting: ExportFormattingSettings,
  resolvedFigures?: Record<string, ResolvedExportFigureAsset>
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Chapter ${chapter.number}: ${escapeHtml(chapter.title)}</title>
    <style>${buildPrintCss(formatting)}</style>
  </head>
  <body>
    <article>${markdownToPrintHtml(chapter.markdown, resolvedFigures)}</article>
  </body>
</html>`;
}

export function buildReferencesHtmlDocument(
  bibliographyEntries: string[],
  formatting: ExportFormattingSettings,
  appendicesMarkdown?: string
): string {
  const refItems = bibliographyEntries
    .map((entry) => `<p class="ref-item">${escapeHtml(keepWordsTogether(entry))}</p>`)
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

/**
 * Builds a single self-contained HTML print document containing all target chapters
 * and optional References/Appendices separated by explicit print page breaks.
 * Used whenever a Table of Contents page-number pass is not needed (single-chapter
 * and combined exports), cutting Cloudflare Browser Rendering API calls down to 1.
 */
export function buildCombinedBodyHtmlDocument(
  doc: ThesisExportDocument,
  options: { includeReferences?: boolean } = {}
): string {
  const includeReferences = options.includeReferences ?? true;
  const sectionsHtml: string[] = [];

  doc.chapters.forEach((ch, idx) => {
    const breakClass = idx > 0 ? ' class="page-break"' : "";
    sectionsHtml.push(
      `<article${breakClass}>${markdownToPrintHtml(ch.markdown, doc.resolvedFigures)}</article>`
    );
  });

  if (includeReferences && doc.bibliographyEntries.length > 0) {
    const refItems = doc.bibliographyEntries
      .map((entry) => `<p class="ref-item">${escapeHtml(keepWordsTogether(entry))}</p>`)
      .join("\n");
    sectionsHtml.push(`<section class="page-break"><h1>References</h1>${refItems}</section>`);

    if (doc.formatting.frontMatter.appendices && doc.appendicesMarkdown?.trim()) {
      sectionsHtml.push(
        `<section class="page-break"><h1>Appendices</h1>${markdownToPrintHtml(doc.appendicesMarkdown)}</section>`
      );
    }
  }

  const title =
    doc.chapters.length === 1
      ? `Chapter ${doc.chapters[0]!.number}: ${doc.chapters[0]!.title}`
      : doc.projectTitle;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>${buildPrintCss(doc.formatting)}</style>
  </head>
  <body>
    ${sectionsHtml.join("\n")}
  </body>
</html>`;
}
