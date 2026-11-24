import type { FormattedCitationCluster } from "@/lib/citations/reader-format";
import {
  formatFigureAttributionForDisplay,
  isSafeAcademicImageUrl,
} from "@/lib/export/figure-layout";

export const PAGE_BREAK_TOKEN = "<!-- pagebreak -->";
export const SPACER_TOKEN = "<!-- spacer -->";

export interface AcademicFigureData {
  url: string;
  alt: string;
  caption: string;
  attribution: string;
  sourceUrl?: string;
  width?: number;
  height?: number;
}

export type ChapterDocBlock =
  | { id: string; type: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { id: string; type: "paragraph"; text: string }
  | { id: string; type: "bullet_list"; items: string[] }
  | { id: string; type: "blockquote"; text: string }
  | { id: string; type: "table"; raw: string }
  | { id: string; type: "page_break" }
  | { id: string; type: "figure"; figure: AcademicFigureData };

function makeBlockId(index: number): string {
  return `blk_${index + 1}`;
}

export function formatFigureBlockMarkdown(figure: AcademicFigureData): string {
  const formattedAttr = formatFigureAttributionForDisplay(figure.attribution, figure.sourceUrl);
  const lines = [
    ":::figure",
    `url: ${figure.url.trim()}`,
    `alt: ${figure.alt.trim() || figure.caption.trim() || "Academic figure"}`,
    `caption: ${figure.caption.trim() || figure.alt.trim() || "Figure"}`,
    `attribution: ${formattedAttr.displayText || "Source verified"}`,
  ];
  if (formattedAttr.sourceUrl && isSafeAcademicImageUrl(formattedAttr.sourceUrl)) {
    lines.push(`sourceUrl: ${formattedAttr.sourceUrl}`);
  }
  if (typeof figure.width === "number" && Number.isFinite(figure.width) && figure.width > 0) {
    lines.push(`width: ${Math.round(figure.width)}`);
  }
  if (typeof figure.height === "number" && Number.isFinite(figure.height) && figure.height > 0) {
    lines.push(`height: ${Math.round(figure.height)}`);
  }
  lines.push(":::");
  return lines.join("\n");
}

function parseFigureLines(lines: string[]): AcademicFigureData | null {
  const fields: Record<string, string> = {};
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const val = line.slice(colonIdx + 1).trim();
    if (key && val) {
      fields[key] = val;
    }
  }
  const url = fields.url ?? "";
  if (!isSafeAcademicImageUrl(url)) return null;

  const widthNum = fields.width ? Number.parseInt(fields.width, 10) : undefined;
  const heightNum = fields.height ? Number.parseInt(fields.height, 10) : undefined;
  const rawSourceUrl = fields.sourceurl || fields.source_url || fields.sourcepageurl;
  const formattedAttr = formatFigureAttributionForDisplay(fields.attribution || "", rawSourceUrl);

  return {
    url,
    alt: fields.alt || fields.caption || "Academic figure",
    caption: fields.caption || fields.alt || "Figure",
    attribution: formattedAttr.displayText,
    ...(formattedAttr.sourceUrl ? { sourceUrl: formattedAttr.sourceUrl } : {}),
    ...(widthNum && Number.isFinite(widthNum) && widthNum > 0 ? { width: widthNum } : {}),
    ...(heightNum && Number.isFinite(heightNum) && heightNum > 0 ? { height: heightNum } : {}),
  };
}

/**
 * Parses chapter Markdown (including headings, paragraphs, bullet lists, tables,
 * explicit `<!-- pagebreak -->` markers, and `:::figure ... :::` blocks) into structured blocks.
 */
