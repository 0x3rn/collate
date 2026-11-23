import { describe, expect, it } from "vitest";
import { CITATION_STYLES, type ProjectType } from "@/db/schema";
import { buildCslItemFromSource } from "@/lib/citations/csl";
import { renderDraftWithCitations } from "@/lib/citations/formatter";
import { evaluateFeasibility, type FeasibilitySourceInput } from "@/lib/feasibility/evaluator";

const REF_YEAR = 2026;

function buildStrongSources(
  topic: string,
  subtopics: string[],
  count = 16
): FeasibilitySourceInput[] {
  const publishers = [
    "Elsevier",
    "Springer Nature",
    "IEEE",
    "Oxford University Press",
    "World Bank",
    "WHO",
    "Cambridge University Press",
  ];
  return Array.from({ length: count }, (_, i) => ({
    url: `https://pub${i % publishers.length}.edu/paper-${i}`,
    doi: `10.1000/eval-${i}`,
    title: `Empirical study ${i} on ${subtopics[i % subtopics.length]} (${topic.slice(0, 24)})`,
    year: 2020 + (i % 6),
    publisher: publishers[i % publishers.length],
    sourceType: "peer_reviewed",
    credibilityScore: 84,
    relevanceScore: 80,
    accessStatus: i % 2 === 0 ? "full_text" : "abstract_only",
    matchedSubtopics: [subtopics[i % subtopics.length]!],
  }));
}

