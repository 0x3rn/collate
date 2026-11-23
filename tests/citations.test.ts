import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import {
  loadProjectCitationMap,
  syncCitationRegistryForProject,
  verifyProjectCitations,
} from "@/db/queries/citations";
import { createProjectForUser } from "@/db/queries/projects";
import { CITATION_STYLES, sources, users } from "@/db/schema";
import { buildCslItemFromSource, type CslItem } from "@/lib/citations/csl";
import { registerCitationStyle, renderDraftWithCitations } from "@/lib/citations/formatter";
import { verifyDoiRecord, verifySourceUrlRecord } from "@/lib/citations/verifier";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

const RETRIEVED = new Date("2026-11-21T23:00:00.000Z");

function buildSampleRegistry(): Map<string, CslItem> {
  const okonkwo = buildCslItemFromSource({
    citeKey: "okonkwo2024",
    title: "Solar Microgrid Reliability in Rural Health Clinics",
    authors: ["Adaeze Okonkwo", "Bamidele Mensah"],
    year: 2024,
    venue: "Energy Policy",
    publisher: "Elsevier",
    doi: "10.1016/j.enpol.2024.113900",
    url: "https://doi.org/10.1016/j.enpol.2024.113900",
    sourceType: "peer_reviewed",
    retrievedAt: RETRIEVED,
  });

  const adeyemi = buildCslItemFromSource({
    citeKey: "adeyemi2023",
    title: "Battery Storage Economics in West Africa",
    authors: ["Kolawole Adeyemi", "Fatima Yusuf", "Chinedu Eze"],
    year: 2023,
    venue: "Renewable Energy",
    publisher: "Elsevier",
    doi: "10.1016/j.renene.2023.105001",
    url: "https://doi.org/10.1016/j.renene.2023.105001",
    sourceType: "peer_reviewed",
    retrievedAt: RETRIEVED,
  });

  const uncited = buildCslItemFromSource({
    citeKey: "unused2022",
    title: "Uncited Background Paper",
    authors: ["Unused Author"],
    year: 2022,
    venue: "Unused Journal",
    url: "https://example.org/unused",
    sourceType: "peer_reviewed",
    retrievedAt: RETRIEVED,
  });

  return new Map([
    ["okonkwo2024", okonkwo],
    ["adeyemi2023", adeyemi],
    ["unused2022", uncited],
  ]);
}

const SAMPLE_DRAFT =
  "Rural clinic uptime improved significantly after solar microgrid deployment [@okonkwo2024]. Lifecycle battery costs decline over ten-year horizons [@okonkwo2024; @adeyemi2023].";

