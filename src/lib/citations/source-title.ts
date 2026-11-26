import type { CslItem } from "./csl";

/**
 * Cleans the titles that web search results give us before they are shown in a citation.
 *
 * Web pages often carry a file-type tag ("(PDF) …" from ResearchGate / Academia), a site-name
 * suffix ("… - accessdata.fda.gov", "… | ResearchGate"), or no usable title at all (an FDA PDF
 * whose first line is a row of underscores). When a source has no author, its title becomes the
 * in-text citation, so these leak straight into the chapter as "((PDF) Metoclopramide –, n.d.)".
 */

const LEADING_FILE_TAG =
  /^\s*(?:[([]\s*(?:pdf|doc|docx|html?|ppt|pptx|xls|xlsx)\s*[)\]]|(?:pdf|doc|docx)\s*:)\s*/i;

/** Repository and aggregator names that only identify where the page was hosted. */
const HOSTING_SITE_NAMES = new Set(
  [
    "researchgate",
    "academia.edu",
    "academia",
    "sciencedirect",
    "pubmed",
    "pmc",
    "ncbi",
    "europe pmc",
    "semantic scholar",
    "google scholar",
    "jstor",
    "scribd",
    "slideshare",
    "studocu",
    "course hero",
    "wikipedia",
    "springerlink",
    "wiley online library",
    "taylor & francis online",
    "tandfonline",
    "sage journals",
    "mdpi",
    "frontiers",
    "plos",
    "europe pmc",
  ].map((s) => s.toLowerCase())
);

const SITE_SUFFIX = /\s+[-–—|·:]\s+([^\-–—|·:]{2,80})$/;

function looksLikeSiteName(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (HOSTING_SITE_NAMES.has(t)) return true;
  // A bare domain such as "accessdata.fda.gov" or "www.who.int".
  return /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(t);
}

/** True when a title has real words, not just punctuation, underscores or digits. */
export function isMeaningfulTitle(title: string): boolean {
  const compact = title.replace(/\s+/g, "");
  if (compact.length === 0) return false;
  const letters = (compact.match(/\p{L}/gu) ?? []).length;
  return letters >= 3 && letters / compact.length >= 0.4;
}

/** Returns the cleaned title, or "" when nothing usable is left. */
export function cleanSourceTitle(raw: string | null | undefined): string {
  let title = (raw ?? "").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 2; i++) title = title.replace(LEADING_FILE_TAG, "").trim();

  // Drop site-name suffixes, keeping the title when what is left would be too short.
  for (let i = 0; i < 2; i++) {
    const match = title.match(SITE_SUFFIX);
    if (!match || !looksLikeSiteName(match[1]!)) break;
    const rest = title.slice(0, match.index).trim();
    if (rest.split(" ").length < 2) break;
    title = rest;
  }

  return isMeaningfulTitle(title) ? title : "";
}

/** Organisations whose documents are usually cited with the organisation as author. */
const ORGANISATION_BY_DOMAIN: Array<[string, string]> = [
  ["fda.gov", "U.S. Food and Drug Administration"],
  ["cdc.gov", "Centers for Disease Control and Prevention"],
  ["who.int", "World Health Organization"],
  ["ema.europa.eu", "European Medicines Agency"],
  ["nice.org.uk", "National Institute for Health and Care Excellence"],
  ["ncdc.gov.ng", "Nigeria Centre for Disease Control"],
  ["nafdac.gov.ng", "National Agency for Food and Drug Administration and Control"],
  ["unicef.org", "UNICEF"],
  ["un.org", "United Nations"],
  ["worldbank.org", "World Bank"],
  ["imf.org", "International Monetary Fund"],
  ["oecd.org", "OECD"],
];

export function organisationForUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [domain, name] of ORGANISATION_BY_DOMAIN) {
    if (host === domain || host.endsWith(`.${domain}`)) return name;
  }
  return null;
}

export const UNTITLED_DOCUMENT = "[Untitled document]";

/**
 * The version of a stored citation that is shown and exported: a cleaned title (or
 * "[Untitled document]"), and, for an authorless page from a known organisation such as the
 * FDA, that organisation as the author, which is how APA, Harvard and others cite such documents.
 */