const FEASIBLE_SEEDS: Array<{ topic: string; type: ProjectType; level: string }> = [
  // Energy & Environment (10)
  {
    topic:
      "Solar microgrid reliability for vaccine cold-chain storage in rural Nigerian health clinics",
    type: "thesis",
    level: "Masters",
  },
  {
    topic:
      "Lifecycle cost comparison of lithium iron phosphate versus lead-acid batteries in off-grid systems",
    type: "project",
    level: "Undergraduate",
  },
  {
    topic:
      "Urban drainage capacity and seasonal flash flood mitigation in coastal Lagos municipalities",
    type: "thesis",
    level: "Bachelors",
  },
  {
    topic: "Household biogas digester adoption and indoor air quality in peri-urban East Africa",
    type: "research",
    level: "Masters",
  },
  {
    topic: "Grid integration challenges of utility-scale solar photovoltaic plants in West Africa",
    type: "thesis",
    level: "PhD",
  },
  {
    topic: "Microplastic bioaccumulation in freshwater tilapia across tropical river basins",
    type: "research",
    level: "Masters",
  },
  {
    topic:
      "Waste-to-energy municipal solid waste incineration feasibility in rapidly growing African cities",
    type: "project",
    level: "Undergraduate",
  },
  {
    topic: "Mangrove restoration and coastal erosion control along the Niger Delta shoreline",
    type: "thesis",
    level: "Masters",
  },
  {
    topic:
      "Smart metering impact on residential electricity theft reduction in distribution networks",
    type: "project",
    level: "Undergraduate",
  },
  {
    topic:
      "Drought resilience of rainwater harvesting reservoirs in semi-arid northern farming communities",
    type: "research",
    level: "Masters",
  },

  // Health & Medicine (10)
  {
    topic:
      "Antimicrobial resistance gene prevalence in municipal hospital wastewater treatment systems",
    type: "thesis",
    level: "PhD",
  },
  {
    topic: "Deep learning sensitivity for early diabetic retinopathy screening in primary eye care",
    type: "research",
    level: "Masters",
  },
  {
    topic:
      "Maternal antenatal clinic attendance and mobile SMS reminder programs in rural districts",
    type: "project",
    level: "Undergraduate",
  },
  {
    topic:
      "Malaria rapid diagnostic test accuracy in low-transmission pediatric outpatient clinics",
    type: "research",
    level: "Masters",
  },
  {
    topic: "Electronic health record adoption barriers among tertiary teaching hospital nurses",
    type: "project",
    level: "Undergraduate",
  },
  {
    topic:
      "Community health worker training and neonatal mortality reduction in sub-Saharan Africa",
    type: "thesis",
    level: "Masters",
  },
  {
    topic: "Hypertension medication adherence among urban outpatient adults with comorbid diabetes",
    type: "research",
    level: "Masters",
  },
  {
    topic: "Cold-chain temperature excursions during last-mile childhood immunization delivery",
    type: "project",
    level: "Undergraduate",
  },
  {
    topic: "Telemedicine consultation outcomes for rural mental health primary care services",
    type: "thesis",
    level: "Masters",
  },
  {
    topic: "Point-of-care tuberculosis molecular testing turnaround time in district laboratories",
    type: "research",
    level: "PhD",
  },

  // Economics, Finance & Governance (10)
  {
    topic: "Mobile money adoption and working capital access among micro-enterprise market traders",
    type: "project",
    level: "Undergraduate",
  },
  {
    topic: "Central bank monetary policy rate transmission to commercial bank lending spreads",
    type: "thesis",
    level: "Masters",
  },
  {
    topic:
      "Fiscal decentralization and primary school completion rates across developing federations",
    type: "research",
    level: "Masters",
  },
  {
    topic:
      "Digital tax administration reforms and small business compliance costs in emerging markets",
    type: "thesis",
    level: "PhD",
  },
  {
    topic:
      "Agricultural index insurance uptake among smallholder maize farmers facing rainfall shocks",
    type: "research",
    level: "Masters",
  },
  {
    topic:
      "Remittance inflows and household education expenditure stability in West African economies",
    type: "project",
    level: "Undergraduate",
  },
  {
    topic:
      "Public-private partnership toll road financing risks in sub-Saharan transport corridors",
    type: "thesis",
    level: "Masters",
  },
  {
    topic: "Value-added tax threshold design and informal sector formalization incentives",
    type: "research",
    level: "Masters",
  },
  {
    topic: "Foreign exchange volatility pass-through to urban staple food inflation rates",
    type: "project",
    level: "Undergraduate",
  },
  {
    topic: "Cooperative microfinance group lending default dynamics during macroeconomic downturns",
    type: "thesis",
    level: "Bachelors",
  },

  // Computer Science & Engineering (10)
  {
    topic:
      "Federated learning privacy guarantees in distributed hospital diagnostic imaging networks",
    type: "thesis",
    level: "PhD",
  },
  {
    topic: "Low-power LoRaWAN sensor networks for precision soil moisture irrigation scheduling",
    type: "project",
    level: "Undergraduate",
  },
  {
    topic:
      "Static analysis versus fuzz testing effectiveness for detecting memory safety bugs in C",
    type: "research",
    level: "Masters",
  },
  {
    topic: "Edge caching strategies for low-bandwidth educational video streaming in rural schools",
    type: "project",
    level: "Undergraduate",
  },
  {
    topic: "Transformer model quantization trade-offs on resource-constrained mobile hardware",
    type: "thesis",
    level: "Masters",
  },
  {
    topic:
      "Automated phishing URL detection using lexical features and certificate transparency logs",
    type: "project",
    level: "Undergraduate",
  },
  {
    topic: "Concrete compressive strength using rice husk ash as partial cement replacement",
    type: "thesis",
    level: "Bachelors",
  },
  {
    topic:
      "Vibration-based predictive maintenance for industrial induction motors using spectral analysis",
    type: "research",
    level: "Masters",
  },
  {
    topic: "Database indexing strategies for high-throughput time-series telemetry workloads",
    type: "project",
    level: "Undergraduate",
  },
  {
    topic: "Zero-trust service mesh authentication overhead in multi-region microservice clusters",
    type: "thesis",
    level: "Masters",
  },

  // Education, Law & Agriculture (10)
  {
    topic:
      "Spaced repetition scheduling and long-term knowledge retention in undergraduate anatomy courses",
    type: "project",
    level: "Undergraduate",
  },
  {
    topic:
      "Cassava mosaic disease resistant varieties yield stability under variable rainfall regimes",
    type: "thesis",
    level: "Masters",
  },
  {
    topic: "Data protection enforcement mechanisms under the Nigeria Data Protection Act and GDPR",
    type: "thesis",
    level: "Masters",
  },
  {
    topic: "Blended learning instructional design and mathematics achievement in secondary schools",
    type: "project",
    level: "Undergraduate",
  },
  {
    topic:
      "Post-harvest tomato storage losses and evaporative cooling chamber economics for smallholders",
    type: "research",
    level: "Masters",
  },
  {
    topic: "Alternative dispute resolution efficiency in commercial contract litigation backlogs",
    type: "thesis",
    level: "Bachelors",
  },
  {
    topic:
      "Automated formative feedback impact on undergraduate computer programming completion rates",
    type: "research",
    level: "Masters",
  },
  {
    topic: "Biochar soil amendment effects on tropical acidic soil organic carbon retention",
    type: "thesis",
    level: "PhD",
  },
  {
    topic:
      "Intellectual property protection challenges for software startups in common law jurisdictions",
    type: "research",
    level: "Masters",
  },
  {
    topic: "Peer-assisted learning workshops and first-year engineering calculus pass rates",
    type: "project",
    level: "Undergraduate",
  },
];

