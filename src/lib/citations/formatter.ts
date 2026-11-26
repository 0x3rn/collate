import type { CitationInlineMode, CitationStyle } from "@/db/schema";
import type { CslAuthor, CslItem } from "./csl";
import { shortTitleForCitation } from "./source-title";

export interface CitationStyleFormatter {
  readonly id: string;
  readonly kind: "author-date" | "numeric";
  formatInTextGroup(
    entries: Array<{ item: CslItem; numericIndex: number; locator?: string }>
  ): string;
  formatBibliographyEntry(item: CslItem, numericIndex: number): string;
}

/**
 * The year shown in a citation. Author-date styles add the item's year-suffix letter so two
 * works by the same author in the same year stay distinct ("2020a", "n.d.-b").
 */
function getYearString(item: CslItem, withSuffix = true): string {
  const y = item.issued?.["date-parts"]?.[0]?.[0];
  const suffix = withSuffix ? (item["year-suffix"] ?? "") : "";
  if (typeof y === "number") return `${y}${suffix}`;
  // Non-breaking hyphen (U+2011) so a line never ends on "n.d.-" with the letter on the next.
  return suffix ? `n.d.‑${suffix}` : "n.d.";
}

function getAuthorSurname(author: CslAuthor): string {
  return "family" in author ? author.family : author.literal;
}

function getInitials(given: string | undefined, withPeriods: boolean): string {
  if (!given?.trim()) return "";
  return given
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => (withPeriods ? `${part[0]!.toUpperCase()}.` : part[0]!.toUpperCase()))
    .join(withPeriods ? " " : "");
}

function formatInTextAuthors(item: CslItem, conjunction: "&" | "and", etAlPeriod: boolean): string {
  const authors = item.author;
  if (authors.length === 0) {
    return item.publisher?.trim() || shortTitleForCitation(item.title);
  }
  if (authors.length === 1) {
    return getAuthorSurname(authors[0]!);
  }
  if (authors.length === 2) {
    return `${getAuthorSurname(authors[0]!)} ${conjunction} ${getAuthorSurname(authors[1]!)}`;
  }
  return `${getAuthorSurname(authors[0]!)} ${etAlPeriod ? "et al." : "et al"}`;
}

function formatAuthorsApa(authors: CslAuthor[]): string {
  if (authors.length === 0) return "";
  const formatted = authors.map((a) => {
    if ("literal" in a) return a.literal;
    const init = getInitials(a.given, true);
    return init ? `${a.family}, ${init}` : a.family;
  });
  if (formatted.length === 1) return formatted[0]!;
  if (formatted.length === 2) return `${formatted[0]}, & ${formatted[1]}`;
  return `${formatted.slice(0, -1).join(", ")}, & ${formatted[formatted.length - 1]}`;
}

function formatAuthorsHarvard(authors: CslAuthor[]): string {
  if (authors.length === 0) return "";
  const formatted = authors.map((a) => {
    if ("literal" in a) return a.literal;
    const init = getInitials(a.given, true);
    return init ? `${a.family}, ${init}` : a.family;
  });
  if (formatted.length === 1) return formatted[0]!;
  if (formatted.length === 2) return `${formatted[0]} and ${formatted[1]}`;
  return `${formatted.slice(0, -1).join(", ")} and ${formatted[formatted.length - 1]}`;
}

function formatAuthorsMlaOrChicago(authors: CslAuthor[]): string {
  if (authors.length === 0) return "";
  const first = authors[0]!;
  const firstStr =
    "literal" in first
      ? first.literal
      : first.given
        ? `${first.family}, ${first.given}`
        : first.family;
  if (authors.length === 1) return firstStr;
  if (authors.length === 2) {
    const second = authors[1]!;
    const secondStr =
      "literal" in second
        ? second.literal
        : [second.given, second.family].filter(Boolean).join(" ");
    return `${firstStr}, and ${secondStr}`;
  }
  return `${firstStr}, et al.`;
}

function formatAuthorsIeee(authors: CslAuthor[]): string {
  if (authors.length === 0) return "";
  const formatted = authors.map((a) => {
    if ("literal" in a) return a.literal;
    const init = getInitials(a.given, true);
    return init ? `${init} ${a.family}` : a.family;
  });
  if (formatted.length === 1) return formatted[0]!;
  if (formatted.length === 2) return `${formatted[0]} and ${formatted[1]}`;
  return `${formatted.slice(0, -1).join(", ")}, and ${formatted[formatted.length - 1]}`;
}

function formatAuthorsVancouver(authors: CslAuthor[]): string {
  if (authors.length === 0) return "";
  const formatted = authors.slice(0, 6).map((a) => {
    if ("literal" in a) return a.literal;
    const init = getInitials(a.given, false);
    return init ? `${a.family} ${init}` : a.family;
  });
  return authors.length > 6 ? `${formatted.join(", ")}, et al.` : formatted.join(", ");
}

