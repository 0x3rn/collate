import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PageSize } from "@/db/schema";
import { hasPdfMagicHeader, type BrowserRunPdfBinding } from "@/lib/pdf/render-pdf";
import type { MeasurePagesFn } from "@/lib/writing/section-pipeline";
import { getPageSizeSpec } from "./page-sizes";
import {
  buildChapterHtmlDocument,
  buildCombinedBodyHtmlDocument,
  buildFrontMatterHtml,
  buildReferencesHtmlDocument,
  type ExportFormattingSettings,
  type ThesisExportDocument,
  type TocEntry,
} from "./templates";

export class PdfRenderRateLimitError extends Error {
  public readonly retryAfterSeconds?: number;
  constructor(message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "PdfRenderRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const DEFAULT_RETRY_DELAYS_MS = [2000, 4500] as const;

function parseRetryAfterMs(header: string | null, fallbackMs: number): number {
  if (!header) return fallbackMs;
  const trimmed = header.trim();
  const asSeconds = Number(trimmed);
  if (Number.isFinite(asSeconds) && asSeconds > 0) {
    return Math.min(10_000, Math.max(500, Math.round(asSeconds * 1000)));
  }
  const parsedDate = Date.parse(trimmed);
  if (Number.isFinite(parsedDate)) {
    const delta = parsedDate - Date.now();
    if (delta > 0) {
      return Math.min(10_000, Math.max(500, delta));
    }
  }
  return fallbackMs;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  marginsMm: number,
  pageSize: PageSize = "a4",
  sleepFn: (ms: number) => Promise<void> = defaultSleep
): Promise<Uint8Array> {
  const marginStr = `${marginsMm}mm`;
  const spec = getPageSizeSpec(pageSize);
  const maxAttempts = DEFAULT_RETRY_DELAYS_MS.length + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const res = await browser.quickAction("pdf", {
      html,
      pdfOptions: {
        format: spec.pdfFormat,
        printBackground: true,
        displayHeaderFooter: false,
        margin: { top: marginStr, right: marginStr, bottom: marginStr, left: marginStr },
      },
    });

    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!hasPdfMagicHeader(bytes)) {
        throw new Error("Browser Run /pdf returned non-PDF output");
      }
      return bytes;
    }

    const errText = await res.text().catch(() => "");
    const retryable =
      res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
    const delayMs = DEFAULT_RETRY_DELAYS_MS[attempt];

    if (retryable && delayMs !== undefined) {
      const waitMs = parseRetryAfterMs(res.headers.get("retry-after"), delayMs);
      await sleepFn(waitMs);
      continue;
    }

    if (res.status === 429) {
      const retrySec = Math.ceil(parseRetryAfterMs(res.headers.get("retry-after"), 15_000) / 1000);
      throw new PdfRenderRateLimitError(
        `Browser Run /pdf failed (HTTP 429): ${errText.slice(0, 200)}`,
        retrySec
      );
    }

    throw new Error(`Browser Run /pdf failed (HTTP ${res.status}): ${errText.slice(0, 200)}`);
  }

  throw new Error("Browser Run /pdf failed after retries");
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
  options: {
    includeFrontMatter?: boolean;
    includeReferences?: boolean;
    sleepFn?: (ms: number) => Promise<void>;
  } = {}
): Promise<TwoPassPdfResult> {
  const includeFrontMatter = options.includeFrontMatter ?? true;
  const includeReferences = options.includeReferences ?? true;
  const useChapters = doc.useChapters ?? true;
  const sleepFn = options.sleepFn ?? defaultSleep;
  const needsExactTocPageNumbers = includeFrontMatter && doc.formatting.frontMatter.tableOfContents;

  const bodyPdfs: Uint8Array[] = [];
  const tocEntries: TocEntry[] = [];
  let runningArabicPage = 1;

  if (!needsExactTocPageNumbers) {
    // Fast single-pass render: batches chapter(s) + References in 1 Browser Run /pdf call
    // instead of 2-7 sequential calls, avoiding Cloudflare Browser Rendering rate limits.
    const combinedHtml = buildCombinedBodyHtmlDocument(doc, { includeReferences });
    const bytes = await renderHtmlViaBrowserRun(
      browser,
      combinedHtml,
      doc.formatting.marginsMm,
      doc.formatting.pageSize,
      sleepFn
    );
    bodyPdfs.push(bytes);
  } else {
    for (const ch of doc.chapters) {
      const html = buildChapterHtmlDocument(ch, doc.formatting, doc.resolvedFigures, useChapters);
      const bytes = await renderHtmlViaBrowserRun(
        browser,
        html,
        doc.formatting.marginsMm,
        doc.formatting.pageSize,
        sleepFn
      );
      const pages = await countPdfPages(bytes);

      tocEntries.push({
        label: useChapters ? `Chapter ${ch.number}` : `${ch.number}.`,
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
      const refBytes = await renderHtmlViaBrowserRun(
        browser,
        refHtml,
        doc.formatting.marginsMm,
        doc.formatting.pageSize,
        sleepFn
      );

      tocEntries.push({
        label: "",
        title: "References",
        pageNumber: runningArabicPage,
      });
      bodyPdfs.push(refBytes);
    }
  }

  let frontMatterPdf: Uint8Array | null = null;
  if (includeFrontMatter) {
    const fmHtml = buildFrontMatterHtml(doc, tocEntries);
    if (fmHtml) {
      frontMatterPdf = await renderHtmlViaBrowserRun(
        browser,
        fmHtml,
        doc.formatting.marginsMm,
        doc.formatting.pageSize,
        sleepFn
      );
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
    const pdfBytes = await renderHtmlViaBrowserRun(
      browser,
      html,
      formatting.marginsMm,
      formatting.pageSize
    );
    return countPdfPages(pdfBytes);
  };
}
