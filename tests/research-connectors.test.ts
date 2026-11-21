import { describe, expect, it } from "vitest";
import { runConnectorsForQueries } from "@/lib/research/connectors/registry";
import {
  arxivConnector,
  coreConnector,
  crossrefConnector,
  doajConnector,
  europePmcConnector,
  openAlexConnector,
  reconstructOpenAlexAbstract,
  semanticScholarConnector,
} from "@/lib/research/connectors/scholarly";
import { enrichSourcesWithUnpaywall } from "@/lib/research/connectors/unpaywall";
import { braveSearchConnector, tavilyConnector } from "@/lib/research/connectors/web";
import { deduplicateSources } from "@/lib/research/dedupe";

const FIXED_NOW = new Date("2026-11-21T19:00:00.000Z");

describe("Scholarly source connectors (7 search APIs + Unpaywall)", () => {
  it("reconstructs OpenAlex inverted-index abstracts and parses OpenAlex records", async () => {
    expect(
      reconstructOpenAlexAbstract({ Solar: [0], microgrids: [1], improve: [2], uptime: [3] })
    ).toBe("Solar microgrids improve uptime");

    const mockFetch: typeof fetch = async () =>
      Response.json({
        results: [
          {
            id: "https://openalex.org/W1",
            doi: "https://doi.org/10.1016/j.rser.2024.01",
            title: "Microgrid Uptime in Rural Clinics",
            publication_year: 2024,
            cited_by_count: 42,
            type: "article",
            authorships: [{ author: { display_name: "Adaeze Nwosu" } }],
            primary_location: {
              landing_page_url: "https://sciencedirect.com/paper/1",
              pdf_url: "https://oa.example/paper.pdf",
              source: { display_name: "Renewable Energy", host_organization_name: "Elsevier" },
            },
            abstract_inverted_index: { Rural: [0], clinics: [1], benefit: [2] },
          },
        ],
      });

    const items = await openAlexConnector.search("solar microgrid", {
      maxResults: 5,
      timeoutMs: 5000,
      fetchFn: mockFetch,
      env: {},
      now: FIXED_NOW,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      doi: "https://doi.org/10.1016/j.rser.2024.01",
      title: "Microgrid Uptime in Rural Clinics",
      authors: ["Adaeze Nwosu"],
      year: 2024,
      citationCount: 42,
      abstractText: "Rural clinics benefit",
      openAccessPdfUrl: "https://oa.example/paper.pdf",
    });
  });

  it("parses Crossref, Semantic Scholar, CORE, Europe PMC, and DOAJ payloads", async () => {
    const crossrefFetch: typeof fetch = async () =>
      Response.json({
        message: {
          items: [
            {
              DOI: "10.1000/cr1",
              URL: "https://doi.org/10.1000/cr1",
              title: ["Grid Storage Cost Review"],
              publisher: "IEEE",
              "container-title": ["IEEE Access"],
              abstract: "<jats:p>Lifecycle cost &amp; reliability study.</jats:p>",
              "is-referenced-by-count": 19,
              author: [{ given: "Kofi", family: "Mensah" }],
              issued: { "date-parts": [[2023]] },
            },
          ],
        },
      });
    const cr = await crossrefConnector.search("grid storage", {
      maxResults: 5,
      timeoutMs: 5000,
      fetchFn: crossrefFetch,
      env: {},
      now: FIXED_NOW,
    });
    expect(cr[0]?.abstractText).toBe("Lifecycle cost & reliability study.");
    expect(cr[0]?.authors).toEqual(["Kofi Mensah"]);

    const s2Fetch: typeof fetch = async () =>
      Response.json({
        data: [
          {
            title: "Battery Degradation in Tropical Climates",
            url: "https://semanticscholar.org/paper/1",
            year: 2025,
            venue: "Applied Energy",
            citationCount: 11,
            abstract: "Empirical thermal analysis.",
            authors: [{ name: "Ibrahim Musa" }],
            externalIds: { DOI: "10.1000/s2" },
            openAccessPdf: { url: "https://oa.example/s2.pdf" },
          },
        ],
      });
    const s2 = await semanticScholarConnector.search("battery", {
      maxResults: 5,
      timeoutMs: 5000,
      fetchFn: s2Fetch,
      env: {},
      now: FIXED_NOW,
    });
    expect(s2[0]?.doi).toBe("10.1000/s2");

    const coreFetch: typeof fetch = async () =>
      Response.json({
        results: [
          {
            title: "Open Access Minigrid Study",
            doi: "10.1000/core1",
            yearPublished: 2024,
            publisher: "University Press",
            abstract: "Full open-access report.",
            downloadUrl: "https://core.ac.uk/download/1.pdf",
            authors: [{ name: "Bola Ade" }],
          },
        ],
      });
    expect(coreConnector.isEnabled({})).toBe(false);
    expect(coreConnector.isEnabled({ CORE_API_KEY: "k" })).toBe(true);
    const coreRes = await coreConnector.search("minigrid", {
      maxResults: 5,
      timeoutMs: 5000,
      fetchFn: coreFetch,
      env: { CORE_API_KEY: "test-core-key" },
      now: FIXED_NOW,
    });
    expect(coreRes[0]?.openAccessPdfUrl).toBe("https://core.ac.uk/download/1.pdf");

    const epmcFetch: typeof fetch = async () =>
      Response.json({
        resultList: {
          result: [
            {
              id: "PMC12345",
              source: "PMC",
              doi: "10.1000/epmc1",
              title: "Cold Chain Solar Power in Primary Health Centers",
              authorString: "Okafor C, Bello T.",
              pubYear: "2024",
              journalTitle: "Lancet Global Health",
              abstractText: "Evaluates vaccine refrigeration uptime.",
              citedByCount: 30,
              fullTextUrlList: {
                fullTextUrl: [{ url: "https://europepmc.org/pdf/1", documentStyle: "pdf" }],
              },
            },
          ],
        },
      });
    const epmc = await europePmcConnector.search("cold chain", {
      maxResults: 5,
      timeoutMs: 5000,
      fetchFn: epmcFetch,
      env: {},
      now: FIXED_NOW,
    });
    expect(epmc[0]?.authors).toEqual(["Okafor C", "Bello T"]);

    const doajFetch: typeof fetch = async () =>
      Response.json({
        results: [
          {
            bibjson: {
              title: "Community Energy Governance in West Africa",
              year: "2023",
              abstract: "Governance study across 12 communities.",
              author: [{ name: "Ngozi Eze" }],
              identifier: [{ type: "doi", id: "10.1000/doaj1" }],
              link: [{ type: "fulltext", url: "https://journal.example/article/1" }],
              journal: { title: "African Energy Journal", publisher: "Open Science Press" },
            },
          },
        ],
      });
    const doaj = await doajConnector.search("community energy", {
      maxResults: 5,
      timeoutMs: 5000,
      fetchFn: doajFetch,
      env: {},
      now: FIXED_NOW,
    });
    expect(doaj[0]?.publisher).toBe("Open Science Press");
  });

  it("parses arXiv Atom XML entries cleanly", async () => {
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>https://arxiv.org/abs/2405.12345v1</id>
    <published>2024-05-20T12:00:00Z</published>
    <title>Distributed Microgrid Control Under Intermittent Load</title>
    <summary>Proposes a fault-tolerant control algorithm for rural DC microgrids.</summary>
    <author><name>Chinedu Okeke</name></author>
    <author><name>Fatima Yusuf</name></author>
    <arxiv:doi>10.48550/arXiv.2405.12345</arxiv:doi>
  </entry>
</feed>`;

    const items = await arxivConnector.search("microgrid control", {
      maxResults: 5,
      timeoutMs: 5000,
      fetchFn: async () => new Response(sampleXml, { status: 200 }),
      env: {},
      now: FIXED_NOW,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: "Distributed Microgrid Control Under Intermittent Load",
      authors: ["Chinedu Okeke", "Fatima Yusuf"],
      year: 2024,
      doi: "10.48550/arXiv.2405.12345",
      openAccessPdfUrl: "https://arxiv.org/pdf/2405.12345v1",
    });
  });

  it("enriches DOI sources with legal open-access PDFs via Unpaywall", async () => {
    const deduped = deduplicateSources([
      {
        url: "https://doi.org/10.1016/j.test.2024",
        doi: "10.1016/j.test.2024",
        title: "Paywalled Journal With Green OA Copy",
        authors: ["Author One"],
        year: 2024,
        sourceType: "peer_reviewed",
        connectorName: "crossref",
        retrievedAt: FIXED_NOW,
      },
    ]);

    const stats = await enrichSourcesWithUnpaywall(deduped, {
      email: "research@collate.local",
      timeoutMs: 5000,
      fetchFn: async () =>
        Response.json({
          is_oa: true,
          best_oa_location: { url_for_pdf: "https://repo.uni.edu/green-oa.pdf" },
        }),
    });

    expect(stats).toEqual({ checked: 1, enriched: 1 });
    expect(deduped[0]?.openAccessPdfUrl).toBe("https://repo.uni.edu/green-oa.pdf");
    expect(deduped[0]?.connectorNames).toContain("unpaywall");
  });
});

describe("Web search connectors (Tavily + Brave) and fault-isolated fan-out", () => {
  it("parses Tavily and Brave web results and classifies institutional domains", async () => {
    const tavilyRes = await tavilyConnector.search("rural clinic solar stats", {
      maxResults: 5,
      timeoutMs: 5000,
      fetchFn: async () =>
        Response.json({
          results: [
            {
              url: "https://www.worldbank.org/en/topic/energy/minigrids",
              title: "Mini Grids for Half a Billion People",
              content: "World Bank institutional dataset on mini-grid reliability.",
              published_date: "2024-03-10",
            },
          ],
        }),
      env: { TAVILY_API_KEY: "tvly-test" },
      now: FIXED_NOW,
    });
    expect(tavilyRes[0]?.sourceType).toBe("institutional");
    expect(tavilyRes[0]?.year).toBe(2024);

    const braveRes = await braveSearchConnector.search("solar clinic cost", {
      maxResults: 5,
      timeoutMs: 5000,
      fetchFn: async () =>
        Response.json({
          web: {
            results: [
              {
                url: "https://energyblog.example/microgrid-guide",
                title: "Microgrid Guide",
                description: "Overview of battery sizing.",
                page_age: "2025-01-04T00:00:00",
              },
            ],
          },
        }),
      env: { BRAVE_SEARCH_API_KEY: "brave-test" },
      now: FIXED_NOW,
    });
    expect(braveRes[0]?.sourceType).toBe("web");
    expect(braveRes[0]?.year).toBe(2025);
  });

  it("isolates failing or disabled connectors without crashing the research sweep", async () => {
    const healthyConnector = {
      name: "healthy_mock",
      kind: "scholarly" as const,
      isEnabled: () => true,
      async search() {
        return [
          {
            url: "https://nature.com/articles/ok-1",
            doi: "10.1038/ok-1",
            title: "Verified Surviving Paper",
            authors: ["Dr. Test"],
            year: 2025,
            sourceType: "peer_reviewed" as const,
            connectorName: "healthy_mock",
            retrievedAt: FIXED_NOW,
          },
        ];
      },
    };

    const failingConnector = {
      name: "failing_mock",
      kind: "web" as const,
      isEnabled: () => true,
      async search() {
        throw new Error("Simulated HTTP 429 rate limit");
      },
    };

    const disabledConnector = {
      name: "disabled_mock",
      kind: "web" as const,
      isEnabled: () => false,
      async search() {
        return [];
      },
    };

    const result = await runConnectorsForQueries(
      [{ query: "solar microgrid clinics", intent: "scholarly" }],
      {
        connectors: [healthyConnector, failingConnector, disabledConnector],
        env: {},
        now: FIXED_NOW,
      }
    );

    expect(result.enabledConnectors).toEqual(["healthy_mock", "failing_mock"]);
    expect(result.skippedConnectors).toEqual(["disabled_mock"]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.title).toBe("Verified Surviving Paper");

    const failedStat = result.stats.find((s) => s.connector === "failing_mock");
    expect(failedStat?.queriesFailed).toBe(1);
    expect(failedStat?.errors[0]).toContain("HTTP 429");
  });
});