export function parseMarkdownToBlocks(markdown: string): ChapterDocBlock[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: ChapterDocBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i]!;
    const trimmed = rawLine.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Explicit page break marker
    if (/^<!--\s*page-?break\s*-->$/i.test(trimmed)) {
      blocks.push({ id: makeBlockId(blocks.length), type: "page_break" });
      i++;
      continue;
    }

    // Explicit blank spacing line (created by pressing Enter to push content down)
    if (/^<!--\s*spacer\s*-->$/i.test(trimmed)) {
      blocks.push({ id: makeBlockId(blocks.length), type: "paragraph", text: "" });
      i++;
      continue;
    }

    // Fenced academic figure block :::figure ... :::
    if (/^:::figure\b/i.test(trimmed)) {
      const figLines: string[] = [];
      i++;
      while (i < lines.length && lines[i]!.trim() !== ":::") {
        figLines.push(lines[i]!);
        i++;
      }
      if (i < lines.length && lines[i]!.trim() === ":::") {
        i++;
      }
      const figure = parseFigureLines(figLines);
      if (figure) {
        blocks.push({ id: makeBlockId(blocks.length), type: "figure", figure });
      }
      continue;
    }

    // Single-line standard Markdown image fallback: ![caption](https://...)
    const mdImgMatch = trimmed.match(/^!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)$/);
    if (mdImgMatch) {
      const caption = mdImgMatch[1]?.trim() || "Figure";
      const url = mdImgMatch[2]?.trim() || "";
      if (isSafeAcademicImageUrl(url)) {
        blocks.push({
          id: makeBlockId(blocks.length),
          type: "figure",
          figure: { url, alt: caption, caption, attribution: "" },
        });
      }
      i++;
      continue;
    }

    // Markdown headings (supports #, ##, ###, #### and normalizes #####/###### to level 4)
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = Math.min(4, headingMatch[1]!.length) as 1 | 2 | 3 | 4;
      blocks.push({
        id: makeBlockId(blocks.length),
        type: "heading",
        level,
        text: headingMatch[2]!.trim(),
      });
      i++;
      continue;
    }

    // Markdown table block
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length) {
        const t = lines[i]!.trim();
        if (t.startsWith("|") && t.endsWith("|")) {
          tableLines.push(t);
          i++;
        } else {
          break;
        }
      }
      blocks.push({
        id: makeBlockId(blocks.length),
        type: "table",
        raw: tableLines.join("\n"),
      });
      continue;
    }

    // Bullet list block
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const t = lines[i]!.trim();
        if (/^[-*]\s+/.test(t)) {
          items.push(t.replace(/^[-*]\s+/, "").trim());
          i++;
        } else {
          break;
        }
      }
      blocks.push({ id: makeBlockId(blocks.length), type: "bullet_list", items });
      continue;
    }

    // Blockquote block
    if (trimmed.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("> ")) {
        quoteLines.push(lines[i]!.trim().slice(2).trim());
        i++;
      }
      blocks.push({
        id: makeBlockId(blocks.length),
        type: "blockquote",
        text: quoteLines.join(" "),
      });
      continue;
    }

    // Paragraph block (consume consecutive non-special lines)
    const paraLines: string[] = [];
    while (i < lines.length) {
      const t = lines[i]!.trim();
      if (
        !t ||
        /^<!--\s*page-?break\s*-->$/i.test(t) ||
        /^<!--\s*spacer\s*-->$/i.test(t) ||
        /^:::figure\b/i.test(t) ||
        /^!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)$/.test(t) ||
        /^#{1,6}\s+/.test(t) ||
        (t.startsWith("|") && t.endsWith("|")) ||
        /^[-*]\s+/.test(t) ||
        t.startsWith("> ")
      ) {
        break;
      }
      paraLines.push(t);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({
        id: makeBlockId(blocks.length),
        type: "paragraph",
        text: paraLines.join(" "),
      });
    }
  }

  return blocks;
}

/**
 * Serializes structured editor blocks cleanly back into canonical Markdown.
 */
export function serializeBlocksToMarkdown(blocks: ChapterDocBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "heading": {
        const text = block.text.trim();
        if (!text) break;
        const prefix = "#".repeat(block.level);
        parts.push(`${prefix} ${text}`);
        break;
      }
      case "paragraph": {
        const text = block.text.trim();
        parts.push(text ? text : SPACER_TOKEN);
        break;
      }
      case "bullet_list": {
        const cleanItems = block.items.map((item) => item.trim()).filter(Boolean);
        if (cleanItems.length > 0) {
          parts.push(cleanItems.map((item) => `- ${item}`).join("\n"));
        }
        break;
      }
      case "blockquote": {
        const text = block.text.trim();
        if (text) parts.push(`> ${text}`);
        break;
      }
      case "table": {
        const raw = block.raw.trim();
        if (raw) parts.push(raw);
        break;
      }
      case "page_break": {
        parts.push(PAGE_BREAK_TOKEN);
        break;
      }
      case "figure": {
        if (isSafeAcademicImageUrl(block.figure.url)) {
          parts.push(formatFigureBlockMarkdown(block.figure));
        }
        break;
      }
    }
  }
  return parts.join("\n\n");
}

function estimateBlockWordWeight(block: ChapterDocBlock, wordsPerPage: number): number {
  switch (block.type) {
    case "heading":
      return Math.max(12, block.text.trim().split(/\s+/).filter(Boolean).length + 8);
    case "paragraph": {
      const words = block.text.trim().split(/\s+/).filter(Boolean).length;
      // Blank line pushed via Enter occupies ~1 vertical line on an academic page (~22 lines/page)
      return words > 0 ? words : Math.max(10, Math.round(wordsPerPage / 22));
    }
    case "blockquote":
      return block.text.trim().split(/\s+/).filter(Boolean).length;
    case "bullet_list":
      return block.items.reduce(
        (sum, item) => sum + item.trim().split(/\s+/).filter(Boolean).length + 4,
        0
      );
    case "table":
      return Math.round(wordsPerPage * 0.25);
    case "figure":
      return Math.round(wordsPerPage * 0.42);
    case "page_break":
      return 0;
  }
}

/**
 * Computes approximate page numbers (1-indexed) for each block in Read & Edit views.
 * Explicit `page_break` blocks immediately advance the next block onto `page + 1`.
 */
