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

export interface FigureAttributionLinkSegments {
  before: string;
  label: string;
  after: string;
  href: string;
}

export interface FormattedFigureAttribution {
  /** Clean academic attribution with zero raw URLs and zero File:... text. */
  displayText: string;
  /** Safe HTTPS source page URL (used only for clickable "Wikimedia Commons" in the web reader). */
  sourceUrl: string | null;
  /** Split text segments when "Wikimedia Commons" should render as a subtle link in the web reader. */
  linkSegments: FigureAttributionLinkSegments | null;
}

const GENERIC_WIKIMEDIA_AUTHORS = new Set([
  "",
  "wikimedia commons",
  "wikimedia commons contributor",
  "commons contributor",
  "unknown",
  "unknown author",
  "anonymous",
  "own work",
]);

function sanitizeAttributionAuthor(rawAuthor: string | null | undefined): string {
  if (!rawAuthor) return "";
  let clean = rawAuthor
    .replace(/\(\s*https?:\/\/[^)\s]+\s*\)/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\bFile:[^\s,)]+/gi, " ")
    .replace(/^(?:photo|photograph|image|diagram|illustration)\s+by\s+/i, "")
    .replace(/^(?:author|creator|credit)\s*:\s*/i, "")
    .replace(/^(?:user|commons)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.;:\-·]+|[,.;:\-·]+$/g, "")
    .trim();

  if (clean.length > 80) {
    clean = "";
  }
  if (GENERIC_WIKIMEDIA_AUTHORS.has(clean.toLowerCase())) {
    return "";
  }
  return clean;
}

function sanitizeAttributionLicense(rawLicense: string | null | undefined): string {
  if (!rawLicense) return "";
  return rawLicense
    .replace(/\(\s*https?:\/\/[^)\s]+\s*\)/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\bFile:[^\s,)]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.;:\-·]+|[,.;:\-·]+$/g, "")
    .trim();
}

/**
 * Formats a clean academic Wikimedia Commons attribution without any visible URL or File: text:
 * - Author known: "Source: Sanjay Acharya, Wikimedia Commons (CC BY-SA 4.0)"
 * - No specific author: "Source: Wikimedia Commons (Public Domain)"
 */
export function buildCleanWikimediaAttribution(params: {
  author?: string | null;
  license?: string | null;
}): string {
  const author = sanitizeAttributionAuthor(params.author);
  const license = sanitizeAttributionLicense(params.license);
  const base = author ? `Source: ${author}, Wikimedia Commons` : "Source: Wikimedia Commons";
  return license ? `${base} (${license})` : base;
}

function buildAttributionLinkSegments(
  displayText: string,
  sourceUrl: string | null
): FigureAttributionLinkSegments | null {
  if (!displayText) return null;

  // Prefer linking the exact "Wikimedia Commons" label when present
  const wikiMatch = displayText.match(/Wikimedia Commons/i);
  if (wikiMatch && wikiMatch.index !== undefined) {
    const safeHref =
      sourceUrl && isSafeAcademicImageUrl(sourceUrl) ? sourceUrl : "https://commons.wikimedia.org";
    const start = wikiMatch.index;
    const label = wikiMatch[0];
    return {
      before: displayText.slice(0, start),
      label,
      after: displayText.slice(start + label.length),
      href: safeHref,
    };
  }

  // For any other source with a verified safe HTTPS sourceUrl, subtly link the source name
  // (everything after optional "Source: " and before optional trailing " (License)")
  if (!sourceUrl || !isSafeAcademicImageUrl(sourceUrl)) {
    return null;
  }

  const prefixMatch = displayText.match(/^(Source:\s*)/i);
  const start = prefixMatch ? prefixMatch[0].length : 0;
  const remainder = displayText.slice(start);
  const trailingParenIdx = remainder.search(/\s*\([^)]+\)\s*$/);
  const labelRaw = trailingParenIdx === -1 ? remainder : remainder.slice(0, trailingParenIdx);
  const label = labelRaw.trim();
  if (!label) return null;

  const labelStart = start + remainder.indexOf(label);
  return {
    before: displayText.slice(0, labelStart),
    label,
    after: displayText.slice(labelStart + label.length),
    href: sourceUrl,
  };
}

