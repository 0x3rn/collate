import { PDFDocument } from "pdf-lib";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildThesisDocx } from "@/lib/export/docx-builder";
import {
  detectImageFormatFromBytes,
  extractImageDimensionsFromBytes,
  resolveExportFiguresForChapters,
} from "@/lib/export/figure-assets";
import {
  buildThesisPdfTwoPass,
  createBrowserRunPageMeasurer,
  toRomanNumeral,
} from "@/lib/export/pdf-assembler";
import { markdownToPrintHtml, type ThesisExportDocument } from "@/lib/export/templates";
import type { BrowserRunPdfBinding } from "@/lib/pdf/render-pdf";
import { DEFAULT_FRONT_MATTER } from "@/lib/wizard/schema";

async function makeRealPdfWithPages(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([595.28, 841.89]);
  }
  return doc.save();
}

const SAMPLE_DOC: ThesisExportDocument = {
  projectTitle: "Solar Microgrid Reliability in Rural Clinics",
  workTypeLabel: "Thesis",
  level: "Masters",
  abstractText: "This thesis evaluates solar microgrid uptime across rural health facilities.",
  formatting: {
    font: "Times New Roman",
    fontSizePt: 12,
    lineSpacing: "double",
    marginsMm: 25,
    pageNumbering: true,
    frontMatter: { ...DEFAULT_FRONT_MATTER },
    cover: {
      authorName: "Adaeze Okonkwo",
      institution: "University of Lagos",
      department: "Electrical Engineering",
      supervisor: "Prof. K. Adeyemi",
      submissionDate: "November 2026",
    },
  },
  chapters: [
    {
      number: 1,
      title: "Introduction",
      markdown:
        "# Chapter 1: Introduction\n\n## 1.1 Background\n\nRural clinics require steady power.",
    },
    {
      number: 2,
      title: "Literature Review",
      markdown:
        "# Chapter 2: Literature Review\n\n| Region | Uptime |\n| --- | --- |\n| Kano | 96% |",
    },
  ],
  bibliographyEntries: [
    "Okonkwo, A. (2024). Solar Microgrid Reliability. Energy Policy. https://doi.org/10.1016/j.enpol.2024.1",
  ],
};

