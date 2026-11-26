import { describe, expect, it } from "vitest";
import type { CslItem } from "@/lib/citations/csl";
import { getCitationFormatter } from "@/lib/citations/formatter";
import { buildReaderCitationLabels } from "@/lib/citations/reader-format";
import {
  assignYearSuffixes,
  cleanSourceTitle,
  isMeaningfulTitle,
  normalizeCslItemForDisplay,
  organisationForUrl,
  shortTitleForCitation,
  withYearSuffixesForText,
} from "@/lib/citations/source-title";
import { keepWordsTogether } from "@/lib/export/keep-together";

const NBH = "‑";
const NBSP = " ";

// Titles exactly as the web search results stored them in production.
const ACADEMIA = "(PDF) Metoclopramide – Induced Extrapyramidal Signs and Symptoms";
const FDA_SUFFIX = "REGLAN (metoclopramide) tablets - accessdata.fda.gov";
const UNDERSCORES = "_".repeat(80);

const item = (over: Partial<CslItem> & { id: string }): CslItem => ({
  type: "report",
  title: "A title",
  author: [],
  ...over,
});

describe("cleanSourceTitle", () => {
  it("removes file-type tags and hosting-site suffixes", () => {
    expect(cleanSourceTitle(ACADEMIA)).toBe(
      "Metoclopramide – Induced Extrapyramidal Signs and Symptoms"
    );
    expect(cleanSourceTitle(FDA_SUFFIX)).toBe("REGLAN (metoclopramide) tablets");
    expect(cleanSourceTitle("[PDF] Kola nut caffeine | ResearchGate")).toBe("Kola nut caffeine");
    expect(cleanSourceTitle("Solar power in clinics - www.who.int")).toBe("Solar power in clinics");
  });

  it("keeps real subtitles and short titles intact", () => {
    expect(cleanSourceTitle("Malaria control - A review of 20 years")).toBe(
      "Malaria control - A review of 20 years"
    );
    expect(cleanSourceTitle("Report - who.int")).toBe("Report - who.int");
  });

  it("rejects titles with no real words", () => {
    expect(cleanSourceTitle(UNDERSCORES)).toBe("");
    expect(cleanSourceTitle("  ----  ")).toBe("");
    expect(cleanSourceTitle(null)).toBe("");
    expect(isMeaningfulTitle("Ab1")).toBe(false);
    expect(isMeaningfulTitle("WHO 2023")).toBe(true);
  });
});

describe("normalizeCslItemForDisplay", () => {
  it("credits authorless documents from known organisations to that organisation", () => {
    const fda = normalizeCslItemForDisplay(
      item({ id: "x", title: UNDERSCORES, URL: "https://www.accessdata.fda.gov/label.pdf" })
    );
    expect(fda.author).toEqual([{ literal: "U.S. Food and Drug Administration" }]);
    expect(fda.title).toBe("[Untitled document]");
    expect(organisationForUrl("https://evil-fda.gov.example.com/x")).toBeNull();
    expect(organisationForUrl("not a url")).toBeNull();
  });

  it("leaves real authors and publishers alone", () => {
    const withAuthor = item({
      id: "y",
      title: ACADEMIA,
      author: [{ family: "Okafor", given: "C." }],
      URL: "https://www.fda.gov/x",
    });
    expect(normalizeCslItemForDisplay(withAuthor).author).toEqual(withAuthor.author);
  });
});

describe("shortTitleForCitation", () => {
  it("takes the first words without ending on a dash or inside brackets", () => {
    expect(
      shortTitleForCitation("Metoclopramide – Induced Extrapyramidal Signs and Symptoms")
    ).toBe("Metoclopramide – Induced Extrapyramidal Signs");
    expect(shortTitleForCitation("REGLAN Injection (metoclopramide injection, USP)")).toBe(
      "REGLAN Injection (metoclopramide injection, USP)"
    );
    expect(shortTitleForCitation("Caffeine levels: a study")).toBe("Caffeine levels: a study");
    expect(shortTitleForCitation("[Untitled document]")).toBe("Untitled document");
  });
});

