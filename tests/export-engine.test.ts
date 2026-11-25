import { PDFDocument } from "pdf-lib";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildThesisDocx } from "@/lib/export/docx-builder";
import {
  estimatePageCountFromDocxBytes,
  estimatePageCountFromDocxXml,
  readZipEntryText,
} from "@/lib/export/docx-page-count";
import {
  detectImageFormatFromBytes,
  extractImageDimensionsFromBytes,
  resolveExportFiguresForChapters,
} from "@/lib/export/figure-assets";
import {
  buildThesisPdfTwoPass,
  createBrowserRunPageMeasurer,
  PdfRenderRateLimitError,
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

  it("batches single-chapter + references PDF into 1 Browser Run call and retries transient HTTP 429 cleanly", async () => {
    let calls = 0;
    let capturedHtml = "";
    const sleptMs: number[] = [];

    const flakeySinglePassBrowser: BrowserRunPdfBinding = {
      async quickAction(_action, options) {
        calls += 1;
        capturedHtml = options.html;
        if (calls === 1) {
          return new Response(
            '{"success":false,"errors":[{"code":2001,"message":"Rate limit exceeded"}]}',
            {
              status: 429,
              headers: { "retry-after": "2" },
            }
          );
        }
        const pdf = await makeRealPdfWithPages(4);
        return new Response(new Uint8Array(pdf), { status: 200 });
      },
    };

    const singleChapterDoc: ThesisExportDocument = {
      ...SAMPLE_DOC,
      chapters: [SAMPLE_DOC.chapters[0]!],
    };

    const result = await buildThesisPdfTwoPass(singleChapterDoc, flakeySinglePassBrowser, {
      includeFrontMatter: false,
      includeReferences: true,
      sleepFn: async (ms) => {
        sleptMs.push(ms);
      },
    });

    // Only 1 logical PDF render (attempted twice due to the simulated 429), combining Chapter + References
    expect(calls).toBe(2);
    expect(sleptMs).toEqual([2000]);
    expect(capturedHtml).toContain("Chapter 1: Introduction");
    expect(capturedHtml).toContain("<h1>References</h1>");
    expect(capturedHtml).toContain('class="page-break"');
    expect(result.totalPageCount).toBe(4);

    // Persistent 429 throws PdfRenderRateLimitError after bounded retries
    let always429Calls = 0;
    const always429Browser: BrowserRunPdfBinding = {
      async quickAction() {
        always429Calls += 1;
        return new Response(
          '{"success":false,"errors":[{"code":2001,"message":"Rate limit exceeded"}]}',
          {
            status: 429,
          }
        );
      },
    };
    await expect(
      buildThesisPdfTwoPass(singleChapterDoc, always429Browser, {
        includeFrontMatter: false,
        includeReferences: true,
        sleepFn: async () => {},
      })
    ).rejects.toBeInstanceOf(PdfRenderRateLimitError);
    expect(always429Calls).toBe(3);
  });
});

function readDocxEntry(docxBytes: Uint8Array, entryName: string): string {
  const zipBuf = Buffer.from(docxBytes);
  const nameIdx = zipBuf.indexOf(Buffer.from(entryName, "utf8"));
  if (nameIdx < 30) throw new Error(`${entryName} not found in .docx archive`);
  const headerStart = nameIdx - 30;
  const compMethod = zipBuf.readUInt16LE(headerStart + 8);
  const compSize = zipBuf.readUInt32LE(headerStart + 18);
  const nameLen = zipBuf.readUInt16LE(headerStart + 26);
  const extraLen = zipBuf.readUInt16LE(headerStart + 28);
  const dataStart = headerStart + 30 + nameLen + extraLen;
  const rawEntry = zipBuf.subarray(dataStart, dataStart + compSize);
  return (compMethod === 8 ? inflateRawSync(rawEntry) : rawEntry).toString("utf8");
}

function wordsParagraph(wordCount: number): string {
  return Array.from({ length: wordCount }, (_, i) => `word${i}`).join(" ");
}

