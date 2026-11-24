"use client";

import Link from "next/link";
import { useState } from "react";
import { STATUS_BADGE_CLASSES } from "@/components/dashboard/project-card";
import { ArrowRightIcon } from "@/components/layout/workspace-icons";
import {
  SETUP_PROJECT_STATUSES,
  type DashboardAttentionItem,
  type DashboardProjectSummary,
} from "@/db/queries/dashboard";
import {
  formatCitationStyle,
  formatProjectType,
  formatShortDate,
  resolveProjectDisplayStatus,
} from "@/lib/ui/formatters";

type OverviewTab = "recent" | "attention";

export function OverviewLedgerClient({
  recentProjects,
  totalProjects,
  attentionItems,
  freeSweepsRemaining,
}: {
  recentProjects: DashboardProjectSummary[];
  totalProjects: number;
  attentionItems: DashboardAttentionItem[];
  freeSweepsRemaining: number;
}) {
  const [tab, setTab] = useState<OverviewTab>(
    attentionItems.length > 0 && recentProjects.length > 0 ? "recent" : "recent"
  );

  return (
    <section
      aria-label="Recent projects and alerts"
      className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] overflow-hidden"
    >
      {/* Hunter-style integrated underline tab header */}
      <div className="px-5 sm:px-6 border-b border-[var(--neutral-200)] flex items-center justify-between gap-4">
        <div role="tablist" aria-label="Activity views" className="flex items-center gap-5">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "recent"}
            onClick={() => setTab("recent")}
            className={`relative py-3.5 text-sm font-medium inline-flex items-center gap-2 transition-colors cursor-pointer ${
              tab === "recent"
                ? "text-[var(--neutral-900)] font-semibold"
                : "text-[var(--neutral-500)] hover:text-[var(--neutral-800)]"
            }`}
          >
            <span>Recent work</span>
            <span className="text-xs tabular-nums px-1.5 py-0.5 rounded-[4px] bg-[var(--neutral-100)] text-[var(--neutral-600)]">
              {totalProjects}
            </span>
            {tab === "recent" ? (
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--accent-600)] rounded-full"
              />
            ) : null}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={tab === "attention"}
            onClick={() => setTab("attention")}
            className={`relative py-3.5 text-sm font-medium inline-flex items-center gap-2 transition-colors cursor-pointer ${
              tab === "attention"
                ? "text-[var(--neutral-900)] font-semibold"
                : "text-[var(--neutral-500)] hover:text-[var(--neutral-800)]"
            }`}
          >
            <span>Needs review</span>
            <span
              className={`text-xs tabular-nums px-1.5 py-0.5 rounded-[4px] ${
                attentionItems.length > 0
                  ? "bg-[var(--accent-100)] text-[var(--accent-600)] font-semibold"
                  : "bg-[var(--neutral-100)] text-[var(--neutral-600)]"
              }`}
            >
              {attentionItems.length}
            </span>
            {tab === "attention" ? (
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--accent-600)] rounded-full"
              />
            ) : null}
          </button>
        </div>

        {totalProjects > 0 ? (
          <Link
            href="/projects"
            className="text-xs font-medium text-[var(--accent-600)] hover:text-[var(--accent-700)] hover:underline underline-offset-4 shrink-0"
          >
            View all
          </Link>
        ) : null}
      </div>

      {/* Tab 1: Recent work hairline ledger */}
      {tab === "recent" ? (
        recentProjects.length === 0 ? (
          <div className="p-6 sm:p-9">
            <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-8">
              <img
                src="/images/empty-projects.jpg"
                alt=""
                width={800}
                height={597}
                className="w-44 sm:w-52 h-auto shrink-0 mix-blend-multiply"
              />
              <div className="space-y-4 text-center sm:text-left">
                <div className="space-y-1.5">
                  <h3 className="text-xl font-medium text-[var(--neutral-900)]">
                    Ready for your first topic
                  </h3>
                  <p className="text-sm text-[var(--neutral-600)] leading-relaxed max-w-[48ch]">
                    Use the bar above to start your first topic. Collate verifies academic sources
                    before drafting any chapter.
                  </p>
                </div>

                <ol className="flex flex-wrap items-center justify-center sm:justify-start gap-x-5 gap-y-2 list-none p-0 m-0 text-xs text-[var(--neutral-700)]">
                  <li className="flex items-center gap-1.5">
                    <span className="font-semibold text-[var(--accent-600)] tabular-nums">01</span>
                    <span>Check sources ({freeSweepsRemaining} free)</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="font-semibold text-[var(--accent-600)] tabular-nums">02</span>
                    <span>Confirm chapter outline</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="font-semibold text-[var(--accent-600)] tabular-nums">03</span>
                    <span>Review &amp; export PDF/Word</span>
                  </li>
                </ol>
              </div>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--neutral-200)] list-none p-0 m-0">
            {recentProjects.map((project, index) => {
              const status = resolveProjectDisplayStatus(project);
              const inSetup = SETUP_PROJECT_STATUSES.has(project.status);
              const doneChapters = project.chaptersApproved + project.chaptersReady;
              const progressPct = inSetup
                ? Math.min(100, Math.max(12, Math.round((project.wizardStep / 8) * 100)))
                : project.chaptersTotal > 0
                  ? Math.min(100, Math.round((doneChapters / project.chaptersTotal) * 100))
                  : project.status === "completed"
                    ? 100
                    : 0;
              const progressText = inSetup
                ? `Step ${project.wizardStep} of 8`
                : project.chaptersTotal > 0
                  ? `${doneChapters}/${project.chaptersTotal} chapters`
                  : "Outline ready";

              const projectOverviewHref = inSetup
                ? `/projects/${project.id}/setup`
                : `/projects/${project.id}`;

              return (
                <li
                  key={project.id}
                  className="px-5 sm:px-6 py-5 sm:py-5 hover:bg-[var(--neutral-50)] transition-colors duration-150 group"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-5">
                    <div className="min-w-0 flex-1 flex flex-col gap-3 sm:gap-2">
                      {/* Row 1: Work type, citation style, and status badge (anchored right on mobile) */}
                      <div className="flex items-center justify-between sm:justify-start gap-2 text-xs text-[var(--neutral-500)]">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-[var(--neutral-700)]">
                            {formatProjectType(project.type)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{formatCitationStyle(project.citationStyle)}</span>
                          {index === 0 && project.lifecycleTab === "active" ? (
                            <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-[4px] bg-[var(--accent-100)] text-[var(--accent-600)]">
                              Active
                            </span>
                          ) : null}
                        </div>

                        <span
                          className={`sm:hidden shrink-0 inline-flex items-center px-2 py-0.5 text-[11px] font-medium border rounded-[4px] ${STATUS_BADGE_CLASSES[status.tone]}`}
                        >
                          {status.label}
                        </span>
                      </div>

                      {/* Row 2: Cleanly truncated single-line project title */}
                      <Link
                        href={projectOverviewHref}
                        title={project.title}
                        className="block text-[0.9375rem] font-semibold leading-snug text-[var(--neutral-900)] group-hover:text-[var(--accent-600)] transition-colors truncate"
                      >
                        {project.title}
                      </Link>

                      {/* Row 3: Progress + quiet metadata split cleanly on mobile */}
                      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-y-2 sm:gap-x-3 text-xs text-[var(--neutral-500)] tabular-nums">
                        <span
                          className={`hidden sm:inline-flex items-center px-2 py-0.5 text-[11px] font-medium border rounded-[4px] ${STATUS_BADGE_CLASSES[status.tone]}`}
                        >
                          {status.label}
                        </span>
                        <span className="inline-flex items-center gap-2.5">
                          <span className="w-20 sm:w-16 h-1.5 rounded-full bg-[var(--neutral-100)] overflow-hidden inline-block">
                            <span
                              className="block h-full rounded-full bg-[var(--accent-600)]"
                              style={{ width: `${progressPct}%` }}
                            />
                          </span>
                          <span className="text-[var(--neutral-700)] font-medium sm:font-normal sm:text-[var(--neutral-500)]">
                            {progressText}
                          </span>
                        </span>
                        <div className="flex items-center gap-2 text-[var(--neutral-500)]">
                          <span>
                            {project.sourcesCount}{" "}
                            {project.sourcesCount === 1 ? "source" : "sources"}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>Updated {formatShortDate(project.updatedAt)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-[var(--neutral-100)] sm:border-t-0 sm:pt-0 shrink-0">
                      <Link
                        href={project.nextAction.href}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent-600)] hover:text-[var(--accent-700)]"
                      >
                        <span>{project.nextAction.label}</span>
                        <ArrowRightIcon className="w-4 h-4 transition-transform duration-150 group-hover:translate-x-0.5" />
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : attentionItems.length === 0 ? (
        <div className="p-8 text-center space-y-1.5">
          <p className="text-sm font-medium text-[var(--neutral-900)]">You&apos;re all caught up</p>
          <p className="text-xs text-[var(--neutral-600)]">
            Finished chapters, paused drafts, and topics that need adjustments will appear here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--neutral-200)] list-none p-0 m-0">
          {attentionItems.map((item) => (
            <li
              key={item.id}
              className="px-5 sm:px-6 py-5 hover:bg-[var(--neutral-50)] transition-colors group"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-5">
                <div className="min-w-0 flex-1 flex flex-col gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`shrink-0 px-2 py-0.5 text-[11px] font-medium border rounded-[4px] ${STATUS_BADGE_CLASSES[item.tone]}`}
                    >
                      {item.kind === "chapter_needs_attention"
                        ? "Paused"
                        : item.kind === "chapter_ready"
                          ? "Ready"
                          : item.kind === "ready_to_plan"
                            ? "Passed"
                            : "Action"}
                    </span>
                    <span className="text-xs text-[var(--neutral-500)] truncate">
                      {item.projectTitle}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-[var(--neutral-900)] m-0">
                    {item.title}
                  </p>
                  <p className="text-xs text-[var(--neutral-600)] leading-relaxed m-0">
                    {item.detail}
                  </p>
                </div>

                <div className="pt-3 border-t border-[var(--neutral-100)] sm:border-t-0 sm:pt-0 shrink-0">
                  <Link
                    href={item.href}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent-600)] hover:text-[var(--accent-700)]"
                  >
                    <span>{item.actionLabel}</span>
                    <ArrowRightIcon className="w-4 h-4 transition-transform duration-150 group-hover:translate-x-0.5" />
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
