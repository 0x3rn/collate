import Link from "next/link";
import { ArrowRightIcon } from "@/components/layout/workspace-icons";
import { SETUP_PROJECT_STATUSES, type DashboardProjectSummary } from "@/db/queries/dashboard";
import {
  formatCitationStyle,
  formatProjectStatus,
  formatProjectType,
  formatShortDate,
} from "@/lib/ui/formatters";

export const STATUS_BADGE_CLASSES = {
  neutral: "bg-[var(--neutral-100)] text-[var(--neutral-700)] border-[var(--neutral-200)]",
  info: "bg-[var(--info-bg)] text-[var(--info-text)] border-[var(--info-border)]",
  success: "bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]",
  warning: "bg-[var(--warning-bg)] text-[var(--warning-text)] border-[var(--warning-border)]",
  error: "bg-[var(--error-bg)] text-[var(--error-text)] border-[var(--error-border)]",
} as const;

export function ProjectCard({ project }: { project: DashboardProjectSummary }) {
  const status = formatProjectStatus(project.status);
  const inSetup = SETUP_PROJECT_STATUSES.has(project.status);

  const completedChapters = project.chaptersApproved + project.chaptersReady;
  const progressPct = inSetup
    ? Math.min(100, Math.max(12, Math.round((project.wizardStep / 8) * 100)))
    : project.chaptersTotal > 0
      ? Math.min(100, Math.round((completedChapters / project.chaptersTotal) * 100))
      : project.status === "completed"
        ? 100
        : 0;

  const progressLabel = inSetup
    ? `Setup · Step ${project.wizardStep} of 8`
    : project.chaptersTotal > 0
      ? project.type === "assignment"
        ? completedChapters > 0
          ? "Draft ready"
          : project.chaptersWriting > 0
            ? "Drafting answers"
            : "Ready to draft"
        : `${completedChapters} of ${project.chaptersTotal} chapters drafted`
      : "Outline confirmed";

  const pagesLabel = project.targetPages ?? project.idealPages;

  return (
    <article className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5 sm:p-6 flex flex-col justify-between gap-4 hover:border-[var(--neutral-300)] transition-colors duration-150">
      <div className="space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-[var(--neutral-600)]">
            <span className="font-medium text-[var(--neutral-800)]">
              {formatProjectType(project.type)}
            </span>
            <span aria-hidden="true" className="text-[var(--neutral-300)]">
              ·
            </span>
            <span>{formatCitationStyle(project.citationStyle)}</span>
          </div>

          <span
            className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium border rounded-[var(--radius-sm)] ${STATUS_BADGE_CLASSES[status.tone]}`}
          >
            {status.label}
          </span>
        </div>

        <div className="space-y-1">
          <h2 className="text-lg sm:text-[1.1875rem] font-medium text-[var(--neutral-900)] leading-snug m-0">
            <Link
              href={project.nextAction.href}
              className="hover:text-[var(--accent-600)] transition-colors"
            >
              {project.title}
            </Link>
          </h2>
          {project.field || project.institution ? (
            <p className="text-xs text-[var(--neutral-500)] truncate m-0">
              {[project.field, project.institution].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>

        {/* Progress meter */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-[var(--neutral-600)] tabular-nums">
            <span>{progressLabel}</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-[var(--neutral-100)] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                project.status === "completed"
                  ? "bg-[var(--success-text)]"
                  : project.chaptersNeedsAttention > 0 ||
                      project.status === "needs_refinement" ||
                      project.status === "not_feasible"
                    ? "bg-[var(--warning-text)]"
                    : "bg-[var(--accent-600)]"
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Real metadata stats */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--neutral-600)] tabular-nums">
          {pagesLabel ? <span>{pagesLabel} pages target</span> : null}
          <span>
            {project.sourcesCount} {project.sourcesCount === 1 ? "source" : "sources"}
          </span>
          <span>Updated {formatShortDate(project.updatedAt)}</span>
        </div>
      </div>

      <div className="pt-3.5 border-t border-[var(--neutral-200)] flex items-center justify-between gap-3">
        <Link
          href={project.nextAction.href}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent-600)] hover:text-[var(--accent-700)]"
        >
          <span>{project.nextAction.label}</span>
          <ArrowRightIcon className="w-4 h-4 shrink-0" />
        </Link>

        {!inSetup && project.nextAction.href !== `/projects/${project.id}` ? (
          <Link
            href={`/projects/${project.id}`}
            className="text-xs font-medium text-[var(--neutral-600)] hover:text-[var(--neutral-900)]"
          >
            Overview
          </Link>
        ) : null}
      </div>
    </article>
  );
}
