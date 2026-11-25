import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { parseMarkdownToBlocks } from "@/lib/writing/editor-blocks";
import type { ResolvedExportFigureAsset } from "./figure-assets";
import {
  computeControlledFigureDimensions,
  formatFigureAttributionForDisplay,
} from "./figure-layout";
import { keepWordsTogether } from "./keep-together";
import { getPageSizeSpec } from "./page-sizes";
import type { ThesisExportDocument } from "./templates";

function lineSpacingTwips(spacing: ThesisExportDocument["formatting"]["lineSpacing"]): number {
  if (spacing === "single") return 240;
  if (spacing === "one_half") return 360;
  return 480;
}

function parseInlineMarkdownRuns(
  raw: string,
  font: string,
  sizeHalfPt: number,
  baseBold = false
): TextRun[] {
  raw = keepWordsTogether(raw);
  const segments = raw.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter((s) => s.length > 0);
  if (segments.length === 0) {
    return [new TextRun({ text: raw, font, size: sizeHalfPt, bold: baseBold })];
  }
  return segments.map((seg) => {
    if (seg.startsWith("**") && seg.endsWith("**") && seg.length > 4) {
      return new TextRun({ text: seg.slice(2, -2), font, size: sizeHalfPt, bold: true });
    }
    if (seg.startsWith("*") && seg.endsWith("*") && seg.length > 2) {
      return new TextRun({
        text: seg.slice(1, -1),
        font,
        size: sizeHalfPt,
        bold: baseBold,
        italics: true,
      });
    }
    return new TextRun({ text: seg, font, size: sizeHalfPt, bold: baseBold });
  });
}

function markdownToDocxBlocks(
  markdown: string,
  font: string,
  sizeHalfPt: number,
  lineTwips: number,
  resolvedFigures?: Record<string, ResolvedExportFigureAsset>
): Array<Paragraph | Table> {
  const parsedBlocks = parseMarkdownToBlocks(markdown);
  const blocks: Array<Paragraph | Table> = [];

  for (const block of parsedBlocks) {
    switch (block.type) {
      case "page_break": {
        blocks.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      }
      case "heading": {
        if (block.level === 1) {
          blocks.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              spacing: { before: 240, after: 160 },
              children: parseInlineMarkdownRuns(block.text, font, sizeHalfPt + 6, true),
            })
          );
        } else if (block.level === 2) {
          blocks.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 260, after: 120 },
              children: parseInlineMarkdownRuns(block.text, font, sizeHalfPt + 2, true),
            })
          );
        } else if (block.level === 3) {
          blocks.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_3,
              spacing: { before: 200, after: 100 },
              children: parseInlineMarkdownRuns(block.text, font, sizeHalfPt, true),
            })
          );
        } else {
          blocks.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_4,
              spacing: { before: 160, after: 80 },
              children: parseInlineMarkdownRuns(block.text, font, sizeHalfPt, true),
            })
          );
        }
        break;
      }
      case "paragraph": {
        blocks.push(
          new Paragraph({
            spacing: { after: 140, line: lineTwips },
            children:
              block.text.trim().length === 0
                ? [new TextRun({ text: "", font, size: sizeHalfPt })]
                : parseInlineMarkdownRuns(block.text, font, sizeHalfPt),
          })
        );
        break;
      }
      case "blockquote": {
        blocks.push(
          new Paragraph({
            indent: { left: 720 },
            spacing: { after: 140, line: lineTwips },
            children: parseInlineMarkdownRuns(block.text, font, sizeHalfPt),
          })
        );
        break;
      }
      case "bullet_list": {
        for (const item of block.items) {
          blocks.push(
            new Paragraph({
              bullet: { level: 0 },
              spacing: { after: 100, line: lineTwips },
              children: parseInlineMarkdownRuns(item, font, sizeHalfPt),
            })
          );
        }
        break;
      }
      case "table": {
        const tableRows = block.raw
          .split(/\r?\n/)
          .map((line) =>
            line
              .trim()
              .slice(1, -1)
              .split("|")
              .map((c) => c.trim())
          )
          .filter((r) => !r.every((cell) => /^:?-{2,}:?$/.test(cell.trim())));

        if (tableRows.length > 0) {
          blocks.push(
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: tableRows.map(
                (row, rowIdx) =>
                  new TableRow({
                    children: row.map(
                      (cell) =>
                        new TableCell({
                          children: [
                            new Paragraph({
                              children: parseInlineMarkdownRuns(
                                cell,
                                font,
                                Math.max(18, sizeHalfPt - 2),
                                rowIdx === 0
                              ),
                            }),
                          ],
                        })
                    ),
                  })
              ),
            })
          );
        }
        break;
      }
      case "figure": {
        const asset = resolvedFigures?.[block.figure.url];
        const natW = asset?.naturalWidth ?? block.figure.width;
        const natH = asset?.naturalHeight ?? block.figure.height;
        const dims = computeControlledFigureDimensions(natW, natH, {
          maxWidthPx: 540,
          maxHeightPx: 360,
        });

        if (asset) {
          blocks.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              keepNext: true,
              spacing: { before: 220, after: 100 },
              children: [
                new ImageRun({
                  type: asset.docxType,
                  data: asset.bytes,
                  transformation: {
                    width: dims.widthPx,
                    height: dims.heightPx,
                  },
                  altText: {
                    name: block.figure.alt.slice(0, 100),
                    title: block.figure.caption.slice(0, 140),
                    description: block.figure.alt.slice(0, 200),
                  },
                }),
              ],
            })
          );
        }

        const cleanAttr = formatFigureAttributionForDisplay(
          block.figure.attribution,
          block.figure.sourceUrl
        ).displayText;

        blocks.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            keepNext: Boolean(cleanAttr),
            spacing: { before: asset ? 40 : 180, after: cleanAttr ? 40 : 180 },
            children: parseInlineMarkdownRuns(block.figure.caption, font, 20),
          })
        );

        if (cleanAttr) {
          blocks.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 180 },
              children: [
                new TextRun({
                  text: cleanAttr,
                  font,
                  size: 16, // 8pt fine print
                  color: "555555",
                }),
              ],
            })
          );
        }
        break;
      }
    }
  }

  return blocks;
}