export function normalizeCslItemForDisplay(item: CslItem): CslItem {
  const title = cleanSourceTitle(item.title) || UNTITLED_DOCUMENT;
  const organisation =
    item.author.length === 0 && !item.publisher?.trim() ? organisationForUrl(item.URL) : null;
  return {
    ...item,
    title,
    ...(organisation ? { author: [{ literal: organisation }] } : {}),
  };
}

/**
 * The few title words used in place of an author in an in-text citation ("Metoclopramide-Induced
 * Extrapyramidal Signs"), cut at a word boundary, never inside brackets and never ending on a
 * dash or comma.
 */
export function shortTitleForCitation(title: string, maxWords = 4): string {
  if (title === UNTITLED_DOCUMENT) return "Untitled document";
  const words = title.split(/\s+/).filter(Boolean);
  const isWord = (w: string) => /[\p{L}\p{N}]/u.test(w);
  const picked: string[] = [];
  let counted = 0;
  let depth = 0;
  for (const word of words) {
    if (counted >= maxWords && depth === 0) break;
    if (counted >= maxWords + 4) break;
    picked.push(word);
    if (isWord(word)) counted++;
    depth += (word.match(/[([]/g) ?? []).length - (word.match(/[)\]]/g) ?? []).length;
  }
  // Still inside an unclosed bracket: drop back to before it opened.
  if (depth > 0) {
    const open = picked.findIndex((w) => /[([]/.test(w));
    if (open > 0) picked.splice(open);
  }
  let short = picked.join(" ");
  short = short.replace(/[\s\-–—:;,.|/]+$/u, "").trim();
  return short || title.slice(0, 40).trim();
}

/**
 * Gives works by the same author in the same year the letters a, b, c… (ordered by title, as in
 * an APA reference list), so two FDA labels with no date read "(U.S. Food and Drug
 * Administration, n.d.-a)" and "(…, n.d.-b)" instead of looking like one source. Works that are
 * unique for their author and year get no letter. Returns new items; the input is not changed.
 */
export function assignYearSuffixes(items: Map<string, CslItem>): Map<string, CslItem> {
  const identity = (item: CslItem) => {
    const who =
      item.author.length > 0
        ? item.author
            .map((a) => ("literal" in a ? a.literal : `${a.family}|${a.given ?? ""}`))
            .join(";")
        : `title:${item.publisher?.trim() || shortTitleForCitation(item.title)}`;
    const year = item.issued?.["date-parts"]?.[0]?.[0] ?? "nd";
    return `${who.toLowerCase()}::${year}`;
  };

  const groups = new Map<string, string[]>();
  for (const [key, item] of items) {
    const id = identity(item);
    groups.set(id, [...(groups.get(id) ?? []), key]);
  }

  const result = new Map<string, CslItem>();
  const suffixByKey = new Map<string, string>();
  for (const keys of groups.values()) {
    if (keys.length < 2) continue;
    keys
      .slice()
      .sort((a, b) => {
        const ta = items.get(a)!.title.toLowerCase();
        const tb = items.get(b)!.title.toLowerCase();
        return ta < tb ? -1 : ta > tb ? 1 : a < b ? -1 : 1;
      })
      .forEach((key, i) => suffixByKey.set(key, String.fromCharCode(97 + (i % 26))));
  }
  for (const [key, item] of items) {
    const suffix = suffixByKey.get(key);
    const { "year-suffix": _unused, ...rest } = item;
    result.set(key, suffix ? { ...rest, "year-suffix": suffix } : rest);
  }
  return result;
}

/**
 * Applies same-author-year letters over only the sources cited in the given text, so a chapter
 * or exported document letters its own citations a, b, c… in step with its own reference list.
 */
export function withYearSuffixesForText(
  registry: Map<string, CslItem>,
  ...texts: string[]
): Map<string, CslItem> {
  const cited = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(/@([a-zA-Z0-9_:-]+)/g)) {
      if (registry.has(match[1]!)) cited.add(match[1]!);
    }
  }
  const subset = new Map<string, CslItem>();
  for (const key of cited) subset.set(key, registry.get(key)!);
  const lettered = assignYearSuffixes(subset);
  const result = new Map<string, CslItem>();
  for (const [key, item] of registry) result.set(key, lettered.get(key) ?? item);
  return result;
}
