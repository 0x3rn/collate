import type { ChapterType } from "@/config/outline";
import type { ProjectType } from "@/db/schema";

export interface StructureFrontMatterDefaults {
  coverPage: boolean;
  certification: boolean;
  dedication: boolean;
  acknowledgements: boolean;
  preface: boolean;
  abstract: boolean;
  tableOfContents: boolean;
  listOfFiguresAndTables: boolean;
  appendices: boolean;
}

export interface StructuralUnitTemplate {
  number: number;
  title: string;
  chapterType: ChapterType;
  purpose: string;
  sections: string[];
}

export interface StructureSelectionInput {
  type: ProjectType;
  isExperimental: boolean;
  useChapters: boolean;
  level?: string | null;
}

export function defaultUseChaptersForType(type: ProjectType): boolean {
  if (type === "research" || type === "assignment") {
    return false;
  }
  return true;
}

export function defaultFrontMatterForStructure(
  type: ProjectType,
  useChapters: boolean
): StructureFrontMatterDefaults {
  if (type === "assignment") {
    return {
      coverPage: true,
      certification: false,
      dedication: false,
      acknowledgements: false,
      preface: false,
      abstract: false,
      tableOfContents: false,
      listOfFiguresAndTables: false,
      appendices: false,
    };
  }

  if (!useChapters) {
    return {
      coverPage: true,
      certification: false,
      dedication: false,
      acknowledgements: false,
      preface: false,
      abstract: true,
      tableOfContents: false,
      listOfFiguresAndTables: false,
      appendices: false,
    };
  }

  return {
    coverPage: true,
    certification: false,
    dedication: false,
    acknowledgements: true,
    preface: false,
    abstract: true,
    tableOfContents: true,
    listOfFiguresAndTables: false,
    appendices: false,
  };
}

export function formatUnitHeading(number: number, title: string, useChapters: boolean): string {
  return useChapters ? `Chapter ${number}: ${title}` : `${number}. ${title}`;
}

export function formatUnitShortLabel(number: number, useChapters: boolean): string {
  return useChapters ? `Chapter ${number}` : `Section ${number}`;
}

export function unitNounSingular(useChapters: boolean, capitalize = false): string {
  if (useChapters) return capitalize ? "Chapter" : "chapter";
  return capitalize ? "Section" : "section";
}

export function unitNounPlural(useChapters: boolean, capitalize = false): string {
  if (useChapters) return capitalize ? "Chapters" : "chapters";
  return capitalize ? "Sections" : "sections";
}

export function subUnitNounPlural(useChapters: boolean, capitalize = false): string {
  if (useChapters) return capitalize ? "Sections" : "sections";
  return capitalize ? "Subsections" : "subsections";
}

export function stripLeadingUnitPrefix(rawTitle: string): string {
  return rawTitle
    .trim()
    .replace(/^(?:chapter|section|part)\s+\d+\s*[:.\-\u2013\u2014]?\s*/i, "")
    .replace(/^\d+(?:\.\d+)*\.?\s+/, "")
    .trim();
}

