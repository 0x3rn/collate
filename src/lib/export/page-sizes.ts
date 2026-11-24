import type { PageSize } from "@/db/schema";

export interface PageSizeSpec {
  id: PageSize;
  label: string;
  shortLabel: string;
  dimensionsLabel: string;
  widthMm: number;
  heightMm: number;
  /** Word (.docx) page width in DXA / twips (1 inch = 1440 twips) */
  docxWidthTwips: number;
  /** Word (.docx) page height in DXA / twips (1 inch = 1440 twips) */
  docxHeightTwips: number;
  /** Cloudflare Browser Run /pdf format string */
  pdfFormat: "a4" | "letter";
  /** CSS @page size keyword */
  cssPageSize: "A4" | "letter";
}

export const PAGE_SIZE_SPECS: Record<PageSize, PageSizeSpec> = {
  a4: {
    id: "a4",
    label: "A4 (210 × 297 mm)",
    shortLabel: "A4",
    dimensionsLabel: "210 × 297 mm",
    widthMm: 210,
    heightMm: 297,
    docxWidthTwips: 11906,
    docxHeightTwips: 16838,
    pdfFormat: "a4",
    cssPageSize: "A4",
  },
  letter: {
    id: "letter",
    label: "US Letter (8.5 × 11 in)",
    shortLabel: "US Letter",
    dimensionsLabel: "8.5 × 11 in",
    widthMm: 215.9,
    heightMm: 279.4,
    docxWidthTwips: 12240,
    docxHeightTwips: 15840,
    pdfFormat: "letter",
    cssPageSize: "letter",
  },
};

export function getPageSizeSpec(pageSize?: PageSize | null): PageSizeSpec {
  if (pageSize === "letter") return PAGE_SIZE_SPECS.letter;
  return PAGE_SIZE_SPECS.a4;
}

/**
 * Returns the constant physical printable body height (excluding top and bottom margins)
 * in CSS pixels at standard 96 DPI so page boundaries in the editor stay completely fixed
 * for the selected document paper size (A4 or US Letter).
 */
export function getEditorPageBodyHeightPx(pageSize: PageSize = "a4", marginsMm = 25): number {
  const spec = getPageSizeSpec(pageSize);
  const safeMarginMm = Math.max(15, Math.min(40, marginsMm));
  const printableHeightMm = Math.max(140, spec.heightMm - 2 * safeMarginMm);
  return Math.round((printableHeightMm * 96) / 25.4);
}
