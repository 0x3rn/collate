import type { LineSpacing } from "@/db/schema";

export const CHAPTER_TYPES = [
  "introduction",
  "literature_review",
  "theoretical_framework",
  "thematic_analysis",
  "critical_analysis",
  "methodology",
  "results",
  "discussion",
  "conclusion",
  "system_analysis",
  "system_design",
  "implementation",
  "testing",
  "references",
  "custom",
] as const;

export type ChapterType = (typeof CHAPTER_TYPES)[number];

export const CHAPTER_TYPE_TEMPLATES: Record<
  ChapterType,
  {
    label: string;
    defaultPurpose: string;
    defaultWeight: number;
    requiredSections: string[];
  }
> = {
  introduction: {
    label: "Introduction",
    defaultPurpose:
      "Introduce the research context, problem statement, objectives, questions, scope, and overall structure.",
    defaultWeight: 10,
    requiredSections: [
      "Background of the study",
      "Statement of the problem",
      "Aim and objectives",
      "Research questions and hypotheses",
      "Significance of the study",
      "Scope and delimitations",
      "Definition of key terms",
      "Structure of the work",
    ],
  },
  literature_review: {
    label: "Literature review",
    defaultPurpose:
      "Synthesize conceptual, theoretical, and thematic empirical literature to establish the research gap.",
    defaultWeight: 28,
    requiredSections: [
      "Conceptual review",
      "Theoretical framework",
      "Thematic empirical review",
      "Summary of research gap",
    ],
  },
  theoretical_framework: {
    label: "Theoretical framework",
    defaultPurpose:
      "Examine core theories, models, and conceptual relationships guiding the investigation.",
    defaultWeight: 16,
    requiredSections: [
      "Core theoretical foundations",
      "Conceptual model and key constructs",
      "Application of theory to the study",
      "Summary of framework",
    ],
  },
  thematic_analysis: {
    label: "Thematic and contextual analysis",
    defaultPurpose:
      "Examine core historical, conceptual, policy, legal, or textual themes grounded in published literature and primary documents.",
    defaultWeight: 22,
    requiredSections: [
      "Historical and contextual background",
      "Analysis of primary themes and scholarly debates",
      "Institutional, policy, or textual perspectives",
      "Synthesis of thematic insights",
    ],
  },
  critical_analysis: {
    label: "Critical evaluation and synthesis",
    defaultPurpose:
      "Critically evaluate competing scholarly arguments, compare perspectives across contexts, and synthesize answers to the research questions.",
    defaultWeight: 20,
    requiredSections: [
      "Critical evaluation of key arguments",
      "Comparative perspectives and tensions",
      "Synthesis addressing the research questions",
      "Theoretical and practical implications",
    ],
  },
  methodology: {
    label: "Methodology",
    defaultPurpose:
      "Detail the research design, population/sample, instruments, validity, data analysis methods, ethics, and limitations.",
    defaultWeight: 13,
    requiredSections: [
      "Research design",
      "Population and sampling strategy",
      "Data collection instruments",
      "Validity and reliability",
      "Data analysis methods",
      "Ethical considerations",
      "Methodological limitations",
    ],
  },
  results: {
    label: "Results / Findings",
    defaultPurpose:
      "Present verified empirical findings from user data, cited public datasets, or a clearly labelled results framework (NN-4).",
    defaultWeight: 20,
    requiredSections: [
      "Data description and overview",
      "Analysis by research question",
      "Tables and figures",
      "Summary of key findings",
    ],
  },
  discussion: {
    label: "Discussion",
    defaultPurpose:
      "Interpret findings against prior literature, highlight implications, unexpected outcomes, and limitations.",
    defaultWeight: 13,
    requiredSections: [
      "Interpretation against prior literature",
      "Theoretical and practical implications",
      "Unexpected findings",
      "Study limitations",
    ],
  },
  conclusion: {
    label: "Conclusion",
    defaultPurpose:
      "Summarize findings, draw grounded conclusions, offer recommendations, and outline further research.",
    defaultWeight: 7,
    requiredSections: [
      "Summary of the study",
      "Conclusions",
      "Recommendations",
      "Suggestions for further research",
      "Contribution to knowledge",
    ],
  },
  system_analysis: {
    label: "System analysis",
    defaultPurpose:
      "Analyze existing system workflows, pain points, requirements, and feasibility for the proposed solution.",
    defaultWeight: 12,
    requiredSections: [
      "Analysis of the existing system",
      "Problem identification",
      "Functional and non-functional requirements",
      "Feasibility assessment",
    ],
  },
  system_design: {
    label: "System design",
    defaultPurpose:
      "Specify system architecture, data models, interface layouts, security controls, and component contracts.",
    defaultWeight: 14,
    requiredSections: [
      "System architecture overview",
      "Database and data model design",
      "Interface and user flow design",
      "Security and reliability design",
    ],
  },
  implementation: {
    label: "Implementation",
    defaultPurpose:
      "Document technology choices, module construction, integration workflow, and deployment setup.",
    defaultWeight: 14,
    requiredSections: [
      "Development environment and tools",
      "Core module implementation",
      "External integrations",
      "Deployment configuration",
    ],
  },
  testing: {
    label: "Testing and evaluation",
    defaultPurpose:
      "Present test strategy, verification results, performance observations, and evaluation against objectives.",
    defaultWeight: 10,
    requiredSections: [
      "Testing strategy and test cases",
      "Verification results",
      "Evaluation against objectives",
      "Known limitations",
    ],
  },
  references: {
    label: "References",
    defaultPurpose:
      "Assembled automatically from verified cited sources by the CSL citation engine.",
    defaultWeight: 0,
    requiredSections: [],
  },
  custom: {
    label: "Custom chapter",
    defaultPurpose: "User-defined thematic chapter requiring explicit purpose confirmation.",
    defaultWeight: 12,
    requiredSections: [
      "Overview and context",
      "Core evidence-based analysis",
      "Critical synthesis",
      "Chapter summary",
    ],
  },
};

export const ASSIGNMENT_ANSWER_SECTIONS = [
  "Direct answer",
  "Supporting analysis",
  "Evidence and examples",
] as const;

export const WORDS_PER_PAGE_BASELINE: Record<LineSpacing, number> = {
  double: 275,
  one_half: 375,
  single: 525,
};

export const OUTLINE_BUDGET_TOLERANCE_RATIO = 0.02;
