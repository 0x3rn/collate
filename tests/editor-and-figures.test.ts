import { describe, expect, it } from "vitest";
import { createDb } from "@/db/client";
import { createWizardDraftProject } from "@/db/queries/wizard";
import {
  handleSignIn,
  handleSignUp,
  handleVerifyEmail,
  type HttpAuthDeps,
} from "@/lib/auth/http-handlers";
import {
  buildCleanWikimediaAttribution,
  computeControlledFigureDimensions,
  formatFigureAttributionForDisplay,
  isSafeAcademicImageUrl,
} from "@/lib/export/figure-layout";
import {
  buildTopicImageQuery,
  extractRequestedFigureQuery,
  isAcademicUsableLicense,
  searchWikimediaAcademicImages,
} from "@/lib/research/connectors/wikimedia-images";
import { handleListProjectFigures, handleSearchProjectFigures } from "@/lib/research/figures-http";
import { buildThesisDocx } from "@/lib/export/docx-builder";
import { getEditorPageBodyHeightPx, getPageSizeSpec } from "@/lib/export/page-sizes";
import { buildChapterHtmlDocument, markdownToPrintHtml } from "@/lib/export/templates";
import { extractMarkdownHeadings } from "@/lib/writing/chapter-reader-handlers";
import {
  computeBlockPageNumbers,
  inlineMarkdownToEditableHtml,
  PAGE_BREAK_TOKEN,
  parseMarkdownToBlocks,
  serializeBlocksToMarkdown,
  serializeEditableNodeToMarkdown,
  SPACER_TOKEN,
  type MinimalDomNode,
} from "@/lib/writing/editor-blocks";
import { createInMemoryD1 } from "./helpers/in-memory-d1";

describe("Controlled Academic Figure Dimensions & URL Safety", () => {
  it("preserves exact aspect ratio, scales down oversized images, and never upscales small images", () => {
    // Wide landscape photo (1600x800) scales to maxWidthPx=560 -> 560x280
    const wide = computeControlledFigureDimensions(1600, 800, {
      maxWidthPx: 560,
      maxHeightPx: 370,
    });
    expect(wide).toEqual({ widthPx: 560, heightPx: 280, scaledDown: true });

    // Tall portrait photo (900x1800) caps cleanly at maxHeightPx=370 -> 185x370 (never too tall!)
    const tall = computeControlledFigureDimensions(900, 1800, {
      maxWidthPx: 560,
      maxHeightPx: 370,
    });
    expect(tall).toEqual({ widthPx: 185, heightPx: 370, scaledDown: true });

    // Medium photo already inside bounds (420x280) is NEVER stretched or compressed
    const medium = computeControlledFigureDimensions(420, 280, {
      maxWidthPx: 560,
      maxHeightPx: 370,
    });
    expect(medium).toEqual({ widthPx: 420, heightPx: 280, scaledDown: false });

    // Missing/invalid dimensions fall back cleanly inside bounds
    const fallback = computeControlledFigureDimensions(null, undefined);
    expect(fallback.widthPx).toBeLessThanOrEqual(560);
    expect(fallback.heightPx).toBeLessThanOrEqual(370);
  });

  it("blocks unsafe protocols and private/local network hosts for figure URLs", () => {
    expect(
      isSafeAcademicImageUrl(
        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Beetroot.jpg/800px-Beetroot.jpg"
      )
    ).toBe(true);
    expect(isSafeAcademicImageUrl("http://example.com/beetroot.jpg")).toBe(false);
    expect(isSafeAcademicImageUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeAcademicImageUrl("data:image/png;base64,abc")).toBe(false);
    expect(isSafeAcademicImageUrl("https://127.0.0.1/secret.png")).toBe(false);
    expect(isSafeAcademicImageUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafeAcademicImageUrl("https://192.168.1.5/local.jpg")).toBe(false);
  });
});