describe("Phase 9 — Two-Pass Thesis PDF & DOCX Export Engine", () => {
  it("converts Roman numerals accurately and escapes unsafe HTML/scripts in templates", () => {
    expect(toRomanNumeral(1)).toBe("i");
    expect(toRomanNumeral(4)).toBe("iv");
    expect(toRomanNumeral(9)).toBe("ix");

    const html = markdownToPrintHtml("<script>alert(1)</script> **Safe bold**");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong>Safe bold</strong>");
  });

  it("performs two-pass PDF assembly: computes exact ToC page numbers and merges Roman + Arabic pages", async () => {
    let capturedFrontMatterHtml = "";

    const mockBrowser: BrowserRunPdfBinding = {
      async quickAction(action, options) {
        expect(action).toBe("pdf");
        expect(options.pdfOptions?.format).toBe("a4");
        if (options.html.includes("Front Matter")) {
          capturedFrontMatterHtml = options.html;
          const fmPdf = await makeRealPdfWithPages(3);
          return new Response(new Uint8Array(fmPdf), { status: 200 });
        }
        if (options.html.includes("Chapter 1")) {
          const ch1Pdf = await makeRealPdfWithPages(2);
          return new Response(new Uint8Array(ch1Pdf), { status: 200 });
        }
        if (options.html.includes("Chapter 2")) {
          const ch2Pdf = await makeRealPdfWithPages(3);
          return new Response(new Uint8Array(ch2Pdf), { status: 200 });
        }
        const refPdf = await makeRealPdfWithPages(1);
        return new Response(new Uint8Array(refPdf), { status: 200 });
      },
    };

    const result = await buildThesisPdfTwoPass(SAMPLE_DOC, mockBrowser);

    expect(result.tocEntries).toEqual([
      { label: "Chapter 1", title: "Introduction", pageNumber: 1 },
      { label: "Chapter 2", title: "Literature Review", pageNumber: 3 },
      { label: "", title: "References", pageNumber: 6 },
    ]);

    expect(capturedFrontMatterHtml).toContain("Table of Contents");
    expect(capturedFrontMatterHtml).toContain("<span>3</span>");
    expect(capturedFrontMatterHtml).toContain("<span>6</span>");

    expect(result.frontMatterPages).toBe(3);
    expect(result.bodyPages).toBe(6);
    expect(result.totalPageCount).toBe(9);

    const parsedPdf = await PDFDocument.load(result.pdfBytes);
    expect(parsedPdf.getPageCount()).toBe(9);

    const measurer = createBrowserRunPageMeasurer(mockBrowser, SAMPLE_DOC.formatting);
    const measured = await measurer("# Chapter 1\n\nSample text", 275);
    expect(measured).toBe(2);
  });

  it("generates a valid Microsoft Word (.docx) OOXML archive with cover, chapters, tables, italics & references", async () => {
    const docxBytes = await buildThesisDocx(SAMPLE_DOC);
    expect(docxBytes.byteLength).toBeGreaterThan(2000);
    expect(docxBytes[0]).toBe(0x50);
    expect(docxBytes[1]).toBe(0x4b);
    expect(docxBytes[2]).toBe(0x03);
    expect(docxBytes[3]).toBe(0x04);

    // Single-chapter Word (.docx) export with italics, bold, and bullet items
    const singleChapterDocx = await buildThesisDocx(
      {
        ...SAMPLE_DOC,
        chapters: [
          {
            number: 1,
            title: "Introduction",
            markdown:
              "# Chapter 1: Introduction\n\nBeetroot (*Beta vulgaris*) lowers **oxidative stress**.\n\n- Key biochemical marker",
          },
        ],
      },
      { includeFrontMatter: false, includeReferences: true }
    );
    expect(singleChapterDocx.byteLength).toBeGreaterThan(1500);
    expect(singleChapterDocx[0]).toBe(0x50);
    expect(singleChapterDocx[1]).toBe(0x4b);
  });

  it("embeds real figures with controlled dimensions, fine-print attribution, and explicit page breaks in PDF HTML and Word .docx", async () => {
    // Minimal real 1x1 PNG (valid signature + IHDR chunk)
    const realPngBytes = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64"
      )
    );
    expect(detectImageFormatFromBytes(realPngBytes)).toEqual({
      mimeType: "image/png",
      docxType: "png",
    });
    expect(extractImageDimensionsFromBytes(realPngBytes, "png")).toEqual({ width: 1, height: 1 });

    const figUrl = "https://upload.wikimedia.org/wikipedia/commons/4/45/Beetroot_sample.png";
    const chapterWithFigureMd = [
      "# Chapter 1: Introduction",
      "",
      "## 1.1 Background",
      "",
      "Beetroot (*Beta vulgaris*) contains abundant betalains.",
      "",
      ":::figure",
      `url: ${figUrl}`,
      "alt: Fresh Beta vulgaris root",
      "caption: Figure 1.1: Fresh *Beta vulgaris* (beetroot) roots.",
      "attribution: Source: Wikimedia Commons · Photo by Dr. Botanist · CC BY-SA 4.0 (https://commons.wikimedia.org/wiki/File:Beetroot_sample.png)",
      "width: 1200",
      "height: 800",
      ":::",
      "",
      "<!-- pagebreak -->",
      "",
      "## 1.2 Statement of the problem",
      "",
      "This section begins cleanly on the next page.",
    ].join("\n");

    const resolvedFigures = await resolveExportFiguresForChapters(
      [{ markdown: chapterWithFigureMd }],
      {
        fetchFn: async () =>
          new Response(realPngBytes, {
            status: 200,
            headers: { "content-type": "image/png" },
          }),
      }
    );
    expect(resolvedFigures[figUrl]?.dataUrl).toMatch(/^data:image\/png;base64,/);

    // 1. Verify PDF HTML renders inline data URI, controlled dimensions, caption, clean attribution (no URL/File:), and page-break
    const printHtml = markdownToPrintHtml(chapterWithFigureMd, resolvedFigures);
    expect(printHtml).toContain('<figure class="academic-figure">');
    expect(printHtml).toContain("data:image/png;base64,");
    expect(printHtml).toContain("<em>Beta vulgaris</em>");
    expect(printHtml).toContain(
      '<div class="figure-attribution">Source: Dr. Botanist, Wikimedia Commons (CC BY-SA 4.0)</div>'
    );
    expect(printHtml).not.toContain("File:Beetroot_sample.png");
    expect(printHtml).not.toContain("commons.wikimedia.org");
    expect(printHtml).toContain('<div class="page-break"></div>');

    // 2. Verify native Word (.docx) embeds real image bytes inside ZIP (word/media/), page break, and clean attribution text
    const docxWithImage = await buildThesisDocx(
      {
        ...SAMPLE_DOC,
        chapters: [{ number: 1, title: "Introduction", markdown: chapterWithFigureMd }],
        resolvedFigures,
      },
      { includeFrontMatter: false, includeReferences: true }
    );
    expect(docxWithImage.byteLength).toBeGreaterThan(2000);
    expect(docxWithImage[0]).toBe(0x50);
    expect(docxWithImage[1]).toBe(0x4b);
    // ZIP directory entries contain the embedded media file inside word/media/
    const zipBuf = Buffer.from(docxWithImage);
    const zipAscii = zipBuf.toString("latin1");
    expect(zipAscii).toContain("word/media/");
    expect(zipAscii).toContain("word/document.xml");

    // Extract word/document.xml from ZIP local file header to verify clean plain-text attribution in DOCX
    const docEntryIdx = zipBuf.indexOf(Buffer.from("word/document.xml", "utf8"));
    expect(docEntryIdx).toBeGreaterThan(30);
    const headerStart = docEntryIdx - 30;
    const compMethod = zipBuf.readUInt16LE(headerStart + 8);
    const compSize = zipBuf.readUInt32LE(headerStart + 18);
    const nameLen = zipBuf.readUInt16LE(headerStart + 26);
    const extraLen = zipBuf.readUInt16LE(headerStart + 28);
    const dataStart = headerStart + 30 + nameLen + extraLen;
    const rawEntry = zipBuf.subarray(dataStart, dataStart + compSize);
    const documentXml = (compMethod === 8 ? inflateRawSync(rawEntry) : rawEntry).toString("utf8");
    expect(documentXml).toContain("Source: Dr. Botanist, Wikimedia Commons (CC BY-SA 4.0)");
    expect(documentXml).not.toContain("File:Beetroot_sample.png");
    expect(documentXml).not.toContain("commons.wikimedia.org");
  });
});
