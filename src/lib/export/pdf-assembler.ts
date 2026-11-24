import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { hasPdfMagicHeader, type BrowserRunPdfBinding } from "@/lib/pdf/render-pdf";
import type { MeasurePagesFn } from "@/lib/writing/section-pipeline";
import {
  buildChapterHtmlDocument,
  buildFrontMatterHtml,
  buildReferencesHtmlDocument,
  type ExportFormattingSettings,
  type ThesisExportDocument,
  type TocEntry,
} from "./templates";

export function toRomanNumeral(num: number): string {
  if (num <= 0) return "";
  const pairs: Array<[number, string]> = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let remaining = num;
  let out = "";
  for (const [val, sym] of pairs) {
    while (remaining >= val) {
      out += sym;
      remaining -= val;
    }
  }
  return out;
}

async function renderHtmlViaBrowserRun(
  browser: BrowserRunPdfBinding,
  html: string,
  marginsMm: number
): Promise<Uint8Array> {
  const marginStr = `${marginsMm}mm`;
  const res = await browser.quickAction("pdf", {
    html,
    pdfOptions: {
      format: "a4",
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: marginStr, right: marginStr, bottom: marginStr, left: marginStr },
    },
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Browser Run /pdf failed (HTTP ${res.status}): ${errText.slice(0, 200)}`);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!hasPdfMagicHeader(bytes)) {
    throw new Error("Browser Run /pdf returned non-PDF output");
  }
  return bytes;
}

export async function countPdfPages(pdfBytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(pdfBytes);
  return doc.getPageCount();
}

export async function mergeAndNumberThesisPdfs(params: {
  frontMatterPdf: Uint8Array | null;
  bodyPdfs: Uint8Array[];
  pageNumbering: boolean;
  skipFirstFrontPageNumber?: boolean;
}): Promise<{
  pdfBytes: Uint8Array;
  totalPageCount: number;
  frontMatterPages: number;
  bodyPages: number;
}> {
  const merged = await PDFDocument.create();
  const font = await merged.embedFont(StandardFonts.TimesRoman);

  let frontMatterPages = 0;
  if (params.frontMatterPdf) {
    const fmDoc = await PDFDocument.load(params.frontMatterPdf);
    const copiedPages = await merged.copyPages(fmDoc, fmDoc.getPageIndices());
    copiedPages.forEach((page, idx) => {
      frontMatterPages++;
      if (params.pageNumbering && !(params.skipFirstFrontPageNumber && idx === 0)) {
        const label = toRomanNumeral(idx + 1);
        const { width } = page.getSize();
        const textWidth = font.widthOfTextAtSize(label, 10);
        page.drawText(label, {
          x: (width - textWidth) / 2,
          y: 24,
          size: 10,
          font,
          color: rgb(0.25, 0.25, 0.25),
        });
      }
      merged.addPage(page);
    });
  }

  let bodyPages = 0;
  for (const bodyBytes of params.bodyPdfs) {
    const bodyDoc = await PDFDocument.load(bodyBytes);
    const copiedPages = await merged.copyPages(bodyDoc, bodyDoc.getPageIndices());
    for (const page of copiedPages) {
      bodyPages++;
      if (params.pageNumbering) {
        const label = String(bodyPages);
        const { width } = page.getSize();
        const textWidth = font.widthOfTextAtSize(label, 10);
        page.drawText(label, {
          x: (width - textWidth) / 2,
          y: 24,
          size: 10,
          font,
          color: rgb(0.25, 0.25, 0.25),
        });
      }
      merged.addPage(page);
    }
  }

  const pdfBytes = await merged.save();
  return {
    pdfBytes,
    totalPageCount: merged.getPageCount(),
    frontMatterPages,
    bodyPages,
  };
}

export interface TwoPassPdfResult {
  pdfBytes: Uint8Array;
  totalPageCount: number;
  frontMatterPages: number;
  bodyPages: number;
  tocEntries: TocEntry[];
}

export async function buildThesisPdfTwoPass(
  doc: ThesisExportDocument,
  browser: BrowserRunPdfBinding,
  options: { includeFrontMatter?: boolean; includeReferences?: boolean } = {}
): Promise<TwoPassPdfResult> {
  const includeFrontMatter = options.includeFrontMatter ?? true;
  const includeReferences = options.includeReferences ?? true;

  const bodyPdfs: Uint8Array[] = [];
  const tocEntries: TocEntry[] = [];
  let runningArabicPage = 1;

  for (const ch of doc.chapters) {
    const html = buildChapterHtmlDocument(ch, doc.formatting, doc.resolvedFigures);
    const bytes = await renderHtmlViaBrowserRun(browser, html, doc.formatting.marginsMm);
    const pages = await countPdfPages(bytes);

    tocEntries.push({
      label: `Chapter ${ch.number}`,
      title: ch.title,
      pageNumber: runningArabicPage,
    });
    runningArabicPage += pages;
    bodyPdfs.push(bytes);
  }

  if (includeReferences && doc.bibliographyEntries.length > 0) {
    const refHtml = buildReferencesHtmlDocument(
      doc.bibliographyEntries,
      doc.formatting,
      doc.appendicesMarkdown
    );
    const refBytes = await renderHtmlViaBrowserRun(browser, refHtml, doc.formatting.marginsMm);

    tocEntries.push({
      label: "",
      title: "References",
      pageNumber: runningArabicPage,
    });
    bodyPdfs.push(refBytes);
  }

  let frontMatterPdf: Uint8Array | null = null;
  if (includeFrontMatter) {
    const fmHtml = buildFrontMatterHtml(doc, tocEntries);
    if (fmHtml) {
      frontMatterPdf = await renderHtmlViaBrowserRun(browser, fmHtml, doc.formatting.marginsMm);
    }
  }

  const merged = await mergeAndNumberThesisPdfs({
    frontMatterPdf,
    bodyPdfs,
    pageNumbering: doc.formatting.pageNumbering,
    skipFirstFrontPageNumber: doc.formatting.frontMatter.coverPage,
  });

  return {
    ...merged,
    tocEntries,
  };
}

export function createBrowserRunPageMeasurer(
  browser: BrowserRunPdfBinding,
  formatting: ExportFormattingSettings
): MeasurePagesFn {
  return async (markdown: string) => {
    const html = buildChapterHtmlDocument({ number: 1, title: "Measure", markdown }, formatting);
    const pdfBytes = await renderHtmlViaBrowserRun(browser, html, formatting.marginsMm);
    return countPdfPages(pdfBytes);
  };
}