describe("Formatted Editor Block Parser, Page Breaks, Figures & Citation Preservation", () => {
  it("losslessly round-trips headings, paragraphs, bullets, tables, page breaks, and verified figures", () => {
    const sample = [
      "# Chapter 1: Introduction",
      "",
      "## 1.1 Background of the study",
      "",
      "Beetroot (*Beta vulgaris*) reduces **oxidative stress** [@poncedvila2026].",
      "",
      ":::figure",
      "url: https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Beetroot.jpg/800px-Beetroot.jpg",
      "alt: Fresh Beta vulgaris roots",
      "caption: Figure 1.1: Fresh Beta vulgaris (beetroot) roots showing betalain pigmentation.",
      "attribution: Source: Example Author, Wikimedia Commons (CC BY-SA 4.0)",
      "sourceUrl: https://commons.wikimedia.org/wiki/File:Beetroot.jpg",
      "width: 800",
      "height: 533",
      ":::",
      "",
      PAGE_BREAK_TOKEN,
      "",
      "## 1.2 Key findings",
      "",
      "- Lowered MDA levels [@darvish2024]",
      "- Improved GSH/GSSG ratio",
      "",
      "| Group | MDA (nmol/mL) |",
      "| --- | --- |",
      "| Control | 2.1 |",
    ].join("\n");

    const blocks = parseMarkdownToBlocks(sample);
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "heading",
      "paragraph",
      "figure",
      "page_break",
      "heading",
      "bullet_list",
      "table",
    ]);

    const figureBlock = blocks[3];
    expect(figureBlock?.type).toBe("figure");
    if (figureBlock?.type === "figure") {
      expect(figureBlock.figure.width).toBe(800);
      expect(figureBlock.figure.height).toBe(533);
      expect(figureBlock.figure.attribution).toBe(
        "Source: Example Author, Wikimedia Commons (CC BY-SA 4.0)"
      );
      expect(figureBlock.figure.sourceUrl).toBe(
        "https://commons.wikimedia.org/wiki/File:Beetroot.jpg"
      );
    }

    const roundTripped = serializeBlocksToMarkdown(blocks);
    expect(roundTripped).toBe(sample);

    // Legacy figure blocks with raw File:... URLs embedded inside attribution are cleaned automatically
    const legacyMd = [
      ":::figure",
      "url: https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Beetroot.jpg/800px-Beetroot.jpg",
      "alt: Beetroot",
      "caption: Beetroot roots",
      "attribution: Source: Wikimedia Commons · Photo by Sanjay Acharya · CC BY-SA 4.0 (https://commons.wikimedia.org/wiki/File:Beetroot_jm26647.jpg)",
      ":::",
    ].join("\n");
    const legacyBlocks = parseMarkdownToBlocks(legacyMd);
    expect(legacyBlocks[0]?.type).toBe("figure");
    if (legacyBlocks[0]?.type === "figure") {
      expect(legacyBlocks[0].figure.attribution).toBe(
        "Source: Sanjay Acharya, Wikimedia Commons (CC BY-SA 4.0)"
      );
      expect(legacyBlocks[0].figure.attribution).not.toContain("File:");
      expect(legacyBlocks[0].figure.attribution).not.toContain("https://");
      expect(legacyBlocks[0].figure.sourceUrl).toBe(
        "https://commons.wikimedia.org/wiki/File:Beetroot_jm26647.jpg"
      );
    }

    // Explicit page break immediately pushes the following section to Page 2
    const pageNums = computeBlockPageNumbers(blocks, 275);
    expect(pageNums[0]).toBe(1);
    expect(pageNums[3]).toBe(1); // figure on page 1
    expect(pageNums[5]).toBe(2); // heading after <!-- pagebreak --> starts on page 2
  });

  it("escapes XSS and preserves protected citation chips when converting between HTML and Markdown", () => {
    const html = inlineMarkdownToEditableHtml(
      "Study on <script>alert(1)</script> *Beta vulgaris* and **ROS** [@poncedvila2026].",
      {
        "[@poncedvila2026]": {
          label: "(Ponce de Vila et al. 2026)",
          citeKeys: ["poncedvila2026"],
        },
      }
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<em>Beta vulgaris</em>");
    expect(html).toContain("<strong>ROS</strong>");
    expect(html).toContain('contenteditable="false"');
    expect(html).toContain('data-cite-token="[@poncedvila2026]"');
    expect(html).toContain("(Ponce de Vila et al. 2026)");

    // Minimal DOM tree simulating browser contentEditable back to Markdown
    const mockRoot: MinimalDomNode = {
      nodeType: 1,
      nodeName: "DIV",
      textContent: null,
      childNodes: [
        { nodeType: 3, nodeName: "#text", textContent: "Beetroot (" },
        {
          nodeType: 1,
          nodeName: "EM",
          textContent: "Beta vulgaris",
          childNodes: [{ nodeType: 3, nodeName: "#text", textContent: "Beta vulgaris" }],
        },
        { nodeType: 3, nodeName: "#text", textContent: ") lowers " },
        {
          nodeType: 1,
          nodeName: "STRONG",
          textContent: "oxidative stress",
          childNodes: [{ nodeType: 3, nodeName: "#text", textContent: "oxidative stress" }],
        },
        { nodeType: 3, nodeName: "#text", textContent: " " },
        {
          nodeType: 1,
          nodeName: "SPAN",
          textContent: "(Ponce de Vila et al. 2026)",
          getAttribute: (name) => (name === "data-cite-token" ? "[@poncedvila2026]" : null),
        },
        { nodeType: 3, nodeName: "#text", textContent: "." },
      ],
    };

    expect(serializeEditableNodeToMarkdown(mockRoot)).toBe(
      "Beetroot (*Beta vulgaris*) lowers **oxidative stress** [@poncedvila2026]."
    );
  });

  it("parses, serializes, indexes, and exports level-4 (####) headings without leaking raw hashtags", async () => {
    const md = [
      "## 2.1 Antioxidant Activity",
      "",
      "### 2.1.1 Betalain Pathways",
      "",
      "#### Effects of *Beta vulgaris* on Total Antioxidant Capacity and Oxidative Damage Biomarkers",
      "",
      "##### Normalized Deep Subheading",
      "",
      "Evidence paragraph explaining biomarker shifts.",
    ].join("\n");

    const blocks = parseMarkdownToBlocks(md);
    expect(blocks.map((b) => (b.type === "heading" ? `h${b.level}` : b.type))).toEqual([
      "h2",
      "h3",
      "h4",
      "h4",
      "paragraph",
    ]);

    const serialized = serializeBlocksToMarkdown(blocks);
    expect(serialized).toContain(
      "#### Effects of *Beta vulgaris* on Total Antioxidant Capacity and Oxidative Damage Biomarkers"
    );

    const toc = extractMarkdownHeadings(md);
    expect(toc).toHaveLength(4);
    expect(toc[2]).toEqual({
      id: "sec-3",
      level: 4,
      text: "Effects of *Beta vulgaris* on Total Antioxidant Capacity and Oxidative Damage Biomarkers",
    });

    const printHtml = markdownToPrintHtml(md);
    expect(printHtml).toContain(
      "<h4>Effects of <em>Beta vulgaris</em> on Total Antioxidant Capacity and Oxidative Damage Biomarkers</h4>"
    );
    expect(printHtml).not.toContain("####");

    const docxBytes = await buildThesisDocx(
      {
        projectTitle: "Beetroot Study",
        workTypeLabel: "Project",
        formatting: {
          font: "Times New Roman",
          fontSizePt: 12,
          lineSpacing: "double",
          marginsMm: 25,
          pageNumbering: true,
          frontMatter: {
            coverPage: false,
            certification: false,
            dedication: false,
            acknowledgements: false,
            preface: false,
            abstract: false,
            tableOfContents: false,
            listOfFiguresAndTables: false,
            appendices: false,
          },
          cover: {
            authorName: "",
            institution: "",
            department: "",
            supervisor: "",
            submissionDate: "",
          },
        },
        chapters: [{ number: 2, title: "Literature Review", markdown: md }],
        bibliographyEntries: [],
      },
      { includeFrontMatter: false, includeReferences: false }
    );
    expect(docxBytes.byteLength).toBeGreaterThan(2000);
  });

  it("persists explicit Enter blank lines (<!-- spacer -->) and pushes following blocks onto the next page", () => {
    const blocks = parseMarkdownToBlocks(
      [
        "## 1.1 Intro",
        "",
        "Opening paragraph with enough words to start Page 1.",
        "",
        ...Array.from({ length: 24 }, () => SPACER_TOKEN),
        "",
        "## 1.2 Pushed heading",
      ].join("\n\n")
    );

    const blankLines = blocks.filter((b) => b.type === "paragraph" && b.text === "");
    expect(blankLines).toHaveLength(24);

    const roundTrip = serializeBlocksToMarkdown(blocks);
    expect(roundTrip.match(/<!-- spacer -->/g)?.length).toBe(24);

    const pages = computeBlockPageNumbers(blocks, 275);
    expect(pages[0]).toBe(1);
    expect(pages[pages.length - 1]).toBeGreaterThanOrEqual(2);

    const printHtml = markdownToPrintHtml(roundTrip);
    expect(printHtml).toContain('<p class="blank-line">&nbsp;</p>');

    // Constant physical dimensions for A4 vs US Letter across editor, PDF, and DOCX
    expect(getEditorPageBodyHeightPx("a4", 25)).toBe(934);
    expect(getEditorPageBodyHeightPx("letter", 25)).toBe(867);
    expect(getPageSizeSpec("a4").docxWidthTwips).toBe(11906);
    expect(getPageSizeSpec("a4").docxHeightTwips).toBe(16838);
    expect(getPageSizeSpec("letter").docxWidthTwips).toBe(12240);
    expect(getPageSizeSpec("letter").docxHeightTwips).toBe(15840);

    const letterHtml = buildChapterHtmlDocument(
      { number: 1, title: "Intro", markdown: "# Chapter 1\n\nBody text." },
      {
        font: "Times New Roman",
        fontSizePt: 12,
        lineSpacing: "double",
        marginsMm: 25,
        pageSize: "letter",
        pageNumbering: true,
        frontMatter: {
          coverPage: false,
          certification: false,
          dedication: false,
          acknowledgements: false,
          preface: false,
          abstract: false,
          tableOfContents: false,
          listOfFiguresAndTables: false,
          appendices: false,
        },
        cover: {
          authorName: "",
          institution: "",
          department: "",
          supervisor: "",
          submissionDate: "",
        },
      }
    );
    expect(letterHtml).toContain("size: letter;");
  });
});

