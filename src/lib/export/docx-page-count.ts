import { inflateRawSync } from "node:zlib";

/**
 * Page count for a finished Word (.docx) file.
 *
 * Word decides where pages end only when a file is opened, so the export cannot ask Word.
 * Instead this lays the document out the way Word does, from what is stored in the file:
 * the page size and margins, each paragraph's font, size, line spacing, spacing before and
 * after, and indents, real image heights, page breaks, headings kept with the next
 * paragraph, and paragraphs that split across pages. Text width per line is estimated from
 * the font's average character width, so the result is an estimate, usually within a page.
 *
 * Used for new Word exports and to correct the count stored on older ones.
 */

const ZIP_END_OF_CENTRAL_DIR = 0x06054b50;
const ZIP_CENTRAL_DIR_ENTRY = 0x02014b50;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;

/** Reads one file out of a ZIP archive (a .docx is a ZIP) using its central directory. */
export function readZipEntryText(zipBytes: Uint8Array, entryName: string): string {
  const buf = Buffer.from(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);

  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === ZIP_END_OF_CENTRAL_DIR) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP archive: end of central directory not found.");

  const entryCount = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);

  for (let n = 0; n < entryCount; n++) {
    if (buf.readUInt32LE(ptr) !== ZIP_CENTRAL_DIR_ENTRY) {
      throw new Error("Corrupt ZIP central directory.");
    }
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.toString("utf8", ptr + 46, ptr + 46 + nameLen);

    if (name === entryName) {
      if (buf.readUInt32LE(localOffset) !== ZIP_LOCAL_FILE_HEADER) {
        throw new Error(`Corrupt ZIP local header for ${entryName}.`);
      }
      const localNameLen = buf.readUInt16LE(localOffset + 26);
      const localExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const raw = buf.subarray(dataStart, dataStart + compSize);
      if (method === 0) return raw.toString("utf8");
      if (method === 8) return inflateRawSync(raw).toString("utf8");
      throw new Error(`Unsupported ZIP compression method ${method} for ${entryName}.`);
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  throw new Error(`${entryName} not found in archive.`);
}

/** Word's single line height is about 1.15 × the font size for common body fonts. */
const SINGLE_LINE_FACTOR = 1.15;
/** One EMU (image size unit) = 1/635 twip. */
const EMU_PER_TWIP = 635;
/** Characters lost per line to wrapping whole words (about half an average word). */
const WRAP_LOSS_CHARS = 3;
const DEFAULT_SIZE_HALF_PT = 24;

/** Average character width of running English text, as a fraction of the font size. */
function averageCharWidthEm(font: string | undefined): number {
  const f = (font ?? "").toLowerCase();
  if (f.includes("times")) return 0.4;
  if (f.includes("garamond")) return 0.38;
  if (f.includes("calibri")) return 0.42;
  if (f.includes("cambria")) return 0.44;
  if (f.includes("arial") || f.includes("helvetica")) return 0.47;
  if (f.includes("georgia") || f.includes("verdana")) return 0.48;
  return 0.43;
}

function attrNumber(xml: string, tag: string, attr: string): number | null {
  const el = xml.match(new RegExp(`<${tag}\\b[^>]*>`));
  if (!el) return null;
  const val = el[0].match(new RegExp(`\\b${attr}="(-?\\d+)"`));
  return val ? Number(val[1]) : null;
}

function decodeXmlText(raw: string): string {
  return raw
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function paragraphText(paragraphXml: string): string {
  const parts: string[] = [];
  for (const m of paragraphXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)) {
    parts.push(decodeXmlText(m[1] ?? ""));
  }
  return parts.join("");
}

function largestRunSizeHalfPt(xml: string): number {
  const sizes = [...xml.matchAll(/<w:sz w:val="(\d+)"\/>/g)].map((m) => Number(m[1]));
  return sizes.length > 0 ? Math.max(...sizes) : DEFAULT_SIZE_HALF_PT;
}

interface PageGeometry {
  bodyHeight: number;
  textWidth: number;
}

function readPageGeometry(documentXml: string): PageGeometry {
  const sect = documentXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/)?.[0] ?? "";
  const pageW = attrNumber(sect, "w:pgSz", "w:w") ?? 11906;
  const pageH = attrNumber(sect, "w:pgSz", "w:h") ?? 16838;
  const top = Math.abs(attrNumber(sect, "w:pgMar", "w:top") ?? 1440);
  const bottom = Math.abs(attrNumber(sect, "w:pgMar", "w:bottom") ?? 1440);
  const left = attrNumber(sect, "w:pgMar", "w:left") ?? 1440;
  const right = attrNumber(sect, "w:pgMar", "w:right") ?? 1440;
  return {
    bodyHeight: Math.max(2000, pageH - top - bottom),
    textWidth: Math.max(2000, pageW - left - right),
  };
}

