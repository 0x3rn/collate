import { describe, expect, it } from "vitest";
import type { ProjectType } from "@/db/schema";
import {
  evaluateAssignmentFeasibility,
  evaluateFeasibility,
  type FeasibilitySourceInput,
} from "@/lib/feasibility/evaluator";

const REF_YEAR = 2026;

function makeCredibleSources(count: number, subtopics: string[]): FeasibilitySourceInput[] {
  const publishers = [
    "Elsevier",
    "Springer Nature",
    "IEEE",
    "World Bank",
    "Oxford University Press",
    "WHO",
  ];
  return Array.from({ length: count }, (_, i) => ({
    url: `https://publisher-${i % 6}.edu/paper-${i}`,
    doi: `10.1000/paper-${i}`,
    title: `Empirical analysis of ${subtopics[i % subtopics.length]}`,
    year: 2021 + (i % 5),
    publisher: publishers[i % publishers.length],
    sourceType: "peer_reviewed",
    credibilityScore: 82,
    relevanceScore: 78,
    accessStatus: i % 2 === 0 ? "full_text" : "abstract_only",
    matchedSubtopics: [subtopics[i % subtopics.length]!],
  }));
}

interface EvalCase {
  id: string;
  category:
    | "clearly_feasible"
    | "clearly_infeasible"
    | "nonsense"
    | "future_event"
    | "disallowed"
    | "borderline";
  topic: string;
  projectType: ProjectType;
  level?: string;
  subtopics: string[];
  sources: FeasibilitySourceInput[];
  expectedVerdict: "feasible" | "not_feasible" | "needs_refinement";
}