const chapterOnly = (
  markdown: string,
  overrides: Partial<ThesisExportDocument["formatting"]> = {}
): ThesisExportDocument => ({
  ...SAMPLE_DOC,
  formatting: { ...SAMPLE_DOC.formatting, ...overrides },
  chapters: [{ number: 1, title: "Introduction", markdown }],
  bibliographyEntries: [],
});

describe("Word (.docx) pages", () => {
  it("writes real Word pages: page size, Light edit page breaks, and a PAGE number footer", async () => {
    const md = [
      "# Chapter 1: Introduction",
      "First page text.",
      "<!-- pagebreak -->",
      "## 1.1 Moved to the next page",
      "Second page text.",
    ].join("\n\n");
    const bytes = await buildThesisDocx(chapterOnly(md, { pageSize: "letter" }), {
      includeFrontMatter: false,
    });
    const documentXml = readDocxEntry(bytes, "word/document.xml");
    expect(documentXml.match(/<w:br w:type="page"\/>/g)?.length).toBe(1);
    expect(documentXml).toContain('<w:pgSz w:w="12240" w:h="15840"');
    expect(documentXml).toContain('<w:footerReference w:type="default"');
    expect(readDocxEntry(bytes, "word/footer1.xml")).toContain(">PAGE</w:instrText>");

    const noNumbers = await buildThesisDocx(chapterOnly(md, { pageNumbering: false }), {
      includeFrontMatter: false,
    });
    expect(readDocxEntry(noNumbers, "word/document.xml")).not.toContain("w:footerReference");
  });
});

