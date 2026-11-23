import { FEASIBILITY_CONFIG } from "@/config/feasibility";
import { BILLING_POLICY, CREDIT_PACKS } from "@/config/pricing";

export interface WorkTypeOverview {
  title: string;
  pageRange: string;
  bestFor: string;
  structureNote: string;
}

export const WORK_TYPE_OVERVIEWS: readonly WorkTypeOverview[] = [
  {
    title: "Project",
    pageRange: `${FEASIBILITY_CONFIG.idealPageRanges.project[0]}–${FEASIBILITY_CONFIG.idealPageRanges.project[1]} pages`,
    bestFor: "Final-year undergraduate and HND capstone work.",
    structureNote:
      "Supports standard five-chapter layouts plus practical software chapters like system design, implementation, and testing.",
  },
  {
    title: "Research paper",
    pageRange: `${FEASIBILITY_CONFIG.idealPageRanges.research[0]}–${FEASIBILITY_CONFIG.idealPageRanges.research[1]} pages`,
    bestFor: "Focused studies, technical reports, and policy papers.",
    structureNote:
      "Prioritizes peer-reviewed journals, tight evidence synthesis, and calibrated section lengths.",
  },
  {
    title: "Thesis",
    pageRange: `${FEASIBILITY_CONFIG.idealPageRanges.thesisBachelors[0]}–${FEASIBILITY_CONFIG.idealPageRanges.thesisPhd[1]} pages`,
    bestFor: "Bachelor's (50–80p), Master's (80–150p), and PhD (150–300p) dissertations.",
    structureNote:
      "Includes declaration, abstract, acknowledgements, preface, table of contents, and running memory across chapters.",
  },
  {
    title: "Assignment",
    pageRange: `${FEASIBILITY_CONFIG.idealPageRanges.assignmentPerQuestion[0]}–${FEASIBILITY_CONFIG.idealPageRanges.assignmentPerQuestion[1]} pages / question`,
    bestFor: "Coursework and seminar sets with one or several questions.",
    structureNote:
      "Checks source depth for each question separately, then delivers direct, cited answers in one formatted file.",
  },
] as const;

export const WORKFLOW_STEPS = [
  {
    step: "01",
    title: "Enter your work type and topic",
    body: "Pick Project, Research paper, Thesis, or Assignment. Type your working title or add a list of separate assignment questions.",
  },
  {
    step: "02",
    title: "Verify your topic before writing",
    body: "Collate checks academic databases and credible publications first. When real evidence is missing, it explains why and asks you to refine instead of guessing.",
  },
  {
    step: "03",
    title: "Set page length, chapters, and formatting",
    body: "Keep our recommended page count or enter your school's limit. Choose your chapter titles, citation style, font, spacing, and cover details, then confirm the outline.",
  },
  {
    step: "04",
    title: "Review and approve one chapter at a time",
    body: "Each chapter is drafted in the background, checked for factual support and originality, and emailed to you. Read, edit, download, and start the next chapter when ready.",
  },
] as const;

export const CITATION_SPECIMENS = [
  {
    id: "apa7",
    label: "APA 7",
    inText: "(Okonkwo & Mensah, 2024)",
    reference:
      "Okonkwo, A., & Mensah, B. (2024). Solar microgrid reliability in rural health clinics. Energy Policy. https://doi.org/10.1016/j.enpol.2024.113900",
  },
  {
    id: "harvard",
    label: "Harvard",
    inText: "(Okonkwo and Mensah 2024, p. 14)",
    reference:
      "Okonkwo, A. and Mensah, B. (2024) 'Solar microgrid reliability in rural health clinics', Energy Policy. doi:10.1016/j.enpol.2024.113900.",
  },
  {
    id: "ieee",
    label: "IEEE",
    inText: "[1]",
    reference:
      '[1] A. Okonkwo and B. Mensah, "Solar microgrid reliability in rural health clinics", Energy Policy, 2024, doi: 10.1016/j.enpol.2024.113900.',
  },
  {
    id: "mla9",
    label: "MLA 9",
    inText: "(Okonkwo and Mensah 14)",
    reference:
      'Okonkwo, Adaeze, and Bamidele Mensah. "Solar microgrid reliability in rural health clinics." Energy Policy, 2024.',
  },
] as const;

export const REFUSAL_RULES = [
  {
    willDo: "Stops and asks you to refine when credible sources are missing.",
    wontDo: "Never guesses or pads weak topics just to hit a page count.",
  },
  {
    willDo: "Builds every reference from verified journal and publisher records.",
    wontDo: "Never types out invented authors, titles, or reference links.",
  },
  {
    willDo: "Calculates tables from your uploaded data or marks clear [ADD] placeholders.",
    wontDo: "Never invents survey respondent counts, interviews, or lab numbers.",
  },
  {
    willDo: "Includes similarity scores, a full writing log, and an AI disclosure draft.",
    wontDo: "Never claims it can beat university Turnitin or AI detectors.",
  },
] as const;

export interface LandingFaqItem {
  question: string;
  answer: string;
}

export const LANDING_FAQS: readonly LandingFaqItem[] = [
  {
    question: "What happens if Collate cannot find enough sources for my topic?",
    answer:
      "It marks the topic as needing refinement or not feasible, shows which subtopics lack credible evidence, and suggests narrower directions. It will not begin drafting until your topic has real source support.",
  },
  {
    question: "How do I know every citation and reference is real?",
    answer:
      "References are collected from verified academic indexes and checked before use. While drafting, the writer can only cite sources stored in your project—it cannot invent new citations.",
  },
  {
    question: "Can Collate write a Results chapter for my survey or lab project?",
    answer:
      "Yes, without inventing data. You can upload your real spreadsheet so Collate computes descriptive tables automatically, rely on cited public datasets, or generate a clearly marked template showing where to insert your own findings.",
  },
  {
    question: "Why does Collate write one chapter at a time instead of the whole thesis at once?",
    answer:
      "Long academic work loses focus when rushed together. Writing one chapter at a time lets Collate check every claim, measure real rendered pages, email you when ready, and incorporate your edits before the next chapter starts.",
  },
  {
    question: "Will this guarantee a clean score on Turnitin or an AI detector?",
    answer:
      "No tool can guarantee the result of a university similarity or AI detector. Collate runs layered overlap and uniqueness checks across sources and users, and gives you a similarity report, writing-process log, and AI-use disclosure template to follow your institution's rules honestly.",
  },
  {
    question: "What happens to my credits if a chapter fails halfway through?",
    answer:
      "Credits are held when you start a chapter and refunded automatically in full if the run fails. Completed sections are saved safely so an interrupted chapter can resume without losing progress.",
  },
] as const;

export function getPublicPricingSummary() {
  return {
    freeSweeps: BILLING_POLICY.freeFeasibilitySweepsPerUser,
    creditsPerPage: BILLING_POLICY.creditsPerPage,
    packs: CREDIT_PACKS.map((pack, index) => ({
      id: pack.id,
      label: pack.label,
      credits: pack.credits,
      featured: index === 1,
      ngnFormatted: `₦${(pack.amountNgnKobo / 100).toLocaleString("en-NG")}`,
      usdFormatted: `$${(pack.amountUsdCents / 100).toFixed(0)}`,
      description: pack.description,
    })),
  };
}