export function getDefaultStructureForWork(
  input: StructureSelectionInput
): StructuralUnitTemplate[] {
  const { type, isExperimental, useChapters } = input;
  if (type === "assignment") return [];

  const unitWord = useChapters ? "chapter" : "section";

  // 1. RESEARCH PAPER
  if (type === "research") {
    if (!isExperimental && !useChapters) {
      return [
        {
          number: 1,
          title: "Introduction",
          chapterType: "introduction",
          purpose:
            "This section will introduce the research context, articulate the conceptual problem and thesis, and outline the paper's scope and organization.",
          sections: [
            "Background and context",
            "Problem statement and thesis",
            "Scope and organization of the paper",
          ],
        },
        {
          number: 2,
          title: "Conceptual and Theoretical Foundations",
          chapterType: "theoretical_framework",
          purpose:
            "This section will define core constructs, examine governing theories, and trace how existing scholarship frames the subject.",
          sections: [
            "Key concepts and definitions",
            "Governing theoretical perspectives",
            "Evolution of existing scholarship",
          ],
        },
        {
          number: 3,
          title: "Thematic Literature Synthesis",
          chapterType: "literature_review",
          purpose:
            "This section will synthesize published literature by theme, comparing scholarly perspectives and mapping unresolved tensions.",
          sections: [
            "Primary debates and analytical themes",
            "Comparative perspectives across published studies",
            "Divergences and unresolved tensions",
          ],
        },
        {
          number: 4,
          title: "Critical Analysis and Implications",
          chapterType: "critical_analysis",
          purpose:
            "This section will critically evaluate the synthesized evidence, draw theoretical and practical implications, and highlight gaps for future scholarship.",
          sections: [
            "Critical evaluation of the evidence",
            "Theoretical and practical implications",
            "Research gaps and future directions",
          ],
        },
        {
          number: 5,
          title: "Conclusion",
          chapterType: "conclusion",
          purpose:
            "This section will synthesize the paper's core arguments and present final scholarly conclusions.",
          sections: ["Synthesis of core arguments", "Concluding remarks"],
        },
      ];
    }

    if (!isExperimental && useChapters) {
      return [
        {
          number: 1,
          title: "Introduction",
          chapterType: "introduction",
          purpose:
            "This chapter will introduce the research context, problem statement, objectives, research questions, scope, and paper organization.",
          sections: [
            "Background of the study",
            "Statement of the problem",
            "Aim and objectives",
            "Research questions",
            "Scope and significance",
            "Structure of the paper",
          ],
        },
        {
          number: 2,
          title: "Conceptual and Theoretical Framework",
          chapterType: "theoretical_framework",
          purpose:
            "This chapter will clarify key concepts, analyze governing theoretical lenses, and establish the analytical foundation of the paper.",
          sections: [
            "Conceptual clarification",
            "Theoretical foundations",
            "Review of foundational scholarship",
            "Summary of framework",
          ],
        },
        {
          number: 3,
          title: "Thematic Literature Review",
          chapterType: "literature_review",
          purpose:
            "This chapter will synthesize peer-reviewed scholarship across key themes and expose the gaps addressed by this paper.",
          sections: [
            "Major thematic debates",
            "Comparative perspectives across published studies",
            "Synthesis of literature gaps",
          ],
        },
        {
          number: 4,
          title: "Critical Analysis and Discussion",
          chapterType: "critical_analysis",
          purpose:
            "This chapter will critically evaluate competing arguments in the literature, answer the research questions, and examine broader implications.",
          sections: [
            "Critical evaluation of key arguments",
            "Addressing the research questions from the literature",
            "Implications and boundaries of the analysis",
          ],
        },
        {
          number: 5,
          title: "Conclusion and Recommendations",
          chapterType: "conclusion",
          purpose:
            "This chapter will summarize the main insights, state clear conclusions, and recommend directions for policy and further study.",
          sections: [
            "Summary of key insights",
            "Conclusions",
            "Recommendations and areas for further study",
          ],
        },
      ];
    }

    if (isExperimental && !useChapters) {
      return [
        {
          number: 1,
          title: "Introduction",
          chapterType: "introduction",
          purpose:
            "This section will establish the empirical context, identify the literature gap, and state the study's objectives and hypotheses.",
          sections: [
            "Background and motivation",
            "Literature context and research gap",
            "Objectives and hypotheses",
          ],
        },
        {
          number: 2,
          title: "Literature Review",
          chapterType: "literature_review",
          purpose:
            "This section will synthesize conceptual foundations and prior empirical findings directly relevant to the investigation.",
          sections: [
            "Conceptual background",
            "Prior empirical studies",
            "Synthesis of research gap",
          ],
        },
        {
          number: 3,
          title: "Methodology",
          chapterType: "methodology",
          purpose:
            "This section will detail the empirical design, materials or sample, data collection procedures, analytical tools, and ethical safeguards.",
          sections: [
            "Research design",
            "Materials, sample, and data sources",
            "Measurement and data collection procedures",
            "Analytical methods and ethical considerations",
          ],
        },
        {
          number: 4,
          title: "Results",
          chapterType: "results",
          purpose:
            "This section will present verified empirical findings objectively from uploaded data, published benchmarks, or a clearly labelled framework.",
          sections: [
            "Data description and overview",
            "Primary empirical findings",
            "Summary of key results",
          ],
        },
        {
          number: 5,
          title: "Discussion",
          chapterType: "discussion",
          purpose:
            "This section will interpret empirical results against prior literature, evaluate implications, and account for methodological limitations.",
          sections: [
            "Interpretation against prior literature",
            "Theoretical and practical implications",
            "Limitations and future research",
          ],
        },
        {
          number: 6,
          title: "Conclusion",
          chapterType: "conclusion",
          purpose:
            "This section will summarize the study's empirical contribution and offer concise closing takeaways.",
          sections: ["Summary of key findings", "Concluding remarks"],
        },
      ];
    }

    // research + experimental + chapters
    return [
      {
        number: 1,
        title: "Introduction",
        chapterType: "introduction",
        purpose:
          "This chapter will introduce the empirical context, problem statement, objectives, hypotheses, scope, and overall structure.",
        sections: [
          "Background of the study",
          "Statement of the problem",
          "Aim and objectives",
          "Research questions and hypotheses",
          "Scope and significance",
          "Structure of the paper",
        ],
      },
      {
        number: 2,
        title: "Literature Review",
        chapterType: "literature_review",
        purpose:
          "This chapter will review conceptual, theoretical, and empirical literature to establish the research gap.",
        sections: [
          "Conceptual review",
          "Theoretical framework",
          "Empirical literature review",
          "Summary of research gap",
        ],
      },
      {
        number: 3,
        title: "Methodology",
        chapterType: "methodology",
        purpose:
          "This chapter will detail the research design, sample or materials, instruments, analytical methods, ethics, and limitations.",
        sections: [
          "Research design",
          "Population, sample, or materials",
          "Data collection instruments and procedures",
          "Data analysis methods",
          "Ethical considerations and limitations",
        ],
      },
      {
        number: 4,
        title: "Results and Discussion",
        chapterType: "results",
        purpose:
          "This chapter will present verified empirical findings and interpret them against prior published studies.",
        sections: [
          "Data description and overview",
          "Analysis by research question",
          "Tables and figures",
          "Discussion against prior literature",
        ],
      },
      {
        number: 5,
        title: "Conclusion",
        chapterType: "conclusion",
        purpose:
          "This chapter will summarize findings, draw grounded conclusions, and suggest practical recommendations and future work.",
        sections: ["Summary of findings", "Conclusions", "Recommendations and future research"],
      },
    ];
  }

  // 2. FINAL-YEAR PROJECT (supports Nigerian & international 5-chapter standards)
  if (type === "project") {
    if (!isExperimental) {
      return [
        {
          number: 1,
          title: "Introduction",
          chapterType: "introduction",
          purpose: `This ${unitWord} will introduce the background, research problem, objectives, research questions, scope, significance, and documentary approach of the study.`,
          sections: [
            "Background of the study",
            "Statement of the problem",
            "Aim and objectives",
            "Research questions",
            "Scope and significance of the study",
            "Approach to literature and sources",
            "Definition of key terms",
            useChapters ? "Organization of the study" : "Structure of the report",
          ],
        },
        {
          number: 2,
          title: "Literature Review and Theoretical Framework",
          chapterType: "literature_review",
          purpose: `This ${unitWord} will clarify core concepts, establish the guiding theoretical framework, and review related scholarship to expose the gap.`,
          sections: [
            "Conceptual clarification",
            "Theoretical framework",
            "Review of related scholarship",
            "Summary of literature and gap",
          ],
        },
        {
          number: 3,
          title: "Thematic and Contextual Analysis",
          chapterType: "thematic_analysis",
          purpose: `This ${unitWord} will examine the historical, institutional, policy, legal, or textual dimensions of the topic through verified secondary and primary documentary sources.`,
          sections: [
            "Historical and contextual background",
            "Analysis of primary themes and core debates",
            "Institutional, policy, or textual perspectives",
            useChapters ? "Chapter summary" : "Summary of thematic insights",
          ],
        },
        {
          number: 4,
          title: "Critical Evaluation and Synthesis",
          chapterType: "critical_analysis",
          purpose: `This ${unitWord} will critically evaluate competing arguments, compare perspectives across contexts, and synthesize grounded answers to the research questions.`,
          sections: [
            "Critical evaluation of key arguments",
            "Comparative perspectives and tensions",
            "Synthesis addressing the research questions",
            "Implications of the analysis",
          ],
        },
        {
          number: 5,
          title: "Summary, Conclusion and Recommendations",
          chapterType: "conclusion",
          purpose: `This ${unitWord} will summarize key insights, state the final conclusion, offer actionable recommendations, and identify directions for further study.`,
          sections: [
            "Summary of key insights",
            "Conclusion",
            "Recommendations",
            "Contribution to knowledge",
            "Suggestions for further studies",
          ],
        },
      ];
    }

    // project + experimental
    return [
      {
        number: 1,
        title: "Introduction",
        chapterType: "introduction",
        purpose: `This ${unitWord} will introduce the research context, problem statement, objectives, questions and hypotheses, scope, and overall structure.`,
        sections: [
          "Background of the study",
          "Statement of the problem",
          "Aim and objectives",
          "Research questions and hypotheses",
          "Significance of the study",
          "Scope and delimitations",
          "Definition of key terms",
          useChapters ? "Structure of the work" : "Structure of the report",
        ],
      },
      {
        number: 2,
        title: "Literature Review",
        chapterType: "literature_review",
        purpose: `This ${unitWord} will synthesize conceptual, theoretical, and thematic empirical literature to establish the research gap.`,
        sections: [
          "Conceptual review",
          "Theoretical framework",
          "Thematic empirical review",
          "Summary of research gap",
        ],
      },
      {
        number: 3,
        title: "Methodology",
        chapterType: "methodology",
        purpose: `This ${unitWord} will detail the research design, population and sampling or materials, instruments, validity, analysis methods, ethics, and limitations.`,
        sections: [
          "Research design",
          "Population and sampling strategy",
          "Data collection instruments",
          "Validity and reliability",
          "Data analysis methods",
          "Ethical considerations",
          "Methodological limitations",
        ],
      },
      {
        number: 4,
        title: "Results and Discussion",
        chapterType: "results",
        purpose: `This ${unitWord} will present verified empirical findings from user data, published benchmarks, or a clearly labelled framework and discuss them against prior literature.`,
        sections: [
          "Data description and overview",
          "Analysis by research question",
          "Tables and figures",
          "Discussion of findings",
        ],
      },
      {
        number: 5,
        title: "Summary, Conclusion and Recommendations",
        chapterType: "conclusion",
        purpose: `This ${unitWord} will summarize findings, draw grounded conclusions, offer recommendations, and outline areas for further research.`,
        sections: [
          "Summary of the study",
          "Conclusions",
          "Recommendations",
          "Contribution to knowledge",
          "Suggestions for further research",
        ],
      },
    ];
  }

  // 3. THESIS / DISSERTATION (deeper 6-unit structure distinguishing Thesis from 5-chapter Project)
  if (!isExperimental) {
    return [
      {
        number: 1,
        title: "Introduction",
        chapterType: "introduction",
        purpose: `This ${unitWord} will establish the scholarly problem, objectives, research questions, significance, scope, key definitions, and thesis structure.`,
        sections: [
          "Background of the study",
          "Statement of the problem",
          "Aim and objectives",
          "Research questions",
          "Significance of the study",
          "Scope and delimitations",
          "Definition of key terms",
          "Structure of the thesis",
        ],
      },
      {
        number: 2,
        title: "Literature Review",
        chapterType: "literature_review",
        purpose: `This ${unitWord} will synthesize conceptual foundations, trace the evolution of scholarly discourse, and map the critical gaps in published literature.`,
        sections: [
          "Conceptual foundations",
          "Evolution of scholarly discourse",
          "Thematic review of existing studies",
          "Synthesis of research gaps",
        ],
      },
      {
        number: 3,
        title: "Theoretical and Analytical Framework",
        chapterType: "theoretical_framework",
        purpose: `This ${unitWord} will examine governing theoretical traditions, articulate the analytical framework, and explain how documentary and secondary sources are evaluated.`,
        sections: [
          "Core theoretical perspectives",
          "Analytical framework and key constructs",
          "Approach to documentary and secondary sources",
          "Justification of the framework",
        ],
      },
      {
        number: 4,
        title: "Thematic Analysis of Core Issues",
        chapterType: "thematic_analysis",
        purpose: `This ${unitWord} will develop an in-depth thematic, historical, contextual, or comparative analysis grounded in verified scholarly literature.`,
        sections: [
          "Historical and contextual examination",
          "Examination of primary analytical themes",
          "Comparative and cross-contextual perspectives",
          "Synthesis of thematic insights",
        ],
      },
      {
        number: 5,
        title: "Critical Discussion and Synthesis",
        chapterType: "critical_analysis",
        purpose: `This ${unitWord} will critically evaluate the synthesized arguments against the research questions and analyze theoretical, policy, and practical implications.`,
        sections: [
          "Critical evaluation against the research questions",
          "Theoretical and policy implications",
          "Boundaries and limitations of the analysis",
        ],
      },
      {
        number: 6,
        title: "Summary, Conclusion and Recommendations",
        chapterType: "conclusion",
        purpose: `This ${unitWord} will synthesize the thesis's original intellectual contribution, state conclusions, and outline recommendations and future research directions.`,
        sections: [
          "Summary of the thesis",
          "Conclusions",
          "Recommendations",
          "Contribution to knowledge",
          "Directions for further research",
        ],
      },
    ];
  }

  // thesis + experimental
  return [
    {
      number: 1,
      title: "Introduction",
      chapterType: "introduction",
      purpose: `This ${unitWord} will introduce the research context, problem statement, objectives, questions and hypotheses, significance, scope, and thesis structure.`,
      sections: [
        "Background of the study",
        "Statement of the problem",
        "Aim and objectives",
        "Research questions and hypotheses",
        "Significance of the study",
        "Scope and delimitations",
        "Definition of key terms",
        "Structure of the thesis",
      ],
    },
    {
      number: 2,
      title: "Literature Review",
      chapterType: "literature_review",
      purpose: `This ${unitWord} will synthesize conceptual, theoretical, and empirical literature to establish the research gap.`,
      sections: [
        "Conceptual review",
        "Theoretical framework",
        "Thematic empirical review",
        "Summary of research gap",
      ],
    },
    {
      number: 3,
      title: "Research Methodology",
      chapterType: "methodology",
      purpose: `This ${unitWord} will detail the empirical research design, sampling or experimental protocol, instruments, validity, analytical techniques, ethics, and limitations.`,
      sections: [
        "Research design",
        "Population and sampling strategy",
        "Data collection instruments and procedures",
        "Validity and reliability",
        "Data analysis methods",
        "Ethical considerations",
        "Methodological limitations",
      ],
    },
    {
      number: 4,
      title: "Results and Findings",
      chapterType: "results",
      purpose: `This ${unitWord} will present verified empirical findings objectively from uploaded data, published benchmarks, or a clearly labelled results framework.`,
      sections: [
        "Data description and overview",
        "Analysis by research question",
        "Tables and figures",
        "Summary of key findings",
      ],
    },
    {
      number: 5,
      title: "Discussion",
      chapterType: "discussion",
      purpose: `This ${unitWord} will interpret empirical findings against prior literature, evaluate theoretical and practical implications, and address limitations.`,
      sections: [
        "Interpretation against prior literature",
        "Theoretical and practical implications",
        "Unexpected findings",
        "Study limitations",
      ],
    },
    {
      number: 6,
      title: "Conclusion and Recommendations",
      chapterType: "conclusion",
      purpose: `This ${unitWord} will summarize findings, state conclusions, present recommendations, articulate contribution to knowledge, and propose further research.`,
      sections: [
        "Summary of the thesis",
        "Conclusions",
        "Recommendations",
        "Contribution to knowledge",
        "Suggestions for further research",
      ],
    },
  ];
}