export async function buildThesisDocx(
  doc: ThesisExportDocument,
  options: { includeFrontMatter?: boolean; includeReferences?: boolean } = {}
): Promise<Uint8Array> {
  const includeFrontMatter = options.includeFrontMatter ?? true;
  const includeReferences = options.includeReferences ?? true;

  const font = doc.formatting.font;
  const sizeHalfPt = doc.formatting.fontSizePt * 2;
  const lineTwips = lineSpacingTwips(doc.formatting.lineSpacing);
  const marginTwips = Math.round(doc.formatting.marginsMm * 56.6929);

  const children: Array<Paragraph | Table> = [];

  if (includeFrontMatter && doc.formatting.frontMatter.coverPage) {
    const cover = doc.formatting.cover;
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 600, after: 300 },
        children: [
          new TextRun({
            text: cover.institution || "[Institution Name]",
            bold: true,
            font,
            size: sizeHalfPt + 4,
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 1200, after: 1200 },
        children: [
          new TextRun({
            text: doc.projectTitle.toUpperCase(),
            bold: true,
            font,
            size: sizeHalfPt + 10,
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: cover.authorName || "[Author Name]",
            bold: true,
            font,
            size: sizeHalfPt + 2,
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: `${doc.workTypeLabel}${cover.supervisor ? ` · Supervisor: ${cover.supervisor}` : ""}`,
            font,
            size: sizeHalfPt,
          }),
        ],
      }),
      new Paragraph({ children: [new PageBreak()] })
    );
  }

  if (includeFrontMatter && doc.formatting.frontMatter.abstract) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: "Abstract", bold: true, font, size: sizeHalfPt + 6 })],
      }),
      new Paragraph({
        spacing: { after: 200, line: lineTwips },
        children: [
          new TextRun({
            text:
              doc.abstractText?.trim() ||
              `This ${doc.workTypeLabel.toLowerCase()} investigates ${doc.projectTitle} using verified sources.`,
            font,
            size: sizeHalfPt,
          }),
        ],
      }),
      new Paragraph({ children: [new PageBreak()] })
    );
  }

  doc.chapters.forEach((ch, idx) => {
    if (idx > 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
    children.push(
      ...markdownToDocxBlocks(ch.markdown, font, sizeHalfPt, lineTwips, doc.resolvedFigures)
    );
  });

  if (includeReferences && doc.bibliographyEntries.length > 0) {
    children.push(
      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: "References", bold: true, font, size: sizeHalfPt + 6 })],
      }),
      ...doc.bibliographyEntries.map(
        (entry) =>
          new Paragraph({
            spacing: { after: 140, line: lineTwips },
            indent: { left: 720, hanging: 720 },
            children: [new TextRun({ text: keepWordsTogether(entry), font, size: sizeHalfPt })],
          })
      )
    );
  }

  const pageSpec = getPageSizeSpec(doc.formatting.pageSize);
  const wordDoc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: pageSpec.docxWidthTwips,
              height: pageSpec.docxHeightTwips,
            },
            margin: {
              top: marginTwips,
              right: marginTwips,
              bottom: marginTwips,
              left: marginTwips,
            },
          },
        },
        footers: doc.formatting.pageNumbering
          ? {
              default: new Footer({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({ children: [PageNumber.CURRENT], font, size: 20 })],
                  }),
                ],
              }),
            }
          : undefined,
        children,
      },
    ],
  });

  return new Uint8Array(await Packer.toArrayBuffer(wordDoc));
}
