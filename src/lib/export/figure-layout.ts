export interface FigureDimensionBounds {
  /** Maximum printable width in CSS pixels (at 96 dpi). Defaults to ~148mm (560px) for A4 with 25mm margins. */
  maxWidthPx?: number;
  /** Maximum printable height in CSS pixels (at 96 dpi). Defaults to ~98mm (370px) so figures never dominate a page. */
  maxHeightPx?: number;
}

export interface ControlledFigureSize {
  widthPx: number;
  heightPx: number;
  scaledDown: boolean;
}

export const DEFAULT_PRINT_FIGURE_BOUNDS: Required<FigureDimensionBounds> = {
  maxWidthPx: 560,
  maxHeightPx: 370,
};

/**
 * Computes safe display/export dimensions for an academic figure based on its real natural dimensions:
 * - Preserves exact aspect ratio (never stretches or distorts).
 * - Never upscales smaller images past their natural pixel size.
 * - Scales down proportionally ONLY when the image exceeds printable PDF/DOCX width or height bounds.
 */
export function computeControlledFigureDimensions(
  naturalWidth: number | null | undefined,
  naturalHeight: number | null | undefined,
  bounds: FigureDimensionBounds = DEFAULT_PRINT_FIGURE_BOUNDS
): ControlledFigureSize {
  const maxWidthPx = Math.max(
    120,
    Math.round(bounds.maxWidthPx ?? DEFAULT_PRINT_FIGURE_BOUNDS.maxWidthPx)
  );
  const maxHeightPx = Math.max(
    100,
    Math.round(bounds.maxHeightPx ?? DEFAULT_PRINT_FIGURE_BOUNDS.maxHeightPx)
  );

  const validW =
    typeof naturalWidth === "number" && Number.isFinite(naturalWidth) && naturalWidth > 0
      ? naturalWidth
      : 480;
  const validH =
    typeof naturalHeight === "number" && Number.isFinite(naturalHeight) && naturalHeight > 0
      ? naturalHeight
      : 320;

  const scale = Math.min(1, maxWidthPx / validW, maxHeightPx / validH);
  const widthPx = Math.max(1, Math.round(validW * scale));
  const heightPx = Math.max(1, Math.round(validH * scale));

  return {
    widthPx,
    heightPx,
    scaledDown: scale < 1,
  };
}

/**
 * Validates that a figure URL is a safe HTTPS URL suitable for web/PDF/DOCX rendering.
 * Rejects javascript:, data:, file:, relative paths, and private/local URLs.
 */
export function isSafeAcademicImageUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2048) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      /^169\.254\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