export function computeBlockPageNumbers(blocks: ChapterDocBlock[], wordsPerPage = 275): number[] {
  const safeWpp = Math.max(150, wordsPerPage);
  const pages: number[] = [];
  let currentPage = 1;
  let wordsOnCurrentPage = 0;

  for (const block of blocks) {
    if (block.type === "page_break") {
      pages.push(currentPage);
      currentPage += 1;
      wordsOnCurrentPage = 0;
      continue;
    }

    const weight = estimateBlockWordWeight(block, safeWpp);
    if (wordsOnCurrentPage > 0 && wordsOnCurrentPage + weight > safeWpp * 1.08) {
      currentPage += 1;
      wordsOnCurrentPage = 0;
    }

    pages.push(currentPage);
    wordsOnCurrentPage += weight;
  }

  return pages;
}

function escapeEditorHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Renders inline Markdown (`**bold**`, `*italic*`, and `[@citeKey]` tokens) into safe
 * contentEditable HTML where citation markers are protected non-editable chips.
 */
export function inlineMarkdownToEditableHtml(
  markdown: string,
  citationClusters?: Record<string, FormattedCitationCluster>,
  singleKeyLabels?: Record<string, string>
): string {
  const parts = markdown.split(/(\[@[^\]]+\])/g);
  return parts
    .map((part) => {
      if (part.startsWith("[@") && part.endsWith("]")) {
        const cluster = citationClusters?.[part];
        const firstKey =
          cluster?.citeKeys[0] ??
          part.slice(1, -1).split(";")[0]?.replace(/^@/, "").split(",")[0]?.trim() ??
          "";
        const displayLabel = cluster?.label ?? singleKeyLabels?.[firstKey] ?? part;
        return `<span contenteditable="false" data-cite-token="${escapeEditorHtml(part)}" class="inline-block px-1 py-[1px] text-[0.93em] rounded-[4px] bg-[var(--accent-100)]/80 text-[var(--accent-700)] select-none align-baseline">${escapeEditorHtml(displayLabel)}</span>`;
      }

      const escaped = escapeEditorHtml(part);
      return escaped
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^*]+)\*/g, "<em>$1</em>");
    })
    .join("");
}

export interface MinimalDomNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes?: ArrayLike<MinimalDomNode>;
  getAttribute?(name: string): string | null;
}

/**
 * Walks a contentEditable DOM element (or minimal DOM node tree in unit tests) and
 * converts it cleanly back to inline Markdown, preserving every `data-cite-token` chip verbatim.
 */
export function serializeEditableNodeToMarkdown(root: MinimalDomNode): string {
  function walk(node: MinimalDomNode): string {
    // Text node (Node.TEXT_NODE === 3)
    if (node.nodeType === 3) {
      return (node.textContent ?? "").replace(/\u00A0/g, " ");
    }

    // Element node (Node.ELEMENT_NODE === 1)
    if (node.nodeType === 1) {
      const citeToken = node.getAttribute?.("data-cite-token");
      if (citeToken) {
        return citeToken;
      }

      const tag = node.nodeName.toUpperCase();
      if (tag === "BR") {
        return " ";
      }

      let inner = "";
      const children = node.childNodes;
      if (children) {
        for (let i = 0; i < children.length; i++) {
          inner += walk(children[i]!);
        }
      }

      if (!inner) return "";

      const styleAttr = (node.getAttribute?.("style") ?? "").toLowerCase();
      const isBold =
        tag === "STRONG" ||
        tag === "B" ||
        (tag === "SPAN" && /font-weight\s*:\s*(bold|[6-9]00)/.test(styleAttr));
      const isItalic =
        tag === "EM" ||
        tag === "I" ||
        (tag === "SPAN" && /font-style\s*:\s*italic/.test(styleAttr));

      if (isBold && isItalic) {
        const trimmed = inner.trim();
        if (!trimmed) return inner;
        const lead = inner.match(/^\s*/)?.[0] ?? "";
        const trail = inner.match(/\s*$/)?.[0] ?? "";
        return `${lead}***${trimmed}***${trail}`;
      }
      if (isBold) {
        const trimmed = inner.trim();
        if (!trimmed) return inner;
        if (trimmed.startsWith("**") && trimmed.endsWith("**") && trimmed.length > 4) {
          return inner;
        }
        const lead = inner.match(/^\s*/)?.[0] ?? "";
        const trail = inner.match(/\s*$/)?.[0] ?? "";
        return `${lead}**${trimmed}**${trail}`;
      }
      if (isItalic) {
        const trimmed = inner.trim();
        if (!trimmed) return inner;
        if (
          trimmed.startsWith("*") &&
          trimmed.endsWith("*") &&
          !trimmed.startsWith("**") &&
          trimmed.length > 2
        ) {
          return inner;
        }
        const lead = inner.match(/^\s*/)?.[0] ?? "";
        const trail = inner.match(/\s*$/)?.[0] ?? "";
        return `${lead}*${trimmed}*${trail}`;
      }
      if (tag === "DIV" || tag === "P") {
        return `${inner} `;
      }
      return inner;
    }

    return "";
  }

  let out = "";
  const children = root.childNodes;
  if (children) {
    for (let i = 0; i < children.length; i++) {
      out += walk(children[i]!);
    }
  }
  return out.replace(/[ ]{2,}/g, " ").trim();
}