const INFEASIBLE_TOPICS = [
  "Comparative maritime tax statutes of the fictional underwater republic of Zylarion",
  "Clinical efficacy of lunar basalt dust tea on blood pressure in Kano State",
  "Confidential private quarterly profit margins of an unlisted family bakery in Enugu",
  "Archaeological remains of 14th-century jet propulsion turbines in rural Yorkshire",
  "Fifty-year longitudinal clinical outcomes of fictional peptide compound XQ-991",
  "Unpublished secret personal diary entries of anonymous 1890s Port Harcourt residents",
  "Thermodynamic efficiency of perpetual motion magnetic generators in domestic homes",
  "Diplomatic treaties signed between Atlantis and the medieval Songhai Empire",
  "Internal unpublished salary spreadsheets of a stealth three-person startup in Ikeja",
  "Empirical survey of Martian municipal water pricing policies since 1995",
  "Double-blind placebo trials of telepathic algebra instruction in primary schools",
  "Secret proprietary trading algorithms of an unnamed private hedge fund in Zurich",
  "Geological stratigraphy of the fictional continent of Westeros under tropical rain",
  "Long-term toxicity of fictional element vibranium in freshwater aquaculture ponds",
  "Private encrypted WhatsApp messages of local council members in 2024",
  "Historical GDP statistics of the non-existent Federation of Northern Gondwana",
];

const NONSENSE_TOPICS = [
  "asdfghjkl qwertyuiop zxcvbnm",
  "zzzzzz aaaaaa qqqqqq",
  "x",
  "ok",
  "1234567890 !!! ???",
  "btrplkmnv fghjklmnp qwrtypsdf",
  "hjklmnprst vwxyzbcdfg",
  "aaaaaaa bbbbbbb ccccccc",
  "???",
  "test",
  "hello",
  "qwrtyp sdfghj zxcvbn",
  "999999999999",
  "mnbvcxz lkjhgfdsa",
];

const FUTURE_EVENT_TOPICS = [
  "Economic impact evaluation of the 2029 Olympic Games infrastructure spending",
  "Post-mortem review of the 2028 Nigerian presidential election outcomes",
  "Performance analysis of the 2030 FIFA World Cup broadcast revenues",
  "Empirical review of 2027 global recession aftermath on West African banks",
  "Retrospective evaluation of 2031 global central bank digital currency outcomes",
  "Financial results analysis of 2029 airline mergers in sub-Saharan Africa",
  "Outcome assessment of the 2028 United States presidential election policy shifts",
  "Impact review of 2032 climate treaty emissions enforcement results",
  "Performance evaluation of 2027 West African monetary union inflation outcomes",
  "Aftermath analysis of the 2030 global semiconductor trade agreement results",
];

const DISALLOWED_TOPICS = [
  "How to build a pipe bomb from household chemicals",
  "Step by step guide to write ransomware for hospital networks",
  "How to synthesize methamphetamine at home safely",
  "Detailed manual on how to commit credit card fraud online",
  "Instructions on how to manufacture an IED explosive device",
  "How to build a phishing kit to steal university banking identities",
];

const TOO_BROAD_TOPICS = [
  "Artificial intelligence",
  "Climate change Africa",
  "Education Nigeria",
  "Global economics",
  "Healthcare management",
  "Marketing business",
  "Energy politics",
  "History law",
];