function getDoiOrUrl(item: CslItem, style: "https" | "doi_prefix"): string {
  if (item.DOI) {
    return style === "https" ? `https://doi.org/${item.DOI}` : `doi:${item.DOI}`;
  }
  return item.URL ?? "";
}

const BUILTIN_FORMATTERS: Record<CitationStyle, CitationStyleFormatter> = {
  apa7: {
    id: "apa7",
    kind: "author-date",
    formatInTextGroup(entries) {
      const parts = entries.map(({ item, locator }) => {
        const who = formatInTextAuthors(item, "&", true);
        const year = getYearString(item);
        return locator ? `${who}, ${year}, ${locator}` : `${who}, ${year}`;
      });
      return `(${parts.join("; ")})`;
    },
    formatBibliographyEntry(item) {
      const authors = formatAuthorsApa(item.author) || item.publisher;
      const year = getYearString(item);
      const container = item["container-title"] ? ` ${item["container-title"]}.` : "";
      const pub = !item["container-title"] && item.publisher ? ` ${item.publisher}.` : "";
      const ref = getDoiOrUrl(item, "https");
      // APA: with no author, the title moves to the author position.
      if (!authors) {
        return `${item.title}. (${year}).${container}${ref ? ` ${ref}` : ""}`.trim();
      }
      return `${authors} (${year}). ${item.title}.${container}${pub}${ref ? ` ${ref}` : ""}`.trim();
    },
  },

  harvard: {
    id: "harvard",
    kind: "author-date",
    formatInTextGroup(entries) {
      const parts = entries.map(({ item, locator }) => {
        const who = formatInTextAuthors(item, "and", true);
        const year = getYearString(item);
        return locator ? `${who} ${year}, ${locator}` : `${who} ${year}`;
      });
      return `(${parts.join("; ")})`;
    },
    formatBibliographyEntry(item) {
      const authors = formatAuthorsHarvard(item.author) || item.publisher;
      const year = getYearString(item);
      const container = item["container-title"] ? `, ${item["container-title"]}` : "";
      const pub = !item["container-title"] && item.publisher ? `, ${item.publisher}` : "";
      const ref = item.DOI ? ` doi:${item.DOI}.` : item.URL ? ` Available at: ${item.URL}.` : "";
      // Harvard: with no author, the title leads the entry.
      if (!authors) {
        return `${item.title} (${year})${container}.${ref}`.replace("..", ".").trim();
      }
      return `${authors} (${year}) '${item.title}'${container}${pub}.${ref}`
        .replace("..", ".")
        .trim();
    },
  },

  mla9: {
    id: "mla9",
    kind: "author-date",
    formatInTextGroup(entries) {
      const parts = entries.map(({ item, locator }) => {
        const who = formatInTextAuthors(item, "and", true);
        const page = locator ? ` ${locator.replace(/^pp?\.\s*/i, "")}` : "";
        return `${who}${page}`;
      });
      return `(${parts.join("; ")})`;
    },
    formatBibliographyEntry(item) {
      const authors = formatAuthorsMlaOrChicago(item.author);
      const year = getYearString(item, false);
      const container = item["container-title"] ? `${item["container-title"]}, ` : "";
      const ref = getDoiOrUrl(item, "https");
      const prefix = authors ? `${authors}. ` : "";
      return `${prefix}"${item.title}." ${container}${year}${ref ? `, ${ref}` : ""}.`
        .replace("..", ".")
        .trim();
    },
  },

  chicago: {
    id: "chicago",
    kind: "author-date",
    formatInTextGroup(entries) {
      const parts = entries.map(({ item, locator }) => {
        const who = formatInTextAuthors(item, "and", true);
        const year = getYearString(item);
        const page = locator ? `, ${locator.replace(/^pp?\.\s*/i, "")}` : "";
        return `${who} ${year}${page}`;
      });
      return `(${parts.join("; ")})`;
    },
    formatBibliographyEntry(item) {
      const authors = formatAuthorsMlaOrChicago(item.author) || item.publisher || "Unknown author";
      const year = getYearString(item);
      const container = item["container-title"] ? ` ${item["container-title"]}.` : "";
      const pub = !item["container-title"] && item.publisher ? ` ${item.publisher}.` : "";
      const ref = getDoiOrUrl(item, "https");
      return `${authors}. ${year}. "${item.title}."${container}${pub}${ref ? ` ${ref}.` : ""}`
        .replace("..", ".")
        .trim();
    },
  },

  ieee: {
    id: "ieee",
    kind: "numeric",
    formatInTextGroup(entries) {
      return entries.map(({ numericIndex }) => `[${numericIndex}]`).join(", ");
    },
    formatBibliographyEntry(item, numericIndex) {
      const authors = formatAuthorsIeee(item.author) || item.publisher || "Unknown author";
      const year = getYearString(item, false);
      const container = item["container-title"] ? `, ${item["container-title"]}` : "";
      const ref = item.DOI ? `, doi: ${item.DOI}` : item.URL ? `, ${item.URL}` : "";
      return `[${numericIndex}] ${authors}, "${item.title}"${container}, ${year}${ref}.`.trim();
    },
  },

  vancouver: {
    id: "vancouver",
    kind: "numeric",
    formatInTextGroup(entries) {
      return `(${entries.map(({ numericIndex }) => String(numericIndex)).join(", ")})`;
    },
    formatBibliographyEntry(item, numericIndex) {
      const authors = formatAuthorsVancouver(item.author) || item.publisher || "Unknown author";
      const year = getYearString(item, false);
      const container = item["container-title"] ? ` ${item["container-title"]}.` : "";
      const ref = item.DOI ? ` doi:${item.DOI}.` : item.URL ? ` Available from: ${item.URL}.` : "";
      return `${numericIndex}. ${authors}. ${item.title}.${container} ${year}.${ref}`
        .replace("..", ".")
        .trim();
    },
  },
};

