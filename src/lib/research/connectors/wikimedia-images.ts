import { buildCleanWikimediaAttribution, isSafeAcademicImageUrl } from "@/lib/export/figure-layout";

export interface VerifiedAcademicImage {
  url: string;
  sourcePageUrl: string;
  title: string;
  alt: string;
  caption: string;
  attribution: string;
  license: string;
  mimeType: "image/jpeg" | "image/png";
  naturalWidth: number;
  naturalHeight: number;
}

const ALLOWED_MIME_TYPES = new Set<string>(["image/jpeg", "image/png"]);

/**
 * Only openly licensed images suitable for academic work with attribution
 * (CC0, Public Domain, CC BY, CC BY-SA). Excludes NC/ND/fair-use/unverified copyright.
 */
export function isAcademicUsableLicense(licenseShortName: string): boolean {
  const clean = licenseShortName.trim();
  if (!clean) return false;
  if (
    /\b(nc|nd|non-?commercial|no-?deriv|fair\s*use|copyrighted|all rights reserved)\b/i.test(clean)
  ) {
    return false;
  }
  return /^(cc0|public\s*domain|pd\b|cc[\s-]by([\s-]sa)?)/i.test(clean);
}

function stripHtmlTags(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanFileTitle(rawTitle: string): string {
  return rawTitle
    .replace(/^File:/i, "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface WikimediaImageInfo {
  url?: string;
  thumburl?: string;
  descriptionurl?: string;
  mime?: string;
  width?: number;
  height?: number;
  thumbwidth?: number;
  thumbheight?: number;
  extmetadata?: Record<string, { value?: string }>;
}

interface WikimediaQueryResponse {
  query?: {
    pages?: Record<
      string,
      {
        title?: string;
        imageinfo?: WikimediaImageInfo[];
      }
    >;
  };
}

/**
 * Searches Wikimedia Commons for real, openly licensed photographs/diagrams suitable for
 * academic papers, theses, and projects — never AI-generated images.
 */
export async function searchWikimediaAcademicImages(params: {
  query: string;
  limit?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}): Promise<VerifiedAcademicImage[]> {
  const trimmedQuery = params.query.trim();
  if (trimmedQuery.length < 2) return [];

  const limit = Math.min(12, Math.max(1, params.limit ?? 6));
  const fetchFn = params.fetchFn ?? globalThis.fetch;
  const timeoutMs = params.timeoutMs ?? 8000;

  const searchUrl = new URL("https://commons.wikimedia.org/w/api.php");
  searchUrl.searchParams.set("action", "query");
  searchUrl.searchParams.set("generator", "search");
  searchUrl.searchParams.set("gsrnamespace", "6");
  searchUrl.searchParams.set("gsrlimit", String(Math.min(20, limit * 3)));
  searchUrl.searchParams.set("gsrsearch", trimmedQuery);
  searchUrl.searchParams.set("prop", "imageinfo");
  searchUrl.searchParams.set("iiprop", "url|size|mime|extmetadata");
  searchUrl.searchParams.set("iiurlwidth", "1200");
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("origin", "*");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(searchUrl.toString(), {
      method: "GET",
      headers: {
        accept: "application/json",
        "user-agent": "CollateAcademicResearch/1.0 (https://collate.corstack.dev)",
      },
      signal: controller.signal,
    });

    if (!res.ok) return [];
    const json = (await res.json()) as WikimediaQueryResponse;
    const pages = Object.values(json.query?.pages ?? {});
    const results: VerifiedAcademicImage[] = [];
    const seenUrls = new Set<string>();

    for (const page of pages) {
      if (results.length >= limit) break;
      const info = page.imageinfo?.[0];
      if (!info) continue;

      const mime = (info.mime ?? "").toLowerCase();
      if (!ALLOWED_MIME_TYPES.has(mime)) continue;

      const meta = info.extmetadata ?? {};
      const licenseRaw = stripHtmlTags(meta.LicenseShortName?.value ?? "");
      if (!isAcademicUsableLicense(licenseRaw)) continue;

      const imageUrl = (info.thumburl || info.url || "").trim();
      if (!isSafeAcademicImageUrl(imageUrl) || seenUrls.has(imageUrl)) continue;

      const width = info.thumburl ? (info.thumbwidth ?? info.width ?? 0) : (info.width ?? 0);
      const height = info.thumburl ? (info.thumbheight ?? info.height ?? 0) : (info.height ?? 0);
      if (width < 300 || height < 200) continue;

      const ratio = width / height;
      if (ratio < 0.35 || ratio > 3.5) continue;

      const title = cleanFileTitle(page.title ?? trimmedQuery) || trimmedQuery;
      const rawDesc = stripHtmlTags(meta.ImageDescription?.value ?? "")
        .replace(/https?:\/\/\S+/gi, " ")
        .replace(/\bFile:[^\s,)]+/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      const caption = rawDesc.length >= 12 && rawDesc.length <= 220 ? rawDesc : title;

      const rawAuthor = stripHtmlTags(meta.Artist?.value ?? "");
      const sourcePageUrl =
        info.descriptionurl && isSafeAcademicImageUrl(info.descriptionurl)
          ? info.descriptionurl
          : "https://commons.wikimedia.org";

      const attribution = buildCleanWikimediaAttribution({
        author: rawAuthor,
        license: licenseRaw,
      });

      seenUrls.add(imageUrl);
      results.push({
        url: imageUrl,
        sourcePageUrl,
        title,
        alt: title,
        caption,
        attribution,
        license: licenseRaw,
        mimeType: mime as "image/jpeg" | "image/png",
        naturalWidth: Math.round(width),
        naturalHeight: Math.round(height),
      });
    }

    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

const IMAGE_INTENT_PATTERN =
  /\b(image|picture|photo|photograph|figure|illustration|diagram|visual)\b/i;

/**
 * Extracts a concise search subject when a student asks for an image/picture/figure
 * in revision notes (e.g., "add a picture of beetroot in section 1.1" -> "beetroot").
 */
export function extractRequestedFigureQuery(
  topic: string,
  revisionInstructions?: string | null
): string | null {
  const note = revisionInstructions?.trim() ?? "";
  if (!note || !IMAGE_INTENT_PATTERN.test(note)) {
    return null;
  }

  const ofMatch = note.match(
    /\b(?:image|picture|photo|photograph|figure|illustration|diagram)\s+(?:of|showing)\s+([^.,;\n]{3,80})/i
  );
  if (ofMatch?.[1]) {
    const cleaned = ofMatch[1]
      .replace(/\b(in\s+section\s+\d+(?:\.\d+)?|between\s+.+|after\s+.+|before\s+.+)\b/gi, "")
      .trim();
    if (cleaned.length >= 3) {
      return cleaned;
    }
  }

  // Fallback: extract key nouns from project topic
  return buildTopicImageQuery(topic);
}

/**
 * Builds a concise Wikimedia Commons search query from a long academic project title.
 */
export function buildTopicImageQuery(topic: string): string {
  const stopWords = new Set([
    "the",
    "of",
    "on",
    "in",
    "during",
    "for",
    "and",
    "with",
    "to",
    "a",
    "an",
    "effect",
    "effects",
    "impact",
    "study",
    "analysis",
    "evaluation",
    "assessment",
    "investigation",
    "chronic",
    "administration",
    "markers",
    "using",
    "between",
    "among",
  ]);
  const tokens = topic
    .replace(/[()[\],:;.-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stopWords.has(t.toLowerCase()));

  return tokens.slice(0, 4).join(" ") || topic.trim().slice(0, 60);
}