describe("Word (.docx) page count layout", () => {
  // A4 with 25 mm margins: body 14004 twips tall, 9072 wide. Times New Roman 12 pt fits
  // 91 characters per line; double spacing is 552 twips per line, so 25 lines per page.
  const A4 =
    '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/>';
  const LETTER =
    '<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>';
  const run = (text: string) =>
    `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman"/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;
  const para = (lines: number, lineRule = 480) =>
    `<w:p><w:pPr><w:spacing w:line="${lineRule}"/></w:pPr>${run("x".repeat(91 * lines))}</w:p>`;
  const heading = (text: string) =>
    `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>${run(text)}</w:p>`;
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const image = (heightTwips: number) =>
    `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="4572000" cy="${heightTwips * 635}"/></wp:inline></w:drawing></w:r></w:p>`;
  const doc = (page: string, ...items: string[]) =>
    `<w:document><w:body>${items.join("")}<w:sectPr>${page}</w:sectPr></w:body></w:document>`;

  it("splits a long paragraph across pages like Word, instead of moving it whole", () => {
    expect(estimatePageCountFromDocxXml(doc(A4, para(25)))).toBe(1);
    expect(estimatePageCountFromDocxXml(doc(A4, para(26)))).toBe(2);
    expect(estimatePageCountFromDocxXml(doc(A4, para(20), para(10)))).toBe(2);
    expect(estimatePageCountFromDocxXml(doc(A4, para(50)))).toBe(2);
    expect(estimatePageCountFromDocxXml(doc(A4, para(51)))).toBe(3);
  });

  it("follows the file's line spacing and page size", () => {
    expect(estimatePageCountFromDocxXml(doc(A4, para(30)))).toBe(2);
    expect(estimatePageCountFromDocxXml(doc(A4, para(30, 240)))).toBe(1);
    // US Letter with 1 inch margins holds 23 double-spaced lines of 94 characters.
    expect(estimatePageCountFromDocxXml(doc(A4, para(48)))).toBe(2);
    expect(estimatePageCountFromDocxXml(doc(LETTER, para(48)))).toBe(3);
  });

  it("starts a new page at every page break, including a trailing one, as Word shows it", () => {
    expect(estimatePageCountFromDocxXml(doc(A4, para(1), pageBreak, para(1)))).toBe(2);
    expect(estimatePageCountFromDocxXml(doc(A4, para(1), pageBreak))).toBe(2);
    expect(estimatePageCountFromDocxXml(doc(A4, para(1), pageBreak, pageBreak, para(1)))).toBe(3);
    expect(estimatePageCountFromDocxXml(doc(A4))).toBe(1);
  });

  it("keeps a heading with the next paragraph and never splits an image", () => {
    expect(estimatePageCountFromDocxXml(doc(A4, para(24), para(1)))).toBe(1);
    expect(estimatePageCountFromDocxXml(doc(A4, para(24), heading("1.2 Next"), para(1)))).toBe(2);
    expect(estimatePageCountFromDocxXml(doc(A4, para(10), image(5400)))).toBe(1);
    expect(estimatePageCountFromDocxXml(doc(A4, para(20), image(5400)))).toBe(2);
  });

  it("counts a full export: cover, abstract, each chapter and references on their own pages", async () => {
    expect(estimatePageCountFromDocxBytes(await buildThesisDocx(SAMPLE_DOC))).toBe(5);
    expect(
      estimatePageCountFromDocxBytes(
        await buildThesisDocx(SAMPLE_DOC, { includeFrontMatter: false })
      )
    ).toBe(3);
  });

  it("gives more pages for more text, larger type and looser spacing", async () => {
    const chapter = `# Chapter 1\n\n${Array.from({ length: 10 }, () => wordsParagraph(240)).join("\n\n")}`;
    const count = async (f: Partial<ThesisExportDocument["formatting"]>) =>
      estimatePageCountFromDocxBytes(
        await buildThesisDocx(chapterOnly(chapter, f), { includeFrontMatter: false })
      );
    const double12 = await count({});
    expect(double12).toBeGreaterThanOrEqual(9);
    expect(double12).toBeLessThanOrEqual(13);
    expect(await count({ lineSpacing: "one_half" })).toBeLessThan(double12);
    expect(await count({ lineSpacing: "single" })).toBeLessThan(
      await count({ lineSpacing: "one_half" })
    );
    expect(await count({ fontSizePt: 14 })).toBeGreaterThan(double12);
  });

  it("reads files whether stored compressed or not, and rejects non-Word files", async () => {
    const bytes = await buildThesisDocx(SAMPLE_DOC);
    expect(readZipEntryText(bytes, "word/document.xml")).toContain("<w:body>");
    expect(() => readZipEntryText(bytes, "word/missing.xml")).toThrow(/not found/);
    expect(() => estimatePageCountFromDocxBytes(new TextEncoder().encode("not a zip"))).toThrow(
      /Not a ZIP archive/
    );
  });
});

describe("Exports keep short words and citation pieces on one line", () => {
  const md =
    "# Chapter 1\n\nThis is a test of *A dose* response (Smith et al., 2020, p. 12; Darvish, Ludwig and Ikoba, 2024).";

  it("writes non-breaking spaces into the Word file", async () => {
    const bytes = await buildThesisDocx(
      {
        ...SAMPLE_DOC,
        chapters: [{ number: 1, title: "Intro", markdown: md }],
        bibliographyEntries: ["Smith, J. et al. (2020) A study of beetroot, pp. 3–5."],
      },
      { includeFrontMatter: false }
    );
    const xml = readDocxEntry(bytes, "word/document.xml");
    expect(xml).toContain("is a test of ");
    expect(xml).toContain(">A dose<");
    expect(xml).toContain("Smith et al., 2020, p. 12");
    expect(xml).toContain("Darvish, Ludwig and Ikoba, 2024");
    expect(xml).toContain("Smith, J. et al. (2020) A study of beetroot, pp. 3–5.");
  });

  it("writes the same non-breaking spaces into the PDF page", () => {
    const html = markdownToPrintHtml(md);
    expect(html).toContain("is a test of <em>A dose</em>");
    expect(html).toContain("Smith et al., 2020, p. 12");
  });
});
