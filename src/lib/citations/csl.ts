import { z } from "zod";
import type { SourceType } from "@/db/schema";
import { normalizeDoi } from "@/lib/research/dedupe";
import { cleanSourceTitle, UNTITLED_DOCUMENT } from "./source-title";

export const CslAuthorSchema = z.union([
  z.object({
    family: z.string().min(1),
    given: z.string().optional(),
  }),
  z.object({
    literal: z.string().min(1),
  }),
]);

export type CslAuthor = z.infer<typeof CslAuthorSchema>;

export const CslItemSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["article-journal", "book", "report", "dataset", "manuscript", "webpage"]),
  title: z.string().min(1),
  author: z.array(CslAuthorSchema).default([]),
  issued: z
    .object({
      "date-parts": z.array(z.array(z.number().int())),
    })
    .optional(),
  "container-title": z.string().optional(),
  publisher: z.string().optional(),
  DOI: z.string().optional(),
  URL: z.string().optional(),
  /** "a", "b", … when the same author has several works in the same year. Set when loaded. */
  "year-suffix": z.string().optional(),
  accessed: z
    .object({
      "date-parts": z.array(z.array(z.number().int())),
    })
    .optional(),
});

export type CslItem = z.infer<typeof CslItemSchema>;

const INSTITUTIONAL_KEYWORDS = [
  "organization",
  "organisation",
  "bank",
  "ministry",
  "department",
  "university",
  "institute",
  "agency",
  "commission",
  "council",
  "foundation",
  "bureau",
  "center",
  "centre",
  "association",
  "united nations",
  "world health",
];

export function parseAuthorToCsl(rawName: string): CslAuthor {
  const clean = rawName.trim();
  const lower = clean.toLowerCase();

  if (INSTITUTIONAL_KEYWORDS.some((kw) => lower.includes(kw))) {
    return { literal: clean };
  }

  if (clean.includes(",")) {
    const [family, ...rest] = clean.split(",");
    const given = rest.join(" ").trim();
    if (family?.trim()) {
      return given ? { family: family.trim(), given } : { family: family.trim() };
    }
  }

  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { literal: parts[0]! };
  }

  const family = parts[parts.length - 1]!;
  const given = parts.slice(0, -1).join(" ");
  return { family, given };
}

function mapSourceTypeToCsl(sourceType: SourceType): CslItem["type"] {
  if (sourceType === "peer_reviewed") return "article-journal";
  if (sourceType === "book") return "book";
  if (sourceType === "institutional") return "report";
  if (sourceType === "dataset") return "dataset";
  if (sourceType === "preprint") return "manuscript";
  return "webpage";
}

export interface VerifiedSourceMetadataInput {
  citeKey: string;
  title: string;
  authors: string[];
  year?: number | null;
  venue?: string | null;
  publisher?: string | null;
  doi?: string | null;
  url: string;
  sourceType: SourceType;
  retrievedAt: Date;
}

export function buildCslItemFromSource(input: VerifiedSourceMetadataInput): CslItem {
  const normalizedDoi = normalizeDoi(input.doi);
  const authors = input.authors
    .map((a) => a.trim())
    .filter(Boolean)
    .map(parseAuthorToCsl);

  const raw: CslItem = {
    id: input.citeKey,
    type: mapSourceTypeToCsl(input.sourceType),
    title: cleanSourceTitle(input.title) || UNTITLED_DOCUMENT,
    author: authors,
    ...(input.year ? { issued: { "date-parts": [[input.year]] } } : {}),
    ...(input.venue?.trim() ? { "container-title": input.venue.trim() } : {}),
    ...(input.publisher?.trim() ? { publisher: input.publisher.trim() } : {}),
    ...(normalizedDoi ? { DOI: normalizedDoi } : {}),
    URL: input.url.trim(),
    accessed: {
      "date-parts": [
        [
          input.retrievedAt.getUTCFullYear(),
          input.retrievedAt.getUTCMonth() + 1,
          input.retrievedAt.getUTCDate(),
        ],
      ],
    },
  };

  return CslItemSchema.parse(raw);
}

export function generateUniqueCiteKey(
  source: { authors: string[]; publisher?: string | null; title: string; year?: number | null },
  usedKeys: Set<string>
): string {
  let baseSlug: string;
  if (source.authors.length > 0) {
    const first = parseAuthorToCsl(source.authors[0]!);
    const label = "family" in first ? first.family : (first.literal.split(/\s+/)[0] ?? "source");
    baseSlug = label;
  } else if (source.publisher?.trim()) {
    baseSlug = source.publisher.trim().split(/\s+/)[0] ?? "source";
  } else {
    baseSlug = source.title.trim().split(/\s+/)[0] ?? "source";
  }

  const cleanSlug =
    baseSlug
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 16) || "source";

  const yearTag = source.year ? String(source.year) : "nd";
  const baseKey = `${cleanSlug}${yearTag}`;

  if (!usedKeys.has(baseKey)) {
    usedKeys.add(baseKey);
    return baseKey;
  }

  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  for (let i = 0; i < alphabet.length; i++) {
    const candidate = `${baseKey}${alphabet[i]}`;
    if (!usedKeys.has(candidate)) {
      usedKeys.add(candidate);
      return candidate;
    }
  }

  let n = 2;
  while (usedKeys.has(`${baseKey}_${n}`)) n++;
  const numbered = `${baseKey}_${n}`;
  usedKeys.add(numbered);
  return numbered;
}
