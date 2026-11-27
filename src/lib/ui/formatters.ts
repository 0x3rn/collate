import type {
  ChapterStatus,
  CitationStyle,
  CreditLedgerType,
  ExportFormat,
  ExportScope,
  ProjectStatus,
  ProjectType,
} from "@/db/schema";

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  project: "Project",
  research: "Research paper",
  thesis: "Thesis",
  assignment: "Assignment",
};

export interface StatusDisplay {
  label: string;
  tone: "neutral" | "info" | "success" | "warning" | "error";
}

export const PROJECT_STATUS_DISPLAY: Record<ProjectStatus, StatusDisplay> = {
  draft: { label: "Draft", tone: "neutral" },
  researching: { label: "Checking sources", tone: "info" },
  feasible: { label: "Ready to plan", tone: "success" },
  not_feasible: { label: "Insufficient evidence", tone: "error" },
  needs_refinement: { label: "Needs refinement", tone: "warning" },
  outline_pending: { label: "Outline review", tone: "info" },
  in_progress: { label: "Writing Chapters", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  archived: { label: "Archived", tone: "neutral" },
};

export const CHAPTER_STATUS_DISPLAY: Record<ChapterStatus, StatusDisplay> = {
  not_started: { label: "Not started", tone: "neutral" },
  queued: { label: "Queued", tone: "info" },
  writing: { label: "Writing", tone: "info" },
  ready: { label: "Ready for Review", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  needs_attention: { label: "Needs Attention", tone: "warning" },
};

export const CITATION_STYLE_LABELS: Record<CitationStyle, string> = {
  apa7: "APA 7",
  harvard: "Harvard",
  mla9: "MLA 9",
  chicago: "Chicago",
  ieee: "IEEE",
  vancouver: "Vancouver",
};

export const CREDIT_LEDGER_LABELS: Record<CreditLedgerType, string> = {
  purchase: "Credit purchase",
  reserve: "Chapter credit hold",
  capture: "Chapter completed",
  refund: "Automatic refund",
  manual_adjustment: "Credit adjustment",
  sweep_fee: "Topic source check",
};

export function formatProjectType(type: ProjectType): string {
  return PROJECT_TYPE_LABELS[type];
}

export function formatOpenWorkLabel(type: ProjectType): string {
  if (type === "research") return "Open research paper";
  if (type === "thesis") return "Open thesis";
  if (type === "assignment") return "Open assignment";
  return "Open project";
}

export function formatProjectStatus(status: ProjectStatus): StatusDisplay {
  return PROJECT_STATUS_DISPLAY[status];
}

/**
 * Resolves the live badge shown for a project using both the project's lifecycle status
 * and its chapters' real states so paused or review-ready projects never falsely show
 * "Writing Chapters" or prematurely show "Completed".
 */
export function resolveProjectDisplayStatus(input: {
  status: ProjectStatus;
  projectType?: ProjectType;
  useChapters?: boolean;
  chaptersTotal?: number;
  chaptersReady?: number;
  chaptersApproved?: number;
  chaptersWriting?: number;
  chaptersNeedsAttention?: number;
}): StatusDisplay {
  if (input.status === "archived") {
    return PROJECT_STATUS_DISPLAY.archived;
  }

  if ((input.chaptersNeedsAttention ?? 0) > 0) {
    return { label: "Needs Attention", tone: "warning" };
  }

  if ((input.chaptersWriting ?? 0) > 0) {
    const writingLabel =
      input.projectType === "assignment"
        ? "Drafting Answers"
        : input.useChapters === false
          ? "Writing Sections"
          : "Writing Chapters";
    return { label: writingLabel, tone: "info" };
  }

  if ((input.chaptersReady ?? 0) > 0) {
    return { label: "Ready for Review", tone: "warning" };
  }

  const total = input.chaptersTotal ?? 0;
  const approved = input.chaptersApproved ?? 0;
  if (input.status === "completed" || (total > 0 && approved === total)) {
    return PROJECT_STATUS_DISPLAY.completed;
  }

  if (input.status === "in_progress") {
    return approved > 0
      ? { label: "In Progress", tone: "info" }
      : { label: "Ready to Draft", tone: "neutral" };
  }

  return PROJECT_STATUS_DISPLAY[input.status];
}

export function formatChapterStatus(status: ChapterStatus): StatusDisplay {
  return CHAPTER_STATUS_DISPLAY[status];
}

export function formatCitationStyle(style: CitationStyle): string {
  return CITATION_STYLE_LABELS[style];
}

export function formatCreditLedgerType(entryType: string): string {
  return CREDIT_LEDGER_LABELS[entryType as CreditLedgerType] ?? "Credit activity";
}

export function formatExportScope(
  scope: ExportScope,
  chapterNumber?: number | null,
  useChapters = true
): string {
  if (scope === "chapter") {
    if (chapterNumber) {
      return useChapters ? `Chapter ${chapterNumber}` : `Section ${chapterNumber}`;
    }
    return useChapters ? "Single chapter" : "Single section";
  }
  if (scope === "combined") {
    return useChapters ? "Completed chapters" : "Completed sections";
  }
  return "Full manuscript";
}

export function formatExportFormat(format: ExportFormat): string {
  return format === "pdf" ? "PDF" : "Word (.docx)";
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatCredits(value: number): string {
  const formatted = formatNumber(value);
  return `${formatted} ${Math.abs(value) === 1 ? "credit" : "credits"}`;
}

export function formatShortDate(date: Date | string): string {
  const value = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

export function getUserInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}
