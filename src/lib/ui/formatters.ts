import type { ProjectStatus, ProjectType } from "@/db/schema";

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
  in_progress: { label: "Writing chapters", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  archived: { label: "Archived", tone: "neutral" },
};

export function formatProjectType(type: ProjectType): string {
  return PROJECT_TYPE_LABELS[type];
}

export function formatProjectStatus(status: ProjectStatus): StatusDisplay {
  return PROJECT_STATUS_DISPLAY[status];
}

export function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
