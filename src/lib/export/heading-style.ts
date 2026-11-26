import type { HeadingColor, LineSpacing } from "@/db/schema";

/**
 * Heading rules shared by the Word and PDF exports. The PDF layout is the reference: the Word
 * export sets its own spacing so its headings sit the same distance from the text around them.
 * - Colour is the user's choice: black by default, dark blue only when chosen.
 * - Sizes step up from the body size (at 12pt body: 16, 13.5, 12 and 11.5pt).
 */

export const HEADING_COLOR_HEX: Record<HeadingColor, string> = {
  black: "000000",
  blue: "1F3864",
};

export function headingColorHex(color: HeadingColor | undefined): string {
  return HEADING_COLOR_HEX[color ?? "black"] ?? HEADING_COLOR_HEX.black;
}

export type HeadingLevel = 1 | 2 | 3 | 4;

const SIZE_STEP_PT: Record<HeadingLevel, number> = { 1: 4, 2: 1.5, 3: 0, 4: -0.5 };

/** Heading size in points for a body font size. */
export function headingSizePt(level: HeadingLevel, bodySizePt: number): number {
  return bodySizePt + SIZE_STEP_PT[level];
}

/** PDF margin above and below each heading level, in points (the original print layout). */
export const PRINT_HEADING_MARGIN_PT: Record<HeadingLevel, { before: number; after: number }> = {
  1: { before: 0, after: 12 },
  2: { before: 16, after: 8 },
  3: { before: 12, after: 6 },
  4: { before: 10, after: 4 },
};

/** CSS line-height multiplier used for the PDF body (headings inherit it). */
export function printLineHeight(spacing: LineSpacing): number {
  if (spacing === "single") return 1.15;
  if (spacing === "one_half") return 1.5;
  return 2;
}

/** Word line spacing in 240ths of a line. */
export function wordLineSpacing240(spacing: LineSpacing): number {
  if (spacing === "single") return 240;
  if (spacing === "one_half") return 360;
  return 480;
}

// Typical serif text metrics: the glyph box is about 1.107em tall, and Word draws a single line
// about 1.15em tall with the text at the top of the line.
const GLYPH_BOX_EM = 1.107;
const WORD_SINGLE_LINE_EM = 1.15;
/** Space Word leaves after every body paragraph, in points (140 twips). */
export const WORD_BODY_PARAGRAPH_AFTER_PT = 7;
/** Space the PDF leaves after every body paragraph, in points. */
const PRINT_BODY_PARAGRAPH_AFTER_PT = 10;

/**
 * Word spacing before and after a heading, in twips, chosen so the heading text sits the same
 * distance from the text above and below it as in the PDF.
 *
 * In the PDF every line is centred in a box of font size x line height. In Word, headings are
 * single-spaced and body lines are taller, with the text at the top of each line. In both, the
 * gap between two paragraphs is the larger of the space after the first and the space before
 * the second (measured in Word 365). So:
 * - after a section heading: PDF distance from heading text to paragraph text, minus the Word heading line;
 * - before a section heading: PDF distance from the last paragraph line to the heading, minus
 *   Word's body line;
 * - after a chapter title: PDF distance from the title to the first section heading, minus the
 *   Word title line.
 */
export function wordHeadingSpacingTwips(
  level: HeadingLevel,
  bodySizePt: number,
  spacing: LineSpacing
): { before: number; after: number } {
  const m = printLineHeight(spacing);
  const wordBodyLine = WORD_SINGLE_LINE_EM * bodySizePt * (wordLineSpacing240(spacing) / 240);
  // Distance from the top of a PDF line box to the top of its text.
  const inset = (sizePt: number) => (sizePt * (m - GLYPH_BOX_EM)) / 2;
  const toTwips = (pt: number) => Math.max(0, Math.round(pt * 20));

  const sectionBefore = (lvl: HeadingLevel) => {
    const size = headingSizePt(lvl, bodySizePt);
    const margin = Math.max(PRINT_BODY_PARAGRAPH_AFTER_PT, PRINT_HEADING_MARGIN_PT[lvl].before);
    const pdfDistance = bodySizePt * m - inset(bodySizePt) + margin + inset(size);
    // Word keeps at least the body paragraph's own space after; never ask for less.
    return Math.max(WORD_BODY_PARAGRAPH_AFTER_PT, pdfDistance - wordBodyLine);
  };

  const size = headingSizePt(level, bodySizePt);
  if (level === 1) {
    const next = headingSizePt(2, bodySizePt);
    const margin = Math.max(PRINT_HEADING_MARGIN_PT[1].after, PRINT_HEADING_MARGIN_PT[2].before);
    const pdfDistance = size * m - inset(size) + margin + inset(next);
    return { before: 0, after: toTwips(pdfDistance - WORD_SINGLE_LINE_EM * size) };
  }

  const pdfDistanceAfter =
    size * m - inset(size) + PRINT_HEADING_MARGIN_PT[level].after + inset(bodySizePt);
  return {
    before: toTwips(sectionBefore(level)),
    after: toTwips(pdfDistanceAfter - WORD_SINGLE_LINE_EM * size),
  };
}