const LEGACY_DEFAULT_TITLE_SETS: ReadonlyArray<readonly string[]> = [
  ["Introduction", "Literature Review", "Methodology", "Results and Discussion", "Conclusion"],
  [
    "Introduction",
    "Literature Review",
    "Methodology",
    "Results and Findings",
    "Conclusion and Recommendations",
  ],
];

function normalizeTitleSequence(titles: string[]): string {
  return titles.map((t) => t.trim().toLowerCase()).join("||");
}

/**
 * Returns true when a project's current non-reference chapter/section titles still match
 * any auto-generated default template (including legacy templates), meaning the user has
 * not manually customized their chapter list yet and mode toggles on Step 2 can safely
 * refresh the defaults to match the new study mode or chapter structure.
 */
export function isAutoGeneratedDefaultChapters(titles: string[]): boolean {
  if (titles.length === 0) return true;
  const sig = normalizeTitleSequence(titles);

  for (const legacy of LEGACY_DEFAULT_TITLE_SETS) {
    if (normalizeTitleSequence([...legacy]) === sig) return true;
  }

  const workTypes: ProjectType[] = ["project", "research", "thesis"];
  for (const type of workTypes) {
    for (const isExperimental of [false, true]) {
      for (const useChapters of [false, true]) {
        const candidate = getDefaultStructureForWork({ type, isExperimental, useChapters }).map(
          (u) => u.title
        );
        if (normalizeTitleSequence(candidate) === sig) {
          return true;
        }
      }
    }
  }

  return false;
}

