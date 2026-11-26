import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { HeadingColor } from "@/db/schema";
import { buildThesisDocx } from "@/lib/export/docx-builder";
import { readZipEntryText } from "@/lib/export/docx-page-count";
import {
  headingColorHex,
  headingSizePt,
  wordHeadingSpacingTwips,
} from "@/lib/export/heading-style";
import { buildChapterHtmlDocument, type ThesisExportDocument } from "@/lib/export/templates";
import { DEFAULT_FRONT_MATTER, WizardStep7FormattingSchema } from "@/lib/wizard/schema";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: unknown }) =>
    createElement("a", { href }, children as never),
}));

const MARKDOWN = [
  "# Chapter 1: Introduction",
  "## 1.1 Background of the Study",
  "Rural clinics need steady power.",
  "### 1.1.1 Gaps",
  "Evidence is thin.",
].join("\n\n");

function doc(headingColor?: HeadingColor, fontSizePt = 12): ThesisExportDocument {
  return {
    projectTitle: "Solar Microgrids",
    workTypeLabel: "Project",
    formatting: {
      font: "Times New Roman",
      fontSizePt,
      lineSpacing: "double",
      marginsMm: 25,
      pageSize: "a4",
      pageNumbering: true,
      ...(headingColor ? { headingColor } : {}),
      frontMatter: { ...DEFAULT_FRONT_MATTER, coverPage: false, abstract: false },
      cover: {
        authorName: "",
        institution: "",
        department: "",
        supervisor: "",
        submissionDate: "",
      },
    },
    chapters: [{ number: 1, title: "Introduction", markdown: MARKDOWN }],
    bibliographyEntries: [],
  };
}

async function wordXml(d: ThesisExportDocument) {
  const bytes = await buildThesisDocx(d, { includeFrontMatter: false, includeReferences: false });
  return {
    document: readZipEntryText(bytes, "word/document.xml") ?? "",
    styles: readZipEntryText(bytes, "word/styles.xml") ?? "",
  };
}

/** Spacing before/after from a paragraph's properties, whatever the attribute order. */
function spacing(pPr: string): { before: string | null; after: string | null } {
  const tag = pPr.match(/<w:spacing [^>]*\/>/)?.[0] ?? "";
  return {
    before: tag.match(/w:before="(\d+)"/)?.[1] ?? null,
    after: tag.match(/w:after="(\d+)"/)?.[1] ?? null,
  };
}

/** Paragraph properties of the paragraph using the given heading style. */
function headingPPr(documentXml: string, styleId: string): string {
  const match = documentXml.match(
    new RegExp(`<w:pPr><w:pStyle w:val="${styleId}"\\/>[\\s\\S]*?<\\/w:pPr>`)
  );
  return match?.[0] ?? "";
}

/** The run colour inside a heading style definition in styles.xml. */
function styleColor(stylesXml: string, styleId: string): string | null {
  const style = stylesXml.match(
    new RegExp(`<w:style [^>]*w:styleId="${styleId}"[\\s\\S]*?<\\/w:style>`)
  )?.[0];
  return style?.match(/<w:color w:val="([0-9A-Fa-f]{6})"/)?.[1] ?? null;
}

describe("heading rules", () => {
  it("steps heading sizes from the body size, matching the original PDF at 12pt", () => {
    expect([1, 2, 3, 4].map((l) => headingSizePt(l as 1 | 2 | 3 | 4, 12))).toEqual([
      16, 13.5, 12, 11.5,
    ]);
    expect(headingSizePt(1, 10)).toBe(14);
    expect(headingSizePt(4, 14)).toBe(13.5);
  });

  it("defaults to black and never falls back to another colour", () => {
    expect(headingColorHex(undefined)).toBe("000000");
    expect(headingColorHex("black")).toBe("000000");
    expect(headingColorHex("blue")).toBe("1F3864");
  });

  // These values were checked in Word 365 against the PDF printed by Chromium: heading text
  // lands within 0.5pt of the PDF position at 10pt single, 11pt 1.5, 12pt single/double and
  // 14pt double. Change them only after re-measuring both.
  it("gives Word the spacing that reproduces the PDF heading positions", () => {
    expect(wordHeadingSpacingTwips(1, 12, "double")).toEqual({ before: 0, after: 570 });
    expect(wordHeadingSpacingTwips(2, 12, "double")).toEqual({ before: 261, after: 376 });
    expect(wordHeadingSpacingTwips(3, 12, "double")).toEqual({ before: 168, after: 324 });
    expect(wordHeadingSpacingTwips(2, 11, "one_half")).toEqual({ before: 276, after: 242 });
    expect(wordHeadingSpacingTwips(2, 12, "single")).toEqual({ before: 321, after: 159 });
  });

  it("never asks Word for less space above a heading than a paragraph already leaves", () => {
    for (const size of [10, 11, 12, 13, 14]) {
      for (const sp of ["single", "one_half", "double"] as const) {
        for (const level of [2, 3, 4] as const) {
          expect(wordHeadingSpacingTwips(level, size, sp).before).toBeGreaterThanOrEqual(140);
        }
      }
    }
  });
});

