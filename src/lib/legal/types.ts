export type LegalInlineRun =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; label: string; href: string };

export type LegalBlock =
  | { type: "paragraph"; runs: LegalInlineRun[] }
  | { type: "subheading"; id?: string; title: string }
  | { type: "list"; ordered?: boolean; items: LegalInlineRun[][] }
  | { type: "callout"; tone: "info" | "accent"; title: string; runs: LegalInlineRun[] }
  | {
      type: "table";
      caption?: string;
      headers: string[];
      rows: string[][];
    };

export interface LegalSection {
  id: string;
  number: string;
  title: string;
  blocks: LegalBlock[];
}

export interface LegalDocumentData {
  slug: "/terms" | "/privacy" | "/acceptable-use" | "/cookies";
  title: string;
  subtitle: string;
  effectiveDate: string;
  lastUpdated: string;
  intro: LegalInlineRun[][];
  sections: LegalSection[];
}

export function t(text: string): LegalInlineRun {
  return { type: "text", text };
}

export function b(text: string): LegalInlineRun {
  return { type: "strong", text };
}

export function c(text: string): LegalInlineRun {
  return { type: "code", text };
}

export function a(label: string, href: string): LegalInlineRun {
  return { type: "link", label, href };
}