const FORBIDDEN_PURE_LITERATURE_TITLE_PATTERN =
  /\b(results?\s+and\s+(?:discussion|findings?)|empirical\s+results?|data\s+presentation(?:\s+and\s+analysis)?|experimental\s+(?:results?|findings?|procedures?|design|setup)|laboratory\s+(?:methods?|results?)|field\s+survey\s+results?)\b|^results?$/i;

const FORBIDDEN_PURE_LITERATURE_SECTION_PATTERN =
  /\b(population\s+and\s+sampl(?:e|ing)|sample\s+size|data\s+collection\s+instruments?|questionnaires?\s+and\s+interviews?|validity\s+and\s+reliability|statistical\s+hypothesis\s+testing|research\s+questions\s+and\s+hypotheses|data\s+description\s+and\s+overview|primary\s+empirical\s+findings|summary\s+of\s+key\s+results|laboratory\s+assay|clinical\s+trial|spss|anova|t-test)\b/i;

export function validatePureLiteratureStructure(
  units: Array<{ title: string; chapterType: ChapterType; sections: string[] }>
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];

  for (const unit of units) {
    if (unit.chapterType === "results") {
      violations.push(
        `Unit "${unit.title}" uses chapterType "results", which is not valid for a pure literature study.`
      );
    }
    if (FORBIDDEN_PURE_LITERATURE_TITLE_PATTERN.test(unit.title.trim())) {
      violations.push(
        `Unit title "${unit.title}" implies experimental/empirical results in a pure literature study.`
      );
    }
    for (const sec of unit.sections) {
      if (FORBIDDEN_PURE_LITERATURE_SECTION_PATTERN.test(sec.trim())) {
        violations.push(
          `Subsection "${sec}" under "${unit.title}" implies empirical sampling, instruments, or primary results in a pure literature study.`
        );
      }
    }
  }

  return { valid: violations.length === 0, violations };
}