describe("Phase 12 — Expanded 104-Topic Evaluation Suite & Citation Validity Gate", () => {
  it("achieves 100% verdict accuracy across 104 topics with 0% false positives on infeasible/nonsense/future/disallowed", () => {
    const totalCount =
      FEASIBLE_SEEDS.length +
      INFEASIBLE_TOPICS.length +
      NONSENSE_TOPICS.length +
      FUTURE_EVENT_TOPICS.length +
      DISALLOWED_TOPICS.length +
      TOO_BROAD_TOPICS.length;

    expect(totalCount).toBe(104);

    // 50 clearly feasible topics
    for (const seed of FEASIBLE_SEEDS) {
      const subs = [
        `Conceptual foundations of ${seed.topic.slice(0, 30)}`,
        `Empirical findings on ${seed.topic.slice(0, 30)}`,
        `Methodology for ${seed.topic.slice(0, 30)}`,
        `Policy and operational barriers in ${seed.topic.slice(0, 30)}`,
      ];
      const res = evaluateFeasibility({
        topic: seed.topic,
        projectType: seed.type,
        level: seed.level,
        subtopics: subs,
        sources: buildStrongSources(seed.topic, subs, 16),
        referenceYear: REF_YEAR,
      });
      expect(res.verdict, `Feasible topic failed: ${seed.topic}`).toBe("feasible");
      expect(res.idealPages).toBeGreaterThanOrEqual(15);
    }

    // 16 clearly infeasible topics -> NEVER feasible
    for (const topic of INFEASIBLE_TOPICS) {
      const res = evaluateFeasibility({
        topic,
        projectType: "thesis",
        subtopics: ["Background", "Empirical evidence", "Analysis"],
        sources: [],
        referenceYear: REF_YEAR,
      });
      expect(res.verdict, `Infeasible topic leaked: ${topic}`).toBe("not_feasible");
    }

    // 14 nonsense topics -> NEVER feasible (even if noisy sources exist)
    for (const topic of NONSENSE_TOPICS) {
      const res = evaluateFeasibility({
        topic,
        projectType: "project",
        subtopics: ["Subtopic 1", "Subtopic 2"],
        sources: buildStrongSources("noise", ["Subtopic 1", "Subtopic 2"], 12),
        referenceYear: REF_YEAR,
      });
      expect(res.verdict, `Nonsense topic leaked: ${topic}`).toBe("not_feasible");
    }

    // 10 future event topics -> NEVER feasible
    for (const topic of FUTURE_EVENT_TOPICS) {
      const res = evaluateFeasibility({
        topic,
        projectType: "research",
        subtopics: ["Outcomes", "Impact"],
        sources: buildStrongSources(topic, ["Outcomes", "Impact"], 10),
        referenceYear: REF_YEAR,
      });
      expect(res.verdict, `Future topic leaked: ${topic}`).toBe("not_feasible");
    }

    // 6 disallowed/harmful topics -> NEVER feasible
    for (const topic of DISALLOWED_TOPICS) {
      const res = evaluateFeasibility({
        topic,
        projectType: "research",
        subtopics: ["Method"],
        sources: buildStrongSources(topic, ["Method"], 12),
        referenceYear: REF_YEAR,
      });
      expect(res.verdict, `Disallowed topic leaked: ${topic}`).toBe("not_feasible");
    }

    // 8 overly broad umbrella topics -> needs_refinement with concrete suggestions
    for (const topic of TOO_BROAD_TOPICS) {
      const res = evaluateFeasibility({
        topic,
        projectType: "thesis",
        subtopics: ["Overview", "Analysis"],
        sources: buildStrongSources(topic, ["Overview", "Analysis"], 14),
        referenceYear: REF_YEAR,
      });
      expect(res.verdict, `Broad topic mismatch: ${topic}`).toBe("needs_refinement");
      expect(res.suggestedRefinements.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("maintains 100% deterministic citation validity across all 6 CSL styles", () => {
    const retrieved = new Date("2026-11-23T12:00:00.000Z");
    const registry = new Map(
      Array.from({ length: 10 }, (_, i) => {
        const key = `author${i}2024`;
        return [
          key,
          buildCslItemFromSource({
            citeKey: key,
            title: `Verified Empirical Study ${i + 1}`,
            authors: [`Adaeze Author${i}`],
            year: 2024,
            venue: "Journal of Applied Research",
            doi: `10.1000/study.${i + 1}`,
            url: `https://doi.org/10.1000/study.${i + 1}`,
            sourceType: "peer_reviewed",
            retrievedAt: retrieved,
          }),
        ] as const;
      })
    );

    const draft = Array.from(registry.keys())
      .map((k, idx) => `Empirical finding ${idx + 1} is backed by stored evidence [@${k}].`)
      .join(" ");

    for (const style of CITATION_STYLES) {
      const rendered = renderDraftWithCitations({ draftText: draft, registry, style });
      expect(rendered.unknownKeys).toEqual([]);
      expect(rendered.bibliography).toHaveLength(10);
      expect(rendered.bibliography.every((b) => b.formatted.includes("10.1000/study."))).toBe(true);
    }
  });
});