describe("Wikimedia Commons Open-License Image Search & Figures HTTP API", () => {
  it("filters strictly for openly licensed JPEG/PNG photos with safe dimensions and builds attribution", async () => {
    expect(isAcademicUsableLicense("CC BY-SA 4.0")).toBe(true);
    expect(isAcademicUsableLicense("CC0")).toBe(true);
    expect(isAcademicUsableLicense("Public domain")).toBe(true);
    expect(isAcademicUsableLicense("CC BY-NC 4.0")).toBe(false);
    expect(isAcademicUsableLicense("All rights reserved")).toBe(false);

    expect(
      extractRequestedFigureQuery(
        "The effect of beetroot on oxidative stress",
        "In section 1.1, insert a picture of Beta vulgaris beetroot showing the red root."
      )
    ).toContain("Beta vulgaris beetroot");
    expect(
      extractRequestedFigureQuery("Solar microgrids", "Tighten the conclusion wording.")
    ).toBeNull();
    expect(
      buildTopicImageQuery("THE EFFECT OF BETAVULGARIS(BEETROOT) ON OXIDATIVE STRESS")
    ).toContain("BEETROOT");

    const mockFetch: typeof fetch = async () =>
      Response.json({
        query: {
          pages: {
            "1": {
              title: "File:Beta_vulgaris_beetroot_roots.jpg",
              imageinfo: [
                {
                  url: "https://upload.wikimedia.org/wikipedia/commons/4/45/Beta_vulgaris.jpg",
                  thumburl:
                    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/Beta_vulgaris.jpg/1200px-Beta_vulgaris.jpg",
                  descriptionurl: "https://commons.wikimedia.org/wiki/File:Beta_vulgaris.jpg",
                  mime: "image/jpeg",
                  width: 2400,
                  height: 1600,
                  thumbwidth: 1200,
                  thumbheight: 800,
                  extmetadata: {
                    LicenseShortName: { value: "CC BY-SA 4.0" },
                    Artist: { value: '<a href="https://example.org">Dr. Jane Botanist</a>' },
                    ImageDescription: {
                      value:
                        "<b>Fresh Beta vulgaris</b> (beetroot) roots sliced to show betalain pigment.",
                    },
                  },
                },
              ],
            },
            "2": {
              title: "File:Restricted_image.jpg",
              imageinfo: [
                {
                  url: "https://upload.wikimedia.org/wikipedia/commons/9/99/Restricted.jpg",
                  mime: "image/jpeg",
                  width: 800,
                  height: 600,
                  extmetadata: {
                    LicenseShortName: { value: "CC BY-NC-ND 4.0" },
                  },
                },
              ],
            },
            "3": {
              title: "File:Unsafe_svg.svg",
              imageinfo: [
                {
                  url: "https://upload.wikimedia.org/wikipedia/commons/1/11/Unsafe.svg",
                  mime: "image/svg+xml",
                  width: 800,
                  height: 600,
                  extmetadata: {
                    LicenseShortName: { value: "CC0" },
                  },
                },
              ],
            },
          },
        },
      });

    const images = await searchWikimediaAcademicImages({
      query: "Beta vulgaris beetroot",
      limit: 5,
      fetchFn: mockFetch,
    });

    expect(images).toHaveLength(1);
    expect(images[0]?.naturalWidth).toBe(1200);
    expect(images[0]?.naturalHeight).toBe(800);
    expect(images[0]?.caption).toBe(
      "Fresh Beta vulgaris (beetroot) roots sliced to show betalain pigment."
    );
    expect(images[0]?.attribution).toBe(
      "Source: Dr. Jane Botanist, Wikimedia Commons (CC BY-SA 4.0)"
    );
    expect(images[0]?.attribution).not.toContain("File:");
    expect(images[0]?.attribution).not.toContain("https://");
    expect(images[0]?.attribution).not.toContain("<a");
    expect(images[0]?.sourcePageUrl).toBe(
      "https://commons.wikimedia.org/wiki/File:Beta_vulgaris.jpg"
    );

    // Verify clean attribution formatter directly across legacy, contributor, custom, and unsafe inputs
    expect(
      buildCleanWikimediaAttribution({ author: "Wikimedia Commons contributor", license: "CC0" })
    ).toBe("Source: Wikimedia Commons (CC0)");
    expect(
      buildCleanWikimediaAttribution({ author: "User:JaneBotanist", license: "CC BY 4.0" })
    ).toBe("Source: JaneBotanist, Wikimedia Commons (CC BY 4.0)");

    const legacyFormatted = formatFigureAttributionForDisplay(
      "Source: Wikimedia Commons · Wikimedia Commons contributor · Public domain (https://commons.wikimedia.org/wiki/File:Beetroot_01.jpg)"
    );
    expect(legacyFormatted.displayText).toBe("Source: Wikimedia Commons (Public domain)");
    expect(legacyFormatted.sourceUrl).toBe(
      "https://commons.wikimedia.org/wiki/File:Beetroot_01.jpg"
    );
    expect(legacyFormatted.linkSegments).toEqual({
      before: "Source: ",
      label: "Wikimedia Commons",
      after: " (Public domain)",
      href: "https://commons.wikimedia.org/wiki/File:Beetroot_01.jpg",
    });

    const customCleaned = formatFigureAttributionForDisplay(
      "Source: FAO Report 2024 (https://www.fao.org/docs/chart_1.png)"
    );
    expect(customCleaned.displayText).toBe("Source: FAO Report 2024");
    expect(customCleaned.linkSegments).toEqual({
      before: "Source: ",
      label: "FAO Report 2024",
      after: "",
      href: "https://www.fao.org/docs/chart_1.png",
    });

    const bareFilenameAndWwwCleaned = formatFigureAttributionForDisplay(
      "Source: World Health Organization, oxidative_chart.png (www.who.int/report) (CC BY 4.0)"
    );
    expect(bareFilenameAndWwwCleaned.displayText).toBe(
      "Source: World Health Organization (CC BY 4.0)"
    );
    expect(bareFilenameAndWwwCleaned.linkSegments).toBeNull();

    const parenthesizedUrlFormatted = formatFigureAttributionForDisplay(
      "Source: Wikimedia Commons · Photo by Sanjay Acharya · CC BY-SA 4.0 (https://commons.wikimedia.org/wiki/File:Beta_vulgaris_(beetroot).jpg)"
    );
    expect(parenthesizedUrlFormatted.displayText).toBe(
      "Source: Sanjay Acharya, Wikimedia Commons (CC BY-SA 4.0)"
    );
    expect(parenthesizedUrlFormatted.sourceUrl).toBe(
      "https://commons.wikimedia.org/wiki/File:Beta_vulgaris_(beetroot).jpg"
    );

    const unsafeUrlCleaned = formatFigureAttributionForDisplay(
      "Source: Lab Data (javascript:alert(1))",
      "http://127.0.0.1/internal"
    );
    expect(unsafeUrlCleaned.displayText).toBe("Source: Lab Data");
    expect(unsafeUrlCleaned.sourceUrl).toBeNull();
    expect(unsafeUrlCleaned.linkSegments).toBeNull();

    // Verify authenticated figures search & IDOR isolation
    const d1Ctx = createInMemoryD1();
    try {
      d1Ctx.applyMigrations();
      const db = createDb(d1Ctx.d1);
      const sent: string[] = [];
      const now = new Date("2026-11-24T12:00:00.000Z");
      const authDeps: HttpAuthDeps = {
        db,
        mailer: {
          async send(msg) {
            sent.push(msg.text);
            return { ok: true, provider: "console", messageId: "m1" };
          },
        },
        appUrl: "https://collate.app",
        appEnv: "prod",
        turnstileSecretKey: "test",
        nowFn: () => now,
        fetchFn: async (input) => {
          if (String(input).includes("commons.wikimedia.org")) {
            return mockFetch(input);
          }
          return Response.json({ success: true });
        },
      };

      async function createUserCookie(name: string, email: string) {
        await handleSignUp(
          new Request("https://collate.app/api/auth/signup", {
            method: "POST",
            headers: { "content-type": "application/json", origin: "https://collate.app" },
            body: JSON.stringify({
              name,
              email,
              password: "StrongPassword123!",
              turnstileToken: "ok",
              acceptTerms: true,
            }),
          }),
          authDeps
        );
        const tok = decodeURIComponent(sent[sent.length - 1]!.match(/token=([^\s&]+)/)![1]!);
        await handleVerifyEmail(
          new Request("https://collate.app/api/auth/verify-email", {
            method: "POST",
            headers: { "content-type": "application/json", origin: "https://collate.app" },
            body: JSON.stringify({ token: tok }),
          }),
          authDeps
        );
        const signInRes = await handleSignIn(
          new Request("https://collate.app/api/auth/signin", {
            method: "POST",
            headers: { "content-type": "application/json", origin: "https://collate.app" },
            body: JSON.stringify({ email, password: "StrongPassword123!", turnstileToken: "ok" }),
          }),
          authDeps
        );
        const body = (await signInRes.json()) as { user: { id: string } };
        return {
          userId: body.user.id,
          cookie: (signInRes.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
        };
      }

      const alice = await createUserCookie("Alice", "alice@uni.edu");
      const bob = await createUserCookie("Bob", "bob@uni.edu");
      const draft = await createWizardDraftProject(db, alice.userId, "project", now);

      const searchRes = await handleSearchProjectFigures(
        new Request(`https://collate.app/api/projects/${draft.project.id}/figures/search`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://collate.app",
            cookie: alice.cookie,
          },
          body: JSON.stringify({ query: "Beta vulgaris beetroot" }),
        }),
        draft.project.id,
        authDeps
      );
      expect(searchRes.status).toBe(200);
      const searchJson = (await searchRes.json()) as { figures: Array<{ title: string }> };
      expect(searchJson.figures).toHaveLength(1);

      const listRes = await handleListProjectFigures(
        new Request(`https://collate.app/api/projects/${draft.project.id}/figures/search`, {
          headers: { cookie: alice.cookie },
        }),
        draft.project.id,
        authDeps
      );
      expect(listRes.status).toBe(200);
      const listJson = (await listRes.json()) as { figures: Array<{ url: string }> };
      expect(listJson.figures).toHaveLength(1);

      // Bob cannot search or list Alice's project figures
      const bobRes = await handleListProjectFigures(
        new Request(`https://collate.app/api/projects/${draft.project.id}/figures/search`, {
          headers: { cookie: bob.cookie },
        }),
        draft.project.id,
        authDeps
      );
      expect(bobRes.status).toBe(404);
    } finally {
      d1Ctx.close();
    }
  });
});