describe("same author, same year", () => {
  const fdaA = item({
    id: "a",
    title: "[Untitled document]",
    author: [{ literal: "U.S. Food and Drug Administration" }],
  });
  const fdaB = item({
    id: "b",
    title: "REGLAN (metoclopramide) tablets",
    author: [{ literal: "U.S. Food and Drug Administration" }],
  });
  const other = item({ id: "c", title: "Other", author: [{ family: "Obi" }] });

  it("letters the works by title and leaves unique ones alone", () => {
    const lettered = assignYearSuffixes(
      new Map([
        ["kb", fdaB],
        ["ka", fdaA],
        ["kc", other],
      ])
    );
    expect(lettered.get("ka")!["year-suffix"]).toBe("a");
    expect(lettered.get("kb")!["year-suffix"]).toBe("b");
    expect(lettered.get("kc")!["year-suffix"]).toBeUndefined();
  });

  it("counts letters only over the sources the text cites", () => {
    const fdaC = { ...fdaB, id: "z", title: "Another FDA label" };
    const registry = new Map([
      ["ka", fdaA],
      ["kb", fdaB],
      ["kz", fdaC],
    ]);
    const lettered = withYearSuffixesForText(registry, "Text [@ka]. More [@kb].");
    expect(lettered.get("ka")!["year-suffix"]).toBe("a");
    expect(lettered.get("kb")!["year-suffix"]).toBe("b");
    expect(lettered.get("kz")!["year-suffix"]).toBeUndefined();
  });

  it("shows the letters in citations and references with a hyphen that never breaks", () => {
    const registry = new Map([
      ["ka", fdaA],
      ["kb", fdaB],
    ]);
    const { clusters } = buildReaderCitationLabels({
      markdown: "Claim [@ka; @kb].",
      registry,
      style: "apa7",
    });
    expect(clusters["[@ka; @kb]"]!.label).toBe(
      `(U.S. Food and Drug Administration, n.d.${NBH}a; U.S. Food and Drug Administration, n.d.${NBH}b)`
    );
    const apa = getCitationFormatter("apa7");
    expect(apa.formatBibliographyEntry({ ...fdaA, "year-suffix": "a" }, 1)).toBe(
      `U.S. Food and Drug Administration (n.d.${NBH}a). [Untitled document].`
    );
    // Numeric styles never show the letter.
    expect(
      getCitationFormatter("ieee").formatBibliographyEntry({ ...fdaA, "year-suffix": "a" }, 1)
    ).not.toContain(NBH);
  });
});

describe("authorless sources in reference lists", () => {
  const academia = normalizeCslItemForDisplay(
    item({ id: "m", title: ACADEMIA, URL: "https://www.academia.edu/1/paper" })
  );

  it("puts the title first in APA and Harvard instead of 'Unknown author'", () => {
    expect(getCitationFormatter("apa7").formatBibliographyEntry(academia, 1)).toBe(
      "Metoclopramide – Induced Extrapyramidal Signs and Symptoms. (n.d.). https://www.academia.edu/1/paper"
    );
    expect(getCitationFormatter("harvard").formatBibliographyEntry(academia, 1)).toBe(
      "Metoclopramide – Induced Extrapyramidal Signs and Symptoms (n.d.). Available at: https://www.academia.edu/1/paper."
    );
  });

  it("cites them in text by a short clean title", () => {
    const { singleKeyLabels } = buildReaderCitationLabels({
      markdown: "Claim [@m].",
      registry: new Map([["m", academia]]),
      style: "apa7",
    });
    expect(singleKeyLabels.m).toBe("(Metoclopramide – Induced Extrapyramidal Signs, n.d.)");
  });
});

describe("keepWordsTogether with lettered years", () => {
  it("keeps the comma and lettered n.d. on one line", () => {
    expect(keepWordsTogether(`(U.S. Food and Drug Administration, n.d.${NBH}b)`)).toContain(
      `Administration,${NBSP}n.d.${NBH}b`
    );
  });
});