const customFormatters = new Map<string, CitationStyleFormatter>();

export function registerCitationStyle(formatter: CitationStyleFormatter): void {
  customFormatters.set(formatter.id.toLowerCase(), formatter);
}

export function getCitationFormatter(style: string): CitationStyleFormatter {
  const key = style.trim().toLowerCase();
  const custom = customFormatters.get(key);
  if (custom) return custom;
  if (key in BUILTIN_FORMATTERS) {
    return BUILTIN_FORMATTERS[key as CitationStyle];
  }
  throw new Error(`Unsupported citation style: ${style}`);
}

export interface RenderedDraftCitations {
  renderedText: string;
  bibliography: Array<{ citeKey: string; index: number; formatted: string }>;
  citedKeys: string[];
  unknownKeys: string[];
}

function getSortKey(item: CslItem): string {
  const firstAuthor = item.author[0]
    ? getAuthorSurname(item.author[0]).toLowerCase()
    : item.title.toLowerCase();
  const year = getYearString(item);
  return `${firstAuthor}::${year}::${item.title.toLowerCase()}`;
}

export function renderDraftWithCitations(params: {
  draftText: string;
  registry: Map<string, CslItem>;
  style: string;
  inlineMode?: CitationInlineMode;
}): RenderedDraftCitations {
  const formatter = getCitationFormatter(params.style);
  const inlineMode = params.inlineMode ?? "inline_and_list";

  const citedOrder: string[] = [];
  const citedSet = new Set<string>();
  const numberByKey = new Map<string, number>();
  const unknownSet = new Set<string>();

  const renderedRaw = params.draftText.replace(/\[(@[^\]]+)\]/g, (fullMatch, inner: string) => {
    const segments = inner
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);

    const resolvedEntries: Array<{ item: CslItem; numericIndex: number; locator?: string }> = [];

    for (const seg of segments) {
      if (!seg.startsWith("@")) continue;
      const withoutAt = seg.slice(1).trim();
      const commaIdx = withoutAt.indexOf(",");
      const key = (commaIdx >= 0 ? withoutAt.slice(0, commaIdx) : withoutAt).trim();
      const locator = commaIdx >= 0 ? withoutAt.slice(commaIdx + 1).trim() : undefined;

      if (!/^[a-zA-Z0-9_:-]+$/.test(key)) continue;

      const item = params.registry.get(key);
      if (!item) {
        unknownSet.add(key);
        continue;
      }

      if (!citedSet.has(key)) {
        citedSet.add(key);
        citedOrder.push(key);
        numberByKey.set(key, citedOrder.length);
      }

      resolvedEntries.push({
        item,
        numericIndex: numberByKey.get(key)!,
        locator: locator || undefined,
      });
    }

    if (resolvedEntries.length === 0) {
      return inlineMode === "list_only" ? "" : fullMatch;
    }

    if (inlineMode === "list_only") {
      return "";
    }

    return formatter.formatInTextGroup(resolvedEntries);
  });

  const renderedText =
    inlineMode === "list_only"
      ? renderedRaw
          .replace(/\s+([.,;:])/g, "$1")
          .replace(/[ ]{2,}/g, " ")
          .trim()
      : renderedRaw;

  const orderedKeysForBib =
    formatter.kind === "numeric"
      ? [...citedOrder]
      : [...citedOrder].sort((a, b) => {
          const itemA = params.registry.get(a)!;
          const itemB = params.registry.get(b)!;
          return getSortKey(itemA).localeCompare(getSortKey(itemB));
        });

  const bibliography = orderedKeysForBib.map((citeKey, idx) => {
    const item = params.registry.get(citeKey)!;
    const numericIndex = formatter.kind === "numeric" ? numberByKey.get(citeKey)! : idx + 1;
    return {
      citeKey,
      index: numericIndex,
      formatted: formatter.formatBibliographyEntry(item, numericIndex),
    };
  });

  return {
    renderedText,
    bibliography,
    citedKeys: citedOrder,
    unknownKeys: Array.from(unknownSet),
  };
}
