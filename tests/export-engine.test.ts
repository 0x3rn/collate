import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildThesisDocx } from "@/lib/export/docx-builder";
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

  it("generates a valid Microsoft Word (.docx) OOXML archive with cover, chapters, tables & references", async () => {
    const docxBytes = await buildThesisDocx(SAMPLE_DOC);
    expect(docxBytes.byteLength).toBeGreaterThan(2000);
    expect(docxBytes[0]).toBe(0x50);
    expect(docxBytes[1]).toBe(0x4b);
    expect(docxBytes[2]).toBe(0x03);
    expect(docxBytes[3]).toBe(0x04);
  });
});