describe("Word export headings", () => {
  it("centres the chapter title, spaces headings like the PDF and keeps them with their text", async () => {
    const { document } = await wordXml(doc());
    const h1 = headingPPr(document, "Heading1");
    const h2 = headingPPr(document, "Heading2");
    const h3 = headingPPr(document, "Heading3");

    expect(h1).toContain('<w:jc w:val="center"/>');
    expect(spacing(h1)).toEqual({ before: "0", after: "570" });
    expect(h2).not.toContain("<w:jc");
    expect(spacing(h2)).toEqual({ before: "261", after: "376" });
    expect(spacing(h3)).toEqual({ before: "168", after: "324" });
    for (const pPr of [h1, h2, h3]) expect(pPr).toContain("<w:keepNext/>");
  });

  it("colours headings black by default and dark blue only when chosen", async () => {
    const black = await wordXml(doc());
    const blue = await wordXml(doc("blue"));
    for (const id of ["Heading1", "Heading2", "Heading3", "Heading4"]) {
      expect(styleColor(black.styles, id)).toBe("000000");
      expect(styleColor(blue.styles, id)).toBe("1F3864");
    }
  });

  it("sizes headings from the body font size", async () => {
    const { document } = await wordXml(doc(undefined, 11));
    // Half-points: chapter title 15pt, section 12.5pt, lower level 11pt.
    expect(document).toMatch(/Heading1[\s\S]*?<w:sz w:val="30"\/>[\s\S]*?Chapter 1/);
    expect(document).toMatch(/Heading2[\s\S]*?<w:sz w:val="25"\/>[\s\S]*?1\.1 Background/);
    expect(document).toMatch(/Heading3[\s\S]*?<w:sz w:val="22"\/>[\s\S]*?1\.1\.1 Gaps/);
  });
});

describe("PDF export headings", () => {
  const ORIGINAL_12PT_RULES = [
    "font-size: 16pt; font-weight: 700; margin: 0pt 0 12pt 0;",
    "font-size: 13.5pt; font-weight: 700; margin: 16pt 0 8pt 0;",
    "font-size: 12pt; font-weight: 700; margin: 12pt 0 6pt 0;",
    "font-size: 11.5pt; font-weight: 700; margin: 10pt 0 4pt 0;",
  ];

  it("keeps the original 12pt heading sizes and spacing, and only centres the chapter title", () => {
    const d = doc();
    const html = buildChapterHtmlDocument(d.chapters[0]!, d.formatting);
    ORIGINAL_12PT_RULES.forEach((rule, i) => expect(html).toContain(`h${i + 1} { ${rule}`));
    expect(html).toContain("margin: 0pt 0 12pt 0; text-align: center; }");
    expect(html).not.toMatch(/h[2-4] \{[^}]*text-align: center/);
  });

  it("keeps headings with the text that follows them", () => {
    const d = doc();
    expect(buildChapterHtmlDocument(d.chapters[0]!, d.formatting)).toMatch(
      /h1, h2, h3, h4 \{[^}]*break-after: avoid; page-break-after: avoid;/
    );
  });

  it("leaves heading colour as before unless dark blue is chosen", () => {
    const black = doc();
    expect(buildChapterHtmlDocument(black.chapters[0]!, black.formatting)).not.toMatch(
      /h1, h2, h3, h4 \{[^}]*color/
    );
    const blue = doc("blue");
    expect(buildChapterHtmlDocument(blue.chapters[0]!, blue.formatting)).toContain(
      "color: #1F3864"
    );
  });
});

describe("formatting step", () => {
  const base = {
    step: 7,
    font: "Times New Roman",
    fontSizePt: 12,
    lineSpacing: "double",
    marginsMm: 25,
    pageNumbering: true,
    spelling: "uk",
    cover: { authorName: "", institution: "", department: "", supervisor: "", submissionDate: "" },
  };

  it("defaults the heading colour to black and accepts blue", () => {
    expect(WizardStep7FormattingSchema.parse(base).headingColor).toBe("black");
    expect(WizardStep7FormattingSchema.parse({ ...base, headingColor: "blue" }).headingColor).toBe(
      "blue"
    );
  });

  it("rejects colours that are not offered", () => {
    expect(WizardStep7FormattingSchema.safeParse({ ...base, headingColor: "red" }).success).toBe(
      false
    );
  });
});

describe("formatting step form", () => {
  it("asks for the heading colour and starts on the saved choice", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { StepFormattingForm } = await import("@/components/wizard/step-chapters-and-style");
    const wizard = {
      project: { id: "prj_1", institution: null },
      settings: {
        font: "Times New Roman",
        fontSizePt: 12,
        lineSpacing: "double",
        marginsMm: 25,
        pageSize: "a4",
        pageNumbering: true,
        headingColor: "blue",
        spelling: "uk",
        cover: {
          authorName: "",
          institution: "",
          department: "",
          supervisor: "",
          submissionDate: "",
        },
      },
    } as unknown as Parameters<typeof StepFormattingForm>[0]["wizard"];
    const html = renderToStaticMarkup(
      createElement(StepFormattingForm, {
        wizard,
        saving: false,
        onSave: async () => {},
        onBack: () => {},
      })
    );
    expect(html).toContain("Heading colour");
    expect(html).toContain("Dark blue");
  });
});