/** Number of wrapped lines a run of text needs at a given width. */
function wrappedLines(text: string, widthTwips: number, sizeHalfPt: number, font?: string): number {
  const charTwips = (sizeHalfPt / 2) * 20 * averageCharWidthEm(font);
  const charsPerLine = Math.max(10, Math.floor(widthTwips / charTwips) - WRAP_LOSS_CHARS);
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

/** Lays out a document.xml body page by page and returns the number of pages. */
export function estimatePageCountFromDocxXml(documentXml: string): number {
  const { bodyHeight, textWidth } = readPageGeometry(documentXml);
  const body = documentXml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] ?? "";

  let page = 1;
  let y = 0; // twips used on the current page
  const newPage = () => {
    page += 1;
    y = 0;
  };

  for (const m of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\/>|<w:p[\s>][\s\S]*?<\/w:p>/g)) {
    const xml = m[0];

    if (xml.startsWith("<w:tbl>")) {
      const columns = Math.max(1, (xml.match(/<w:gridCol\b/g) ?? []).length);
      for (const row of xml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? []) {
        let rowLines = 1;
        let rowSize = DEFAULT_SIZE_HALF_PT;
        for (const cell of row.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) ?? []) {
          const size = largestRunSizeHalfPt(cell);
          const font = cell.match(/<w:rFonts w:ascii="([^"]+)"/)?.[1];
          const cellWidth = textWidth / columns - 216; // default cell padding both sides
          rowLines = Math.max(rowLines, wrappedLines(paragraphText(cell), cellWidth, size, font));
          rowSize = Math.max(rowSize, size);
        }
        const rowHeight = rowLines * (rowSize / 2) * 20 * SINGLE_LINE_FACTOR + 60;
        if (y > 0 && y + rowHeight > bodyHeight) newPage();
        y += rowHeight;
      }
      continue;
    }

    const pPr = xml.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? "";
    const sizeHalfPt = largestRunSizeHalfPt(xml);
    const font = xml.match(/<w:rFonts w:ascii="([^"]+)"/)?.[1];
    const lineRule = attrNumber(pPr, "w:spacing", "w:line") ?? 240;
    const before = attrNumber(pPr, "w:spacing", "w:before") ?? 0;
    const after = attrNumber(pPr, "w:spacing", "w:after") ?? 0;
    const indentLeft = Math.max(0, attrNumber(pPr, "w:ind", "w:left") ?? 0);
    const lineHeight = (sizeHalfPt / 2) * 20 * SINGLE_LINE_FACTOR * (lineRule / 240);
    const isHeading = /<w:pStyle w:val="Heading\d"\/>/.test(pPr);
    const text = paragraphText(xml);

    // A paragraph that holds only a page break ends the page; its empty paragraph mark
    // then sits on the first line of the next page, as in Word.
    if (/<w:br w:type="page"\/>/.test(xml) && !text.trim()) {
      newPage();
      y += lineHeight;
      continue;
    }

    const extent = xml.match(/<wp:extent cx="\d+" cy="(\d+)"\/>/);
    if (extent) {
      const imageHeight = Math.min(bodyHeight, Number(extent[1]) / EMU_PER_TWIP);
      const blockHeight = before + imageHeight + after;
      if (y > 0 && y + blockHeight > bodyHeight) newPage();
      y += blockHeight;
      continue;
    }

    const lines = wrappedLines(text, textWidth - indentLeft, sizeHalfPt, font);

    if (isHeading) {
      // Headings are kept with the first two lines of the paragraph that follows them.
      const keepTogether = before + lines * lineHeight + after + 2 * lineHeight;
      if (y > 0 && y + keepTogether > bodyHeight) newPage();
    }

    y += y > 0 ? before : 0;
    let remaining = lines;
    // Orphan control: never leave a single first line of a longer paragraph at the bottom.
    if (lines >= 2 && y > 0 && bodyHeight - y < 2 * lineHeight) newPage();
    while (remaining > 0) {
      const fit = Math.floor((bodyHeight - y) / lineHeight);
      if (fit <= 0) {
        newPage();
        continue;
      }
      const placed = Math.min(fit, remaining);
      y += placed * lineHeight;
      remaining -= placed;
      if (remaining > 0) newPage();
    }
    y += after;
  }

  return page;
}

/** Estimated page count of a saved or freshly built .docx file. */
export function estimatePageCountFromDocxBytes(docxBytes: Uint8Array): number {
  return estimatePageCountFromDocxXml(readZipEntryText(docxBytes, "word/document.xml"));
}