export function getPureLiteratureSectionsForType(
  chapterType: ChapterType,
  projectType: ProjectType,
  useChapters: boolean
): string[] | null {
  switch (chapterType) {
    case "introduction":
      if (projectType === "research" && !useChapters) {
        return [
          "Background and context",
          "Problem statement and thesis",
          "Scope and organization of the paper",
        ];
      }
      if (projectType === "project") {
        return [
          "Background of the study",
          "Statement of the problem",
          "Aim and objectives",
          "Research questions",
          "Scope and significance of the study",
          "Approach to literature and sources",
          "Definition of key terms",
          useChapters ? "Organization of the study" : "Structure of the report",
        ];
      }
      return [
        "Background of the study",
        "Statement of the problem",
        "Aim and objectives",
        "Research questions",
        "Significance of the study",
        "Scope and delimitations",
        "Definition of key terms",
        projectType === "thesis" ? "Structure of the thesis" : "Structure of the paper",
      ];
    case "methodology":
      return [
        "Qualitative and documentary research approach",
        "Literature search and source selection criteria",
        "Analytical and interpretive framework",
        "Scope and methodological boundaries",
      ];
    case "literature_review":
      return [
        "Conceptual clarification",
        "Theoretical perspectives",
        "Thematic review of published scholarship",
        "Synthesis of literature gaps",
      ];
    case "conclusion":
      if (projectType === "research" && !useChapters) {
        return ["Synthesis of core arguments", "Concluding remarks"];
      }
      return [
        "Summary of key insights",
        "Conclusions",
        "Recommendations",
        "Contribution to knowledge",
        "Directions for further study",
      ];
    default:
      return null;
  }
}