describe("Phase 6 — Citation formatter across all 6 CSL styles", () => {
  const registry = buildSampleRegistry();

  it("renders accurate in-text citations and cited-only bibliographies for every supported style", () => {
    for (const style of CITATION_STYLES) {
      const out = renderDraftWithCitations({
        draftText: SAMPLE_DRAFT,
        registry,
        style,
        inlineMode: "inline_and_list",
      });

      expect(out.unknownKeys).toEqual([]);
      expect(out.bibliography.map((b) => b.citeKey)).not.toContain("unused2022");
      expect(out.bibliography).toHaveLength(2);
    }

    const apa = renderDraftWithCitations({ draftText: SAMPLE_DRAFT, registry, style: "apa7" });
    expect(apa.renderedText).toContain("(Okonkwo & Mensah, 2024)");
    expect(apa.renderedText).toContain("(Okonkwo & Mensah, 2024; Adeyemi et al., 2023)");
    expect(apa.bibliography[0]?.citeKey).toBe("adeyemi2023");
    expect(apa.bibliography[1]?.formatted).toBe(
      "Okonkwo, A., & Mensah, B. (2024). Solar Microgrid Reliability in Rural Health Clinics. Energy Policy. https://doi.org/10.1016/j.enpol.2024.113900"
    );

    const harvard = renderDraftWithCitations({
      draftText: "Clinics saw steady power [@okonkwo2024, p. 14].",
      registry,
      style: "harvard",
    });
    expect(harvard.renderedText).toBe("Clinics saw steady power (Okonkwo and Mensah 2024, p. 14).");
    expect(harvard.bibliography[0]?.formatted).toContain(
      "Okonkwo, A. and Mensah, B. (2024) 'Solar Microgrid Reliability in Rural Health Clinics', Energy Policy. doi:10.1016/j.enpol.2024.113900."
    );

    const mla = renderDraftWithCitations({ draftText: SAMPLE_DRAFT, registry, style: "mla9" });
    expect(mla.renderedText).toContain("(Okonkwo and Mensah)");
    expect(mla.renderedText).toContain("(Okonkwo and Mensah; Adeyemi et al.)");
    expect(mla.bibliography[1]?.formatted).toContain(
      'Okonkwo, Adaeze, and Bamidele Mensah. "Solar Microgrid Reliability in Rural Health Clinics." Energy Policy, 2024'
    );

    const chicago = renderDraftWithCitations({
      draftText: SAMPLE_DRAFT,
      registry,
      style: "chicago",
    });
    expect(chicago.renderedText).toContain("(Okonkwo and Mensah 2024)");
    expect(chicago.bibliography[1]?.formatted).toContain(
      'Okonkwo, Adaeze, and Bamidele Mensah. 2024. "Solar Microgrid Reliability in Rural Health Clinics."'
    );

    const ieee = renderDraftWithCitations({ draftText: SAMPLE_DRAFT, registry, style: "ieee" });
    expect(ieee.renderedText).toContain("[1].");
    expect(ieee.renderedText).toContain("[1], [2].");
    expect(ieee.bibliography[0]?.citeKey).toBe("okonkwo2024");
    expect(ieee.bibliography[0]?.formatted).toBe(
      '[1] A. Okonkwo and B. Mensah, "Solar Microgrid Reliability in Rural Health Clinics", Energy Policy, 2024, doi: 10.1016/j.enpol.2024.113900.'
    );

    const vancouver = renderDraftWithCitations({
      draftText: SAMPLE_DRAFT,
      registry,
      style: "vancouver",
    });
    expect(vancouver.renderedText).toContain("(1).");
    expect(vancouver.renderedText).toContain("(1, 2).");
    expect(vancouver.bibliography[0]?.formatted).toContain(
      "1. Okonkwo A, Mensah B. Solar Microgrid Reliability in Rural Health Clinics. Energy Policy. 2024. doi:10.1016/j.enpol.2024.113900."
    );
  });

  it("supports list_only mode and flags invented/unknown citation keys", () => {
    const listOnly = renderDraftWithCitations({
      draftText: "Uptime improved [@okonkwo2024]. Fake claim [@invented2099].",
      registry,
      style: "apa7",
      inlineMode: "list_only",
    });

    expect(listOnly.renderedText).toBe("Uptime improved. Fake claim.");
    expect(listOnly.citedKeys).toEqual(["okonkwo2024"]);
    expect(listOnly.unknownKeys).toEqual(["invented2099"]);
    expect(listOnly.bibliography).toHaveLength(1);
  });

  it("supports registering additional custom CSL styles cleanly", () => {
    registerCitationStyle({
      id: "nature_custom",
      kind: "numeric",
      formatInTextGroup: (entries) => entries.map((e) => `^${e.numericIndex}`).join(","),
      formatBibliographyEntry: (item, idx) => `${idx}. ${item.title}`,
    });

    const res = renderDraftWithCitations({
      draftText: "Finding [@okonkwo2024].",
      registry,
      style: "nature_custom",
    });
    expect(res.renderedText).toBe("Finding ^1.");
  });
});