/**
 * Normalizes any new or legacy figure attribution string (from Wikimedia Commons or any
 * other source) into clean, publication-grade academic fine print with zero raw URLs,
 * `www.` domains, or image filenames (`File:...`, `*.jpg`, `*.png`, etc.), while recovering
 * a safe HTTPS `sourceUrl` so the web reader can subtly hyperlink the source name.
 */
export function formatFigureAttributionForDisplay(
  rawAttribution: string | null | undefined,
  explicitSourceUrl?: string | null
): FormattedFigureAttribution {
  const trimmed = (rawAttribution ?? "").trim();

  // Recover safe source URL from explicit parameter first, then legacy embedded URL
  let sourceUrl: string | null = null;
  if (explicitSourceUrl && isSafeAcademicImageUrl(explicitSourceUrl)) {
    sourceUrl = explicitSourceUrl.trim();
  }
  if (!sourceUrl && trimmed) {
    const embeddedUrlMatch = trimmed.match(/https:\/\/(?:[^\s()]|\([^\s()]*\))+/i);
    if (embeddedUrlMatch?.[0]) {
      const candidate = embeddedUrlMatch[0].replace(/[.,;]+$/, "");
      if (isSafeAcademicImageUrl(candidate)) {
        sourceUrl = candidate;
      }
    }
  }

  if (!trimmed) {
    return { displayText: "", sourceUrl, linkSegments: null };
  }

  // Strip any parenthesized or bare URLs (supporting balanced parentheses like File:Beta_vulgaris_(beetroot).jpg),
  // bare www. domains, File:... tokens, and raw image filenames (*.jpg, *.png, *.webp, *.svg, etc.)
  const withoutUrls = trimmed
    .replace(/\(\s*(?:https?|javascript|file):(?:[^\s()]|\([^\s()]*\))*\s*\)/gi, " ")
    .replace(/(?:https?|javascript|file):\/\/(?:[^\s()]|\([^\s()]*\))+/gi, " ")
    .replace(/\bjavascript:(?:[^\s()]|\([^\s()]*\))+/gi, " ")
    .replace(/\(\s*www\.[^)\s]+\s*\)/gi, " ")
    .replace(/\bwww\.[^\s,)]+/gi, " ")
    .replace(/\bFile:[^\s,)]+/gi, " ")
    .replace(/(?:^|[\s(])[^\s(),/]+\.(?:jpe?g|png|gif|webp|svg|tiff?|bmp)\b\)?/gi, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Upgrade legacy middot format:
  // "Source: Wikimedia Commons · Photo by Author · CC BY-SA 4.0"
  // -> "Source: Author, Wikimedia Commons (CC BY-SA 4.0)"
  if (/Wikimedia Commons/i.test(withoutUrls) && withoutUrls.includes("·")) {
    const parts = withoutUrls
      .split("·")
      .map((p) => p.trim())
      .filter(Boolean);
    const nonPlatformParts = parts.filter((p) => !/^(?:source:\s*)?wikimedia commons$/i.test(p));

    let author = "";
    let license = "";
    for (const part of nonPlatformParts) {
      if (
        !license &&
        /^(?:cc0|public\s*domain|pd\b|cc[\s-]by(?:[\s-]sa)?)/i.test(part.replace(/^\(|\)$/g, ""))
      ) {
        license = part.replace(/^\(|\)$/g, "").trim();
      } else if (!author) {
        author = part;
      }
    }

    const displayText = buildCleanWikimediaAttribution({ author, license });
    return {
      displayText,
      sourceUrl,
      linkSegments: buildAttributionLinkSegments(displayText, sourceUrl),
    };
  }

  // Clean general / already-formatted attribution (applies to every source)
  const displayText = withoutUrls
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/,\s*,+/g, ",")
    .replace(/,\s*\(/g, " (")
    .replace(/\(\s+/g, "(")
    .replace(/\s{2,}/g, " ")
    .replace(/[,·\-–—]+\s*$/, "")
    .trim();

  return {
    displayText,
    sourceUrl,
    linkSegments: buildAttributionLinkSegments(displayText, sourceUrl),
  };
}