const EVAL_SET_32_TOPICS: EvalCase[] = [
  ...[
    {
      topic:
        "Impact of solar microgrids on vaccine cold-chain reliability in rural West African clinics",
      type: "thesis" as const,
      level: "Masters",
    },
    {
      topic:
        "Mobile money adoption and small business credit access among market traders in Nigeria",
      type: "project" as const,
      level: "Undergraduate",
    },
    {
      topic:
        "Deep learning sensitivity for early diabetic retinopathy screening in primary eye care",
      type: "research" as const,
      level: "Masters",
    },
    {
      topic: "Urban drainage design and flood risk reduction in coastal Lagos municipalities",
      type: "thesis" as const,
      level: "Bachelors",
    },
    {
      topic:
        "Antimicrobial resistance gene prevalence in municipal hospital wastewater treatment systems",
      type: "research" as const,
      level: "PhD",
    },
    {
      topic: "Spaced repetition scheduling and long-term recall in undergraduate medical courses",
      type: "project" as const,
      level: "Undergraduate",
    },
    {
      topic: "Thermal runaway mitigation in grid-scale lithium iron phosphate battery storage",
      type: "thesis" as const,
      level: "PhD",
    },
    {
      topic:
        "Yield stability of mosaic-resistant cassava varieties under smallholder rainfall variability",
      type: "project" as const,
      level: "Undergraduate",
    },
    {
      topic:
        "Fiscal decentralization and primary school completion rates across sub-Saharan Africa",
      type: "research" as const,
      level: "Masters",
    },
    {
      topic: "Microplastic bioaccumulation in freshwater tilapia across tropical river basins",
      type: "thesis" as const,
      level: "Masters",
    },
  ].map((item, idx) => {
    const subs = [
      `Conceptual background of ${item.topic.slice(0, 32)}`,
      `Empirical findings in ${item.topic.slice(0, 32)}`,
      `Methodology and metrics for ${item.topic.slice(0, 32)}`,
      `Policy and operational barriers in ${item.topic.slice(0, 32)}`,
    ];
    return {
      id: `FEAS-${idx + 1}`,
      category: "clearly_feasible" as const,
      topic: item.topic,
      projectType: item.type,
      level: item.level,
      subtopics: subs,
      sources: makeCredibleSources(16, subs),
      expectedVerdict: "feasible" as const,
    };
  }),

  ...[
    "Comparative tax law of the fictional underwater republic of Zylarion",
    "Clinical efficacy of lunar basalt dust tea on hypertension in Kano State",
    "Internal secret quarterly margins of an unlisted family bakery in Enugu",
    "Archaeological evidence of 14th-century jet propulsion in rural Yorkshire",
    "Longitudinal 50-year clinical outcomes of a fictional peptide drug XQ-991",
    "Unpublished private diary entries of anonymous residents in 1890s Port Harcourt",
  ].map((topic, idx) => ({
    id: `INFEAS-${idx + 1}`,
    category: "clearly_infeasible" as const,
    topic,
    projectType: "thesis" as const,
    subtopics: ["Background", "Empirical evidence", "Analysis"],
    sources: idx % 2 === 0 ? [] : makeCredibleSources(1, ["Background"]),
    expectedVerdict: "not_feasible" as const,
  })),

  ...[
    "asdfghjkl qwertyuiop zxcvbnm",
    "zzzzzz aaaaaa qqqqqq",
    "x",
    "1234567890 !!! ???",
    "btrplkmnv fghjklmnp qwrtypsdf",
    "ok",
  ].map((topic, idx) => ({
    id: `NONSENSE-${idx + 1}`,
    category: "nonsense" as const,
    topic,
    projectType: "project" as const,
    subtopics: ["Subtopic 1", "Subtopic 2"],
    sources: makeCredibleSources(20, ["Subtopic 1", "Subtopic 2"]),
    expectedVerdict: "not_feasible" as const,
  })),

  ...[
    "Economic impact evaluation of the 2029 Olympic Games infrastructure spending",
    "Post-mortem review of the 2028 Nigerian presidential election outcomes",
    "Performance analysis of the 2030 FIFA World Cup broadcast revenues",
    "Empirical review of 2027 global recession aftermath on West African banks",
  ].map((topic, idx) => ({
    id: `FUTURE-${idx + 1}`,
    category: "future_event" as const,
    topic,
    projectType: "research" as const,
    subtopics: ["Economic outcome", "Empirical review"],
    sources: makeCredibleSources(10, ["Economic outcome", "Empirical review"]),
    expectedVerdict: "not_feasible" as const,
  })),

  ...[
    "How to build a pipe bomb from household chemicals",
    "Step by step guide to write ransomware for hospital networks",
    "How to synthesize methamphetamine at home safely",
  ].map((topic, idx) => ({
    id: `DISALLOWED-${idx + 1}`,
    category: "disallowed" as const,
    topic,
    projectType: "research" as const,
    subtopics: ["Method"],
    sources: makeCredibleSources(15, ["Method"]),
    expectedVerdict: "not_feasible" as const,
  })),

  {
    id: "BROAD-1",
    category: "borderline",
    topic: "Artificial intelligence",
    projectType: "thesis",
    subtopics: ["AI foundations", "AI ethics", "AI industry"],
    sources: makeCredibleSources(15, ["AI foundations", "AI ethics", "AI industry"]),
    expectedVerdict: "needs_refinement",
  },
  {
    id: "BROAD-2",
    category: "borderline",
    topic: "Climate change Africa",
    projectType: "project",
    subtopics: ["Climate", "Africa"],
    sources: makeCredibleSources(12, ["Climate", "Africa"]),
    expectedVerdict: "needs_refinement",
  },
  {
    id: "PARTIAL-3",
    category: "borderline",
    topic: "Blockchain land registry adoption barriers in municipal Kaduna offices",
    projectType: "thesis",
    subtopics: [
      "Land registry digitization",
      "Blockchain governance",
      "Municipal IT costs",
      "Legal framework",
    ],
    sources: makeCredibleSources(6, ["Land registry digitization", "Blockchain governance"]),
    expectedVerdict: "needs_refinement",
  },
];