describe("Phase 6 — Fake DOI rejection, URL verification, and D1 citation registry", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;

  beforeEach(async () => {
    d1Ctx = createInMemoryD1();
    d1Ctx.applyMigrations();
    db = createDb(d1Ctx.d1);

    await db.insert(users).values({
      id: "usr_cit",
      email: "cit@uni.edu",
      emailVerified: true,
      name: "Citation Tester",
      creditsBalance: 10,
      createdAt: RETRIEVED,
      updatedAt: RETRIEVED,
    });
    await createProjectForUser(db, {
      id: "prj_cit",
      userId: "usr_cit",
      type: "research",
      title: "Solar Microgrid Storage",
      now: RETRIEVED,
    });
  });

  afterEach(() => {
    d1Ctx.close();
  });

  it("rejects malformed DOIs, non-existent 404 DOIs, title-mismatched DOIs, and dead URLs", async () => {
    const badSyntax = await verifyDoiRecord("not-a-real-doi", "Any Title");
    expect(badSyntax.valid).toBe(false);
    expect(badSyntax.status).toBe("fake_or_not_found");

    const fakeDoi = await verifyDoiRecord("10.9999/fake-hallucinated-doi-2026", "Fake Study", {
      fetchFn: async () => new Response("Resource not found.", { status: 404 }),
    });
    expect(fakeDoi.valid).toBe(false);
    expect(fakeDoi.status).toBe("fake_or_not_found");

    const mismatch = await verifyDoiRecord(
      "10.1016/j.enpol.2024.113900",
      "Completely Different Quantum Physics Paper",
      {
        fetchFn: async () =>
          Response.json({
            message: { title: ["Solar Microgrid Reliability in Rural Health Clinics"] },
          }),
      }
    );
    expect(mismatch.valid).toBe(false);
    expect(mismatch.status).toBe("title_mismatch");

    const deadUrl = await verifySourceUrlRecord("https://example.org/deleted-report", {
      fetchFn: async () => new Response("Not found", { status: 404 }),
    });
    expect(deadUrl.valid).toBe(false);
    expect(deadUrl.status).toBe("dead_url");
  });

  it("syncs verified D1 sources to citations, rejects fake DOIs, and excludes rejected entries from registry", async () => {
    await db.insert(sources).values([
      {
        id: "src_real",
        projectId: "prj_cit",
        url: "https://doi.org/10.1016/j.real.2024",
        canonicalUrl: "https://doi.org/10.1016/j.real.2024",
        doi: "10.1016/j.real.2024",
        title: "Solar Microgrid Uptime Study",
        normalizedTitle: "solar microgrid uptime study",
        authorsJson: JSON.stringify(["Adaeze Okonkwo"]),
        year: 2024,
        venue: "Energy Policy",
        sourceType: "peer_reviewed",
        connectorName: "crossref",
        credibilityScore: 90,
        relevanceScore: 85,
        retrievedAt: RETRIEVED,
        createdAt: RETRIEVED,
      },
      {
        id: "src_fake",
        projectId: "prj_cit",
        url: "https://doi.org/10.9999/fake.2024",
        canonicalUrl: "https://doi.org/10.9999/fake.2024",
        doi: "10.9999/fake.2024",
        title: "Invented Hallucinated Paper",
        normalizedTitle: "invented hallucinated paper",
        authorsJson: JSON.stringify(["Adaeze Okonkwo"]),
        year: 2024,
        venue: "Fake Journal",
        sourceType: "peer_reviewed",
        connectorName: "web",
        credibilityScore: 50,
        relevanceScore: 50,
        retrievedAt: RETRIEVED,
        createdAt: RETRIEVED,
      },
    ]);

    const synced = await syncCitationRegistryForProject(db, "prj_cit", RETRIEVED);
    expect(synced).toHaveLength(2);
    expect(synced.map((c) => c.citeKey)).toEqual(["okonkwo2024", "okonkwo2024a"]);

    const verifyStats = await verifyProjectCitations(db, "prj_cit", {
      fetchFn: async (input) => {
        const url = String(input);
        if (url.includes("10.1016%2Fj.real.2024")) {
          return Response.json({ message: { title: ["Solar Microgrid Uptime Study"] } });
        }
        return new Response("Not found", { status: 404 });
      },
      now: RETRIEVED,
    });

    expect(verifyStats).toEqual({ verified: 1, rejected: 1, unverified: 0 });

    const safeMap = await loadProjectCitationMap(db, "prj_cit", { excludeRejected: true });
    expect(safeMap.size).toBe(1);
    expect(safeMap.has("okonkwo2024")).toBe(true);
    expect(safeMap.has("okonkwo2024a")).toBe(false);

    // Calling verifyProjectCitations again with default onlyUnverified=true makes zero HTTP calls
    let secondPassCalls = 0;
    const secondStats = await verifyProjectCitations(db, "prj_cit", {
      fetchFn: async () => {
        secondPassCalls++;
        return new Response("unexpected", { status: 500 });
      },
      now: RETRIEVED,
    });
    expect(secondPassCalls).toBe(0);
    expect(secondStats).toEqual({ verified: 0, rejected: 0, unverified: 0 });
  });
});
