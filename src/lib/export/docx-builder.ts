import {
  AlignmentType,
  Document,
  Footer,
  HeadingLevel,
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
import type { ThesisExportDocument } from "./templates";

function lineSpacingTwips(spacing: ThesisExportDocument["formatting"]["lineSpacing"]): number {
  if (spacing === "single") return 240;
  if (spacing === "one_half") return 360;
  return 480;
}

function markdownToDocxBlocks(
  markdown: string,
  font: string,
  sizeHalfPt: number,
  lineTwips: number
): Array<Paragraph | Table> {
  const lines = markdown.split(/\r?\n/);
  const blocks: Array<Paragraph | Table> = [];
  let tableRows: string[][] = [];

  const flushTable = () => {
    if (tableRows.length === 0) return;
    const filtered = tableRows.filter((r) => !r.every((cell) => /^:?-{2,}:?$/.test(cell.trim())));
    if (filtered.length > 0) {
      blocks.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: filtered.map(
            (row, rowIdx) =>
              new TableRow({
                children: row.map(
                  (cell) =>
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: cell,
                              bold: rowIdx === 0,
                              font,
                              size: Math.max(18, sizeHalfPt - 2),
                            }),
                          ],
                        }),
                      ],
                    })
                ),
              })
          ),
        })
      );
    }
    tableRows = [];
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      tableRows.push(
        trimmed
          .slice(1, -1)
          .split("|")
          .map((c) => c.trim())
      );
      continue;
    }
    flushTable();
    if (!trimmed) continue;

    if (trimmed.startsWith("### ")) {
      blocks.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 100 },
          children: [new TextRun({ text: trimmed.slice(4), bold: true, font, size: sizeHalfPt })],
        })
      );
    } else if (trimmed.startsWith("## ")) {
      blocks.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 260, after: 120 },
          children: [
            new TextRun({ text: trimmed.slice(3), bold: true, font, size: sizeHalfPt + 2 }),
          ],
        })
      );
    } else if (trimmed.startsWith("# ")) {
      blocks.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 160 },
          children: [
            new TextRun({ text: trimmed.slice(2), bold: true, font, size: sizeHalfPt + 6 }),
          ],
        })
      );
    } else {
      const cleanText = trimmed.replace(/^[-*>]\s+/, "");
      blocks.push(
        new Paragraph({
          spacing: { after: 140, line: lineTwips },
          children: [new TextRun({ text: cleanText, font, size: sizeHalfPt })],
        })
      );
    }
  }

  flushTable();
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
    children.push(...markdownToDocxBlocks(ch.markdown, font, sizeHalfPt, lineTwips));
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
            children: [new TextRun({ text: entry, font, size: sizeHalfPt })],
          })
      )
    );
  }

  const wordDoc = new Document({
    sections: [
      {
        properties: {
          page: {
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