describe("Phase 4 — 32-Topic Feasibility Evaluation Harness (NN-1)", () => {
  it("evaluates all 32 benchmark topics with 0% false positives on infeasible, nonsense, future, and disallowed topics", () => {
    expect(EVAL_SET_32_TOPICS).toHaveLength(32);

    for (const tc of EVAL_SET_32_TOPICS) {
      const result = evaluateFeasibility({
        topic: tc.topic,
        projectType: tc.projectType,
        level: tc.level,
        subtopics: tc.subtopics,
        sources: tc.sources,
        referenceYear: REF_YEAR,
      });

      expect(result.verdict, `Topic ${tc.id} ("${tc.topic}")`).toBe(tc.expectedVerdict);

      if (
        tc.category === "clearly_infeasible" ||
        tc.category === "nonsense" ||
        tc.category === "future_event" ||
        tc.category === "disallowed"
      ) {
        expect(result.verdict).not.toBe("feasible");
      }
      expect(result.reasons.length).toBeGreaterThan(0);
    }
  });

  it("flags topics requiring primary data (surveys, interviews, lab trials) for NN-4 handling", () => {
    const subs = ["Survey methodology", "Student digital literacy", "Institutional barriers"];
    const result = evaluateFeasibility({
      topic: "A survey of 200 nursing students on electronic health record readiness in Ibadan",
      projectType: "project",
      subtopics: subs,
      sources: makeCredibleSources(12, subs),
      referenceYear: REF_YEAR,
    });

    expect(result.verdict).toBe("feasible");
    expect(result.requiresPrimaryData).toBe(true);
    expect(result.primaryDataNotice).toContain("NN-4");
  });

  it("scales Section 8 ideal page counts properly by work type, academic level, and complexity", () => {
    const subs = ["A", "B", "C", "D", "E", "F"];
    const richSources = makeCredibleSources(25, subs);

    const research = evaluateFeasibility({
      topic: "Empirical study of solar inverter degradation across coastal climates",
      projectType: "research",
      subtopics: subs,
      sources: richSources,
      referenceYear: REF_YEAR,
    });
    const masters = evaluateFeasibility({
      topic: "Empirical study of solar inverter degradation across coastal climates",
      projectType: "thesis",
      level: "Masters",
      subtopics: subs,
      sources: richSources,
      referenceYear: REF_YEAR,
    });
    const phd = evaluateFeasibility({
      topic: "Empirical study of solar inverter degradation across coastal climates",
      projectType: "thesis",
      level: "PhD",
      subtopics: subs,
      sources: richSources,
      referenceYear: REF_YEAR,
    });

    expect(research.idealPages).toBeGreaterThanOrEqual(15);
    expect(research.idealPages).toBeLessThanOrEqual(40);
    expect(masters.idealPages).toBeGreaterThanOrEqual(80);
    expect(masters.idealPages).toBeLessThanOrEqual(150);
    expect(phd.idealPages).toBeGreaterThanOrEqual(150);
    expect(phd.idealPages).toBeLessThanOrEqual(300);
    expect(phd.idealPages).toBeGreaterThan(masters.idealPages);
    expect(masters.idealPages).toBeGreaterThan(research.idealPages);
  });

  it("evaluates Assignment mode per question and reports mixed verdicts cleanly", () => {
    const summary = evaluateAssignmentFeasibility(
      [
        {
          questionId: "q1",
          questionText: "Explain how central bank policy rates influence inflation expectations",
          subtopics: ["Monetary transmission", "Inflation expectations"],
          sources: makeCredibleSources(5, ["Monetary transmission", "Inflation expectations"]),
        },
        {
          questionId: "q2",
          questionText: "Evaluate the 2029 monetary policy outcomes of the Central Bank",
          subtopics: ["2029 outcomes"],
          sources: [],
        },
      ],
      REF_YEAR
    );

    expect(summary.feasibleCount).toBe(1);
    expect(summary.notFeasibleCount).toBe(1);
    expect(summary.overallVerdict).toBe("needs_refinement");
    expect(summary.perQuestion[0]?.evaluation.verdict).toBe("feasible");
    expect(summary.perQuestion[1]?.evaluation.verdict).toBe("not_feasible");
    expect(summary.totalIdealPages).toBeGreaterThanOrEqual(4);
  });
});
