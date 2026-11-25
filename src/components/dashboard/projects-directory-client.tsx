"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { STATUS_BADGE_CLASSES } from "@/components/dashboard/project-card";
import { ArrowRightIcon, SearchIcon } from "@/components/layout/workspace-icons";
import { Button, LinkButton } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import {
  SETUP_PROJECT_STATUSES,
  type DashboardProjectSummary,
  type ProjectLifecycleTab,
} from "@/db/queries/dashboard";
import type { ProjectType } from "@/db/schema";
import {
  formatProjectType,
  formatShortDate,
  resolveProjectDisplayStatus,
} from "@/lib/ui/formatters";

type TabFilter = "all" | ProjectLifecycleTab;
type TypeFilter = "all" | ProjectType;

export function ProjectsDirectoryClient({ projects }: { projects: DashboardProjectSummary[] }) {
  const [activeTab, setActiveTab] = useState<TabFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    let active = 0;
    let completed = 0;
    let archived = 0;
    for (const p of projects) {
      if (p.lifecycleTab === "completed") completed += 1;
      else if (p.lifecycleTab === "archived") archived += 1;
      else active += 1;
    }
    return { all: projects.length, active, completed, archived };
  }, [projects]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((project) => {
      if (activeTab !== "all" && project.lifecycleTab !== activeTab) return false;
      if (typeFilter !== "all" && project.type !== typeFilter) return false;
      if (!q) return true;
      const haystack = [project.title, project.field ?? "", project.institution ?? ""]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [projects, activeTab, typeFilter, query]);

  const tabs: Array<{ id: TabFilter; label: string; count: number }> = [
    { id: "all", label: "All", count: counts.all },
    { id: "active", label: "Active", count: counts.active },
    { id: "completed", label: "Completed", count: counts.completed },
    { id: "archived", label: "Archived", count: counts.archived },
  ];

  const hasFilters = activeTab !== "all" || typeFilter !== "all" || query.trim().length > 0;

  return (
    <section
      aria-label="Projects directory"
      className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)]"
    >
      {/* Integrated Hunter-style underline tabs + inline search/filter bar */}
      <div className="px-5 sm:px-6 border-b border-[var(--neutral-200)] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Filter projects by status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:gap-x-5"
        >
          {tabs.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTab(tab.id)}
                className={`relative py-3 text-[13px] sm:text-sm font-medium inline-flex items-center gap-1.5 sm:gap-2 whitespace-nowrap transition-colors cursor-pointer ${
                  selected
                    ? "text-[var(--neutral-900)] font-semibold"
                    : "text-[var(--neutral-500)] hover:text-[var(--neutral-800)]"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`text-xs tabular-nums px-1.5 py-0.5 rounded-[4px] ${
                    selected
                      ? "bg-[var(--accent-100)] text-[var(--accent-600)]"
                      : "bg-[var(--neutral-100)] text-[var(--neutral-600)]"
                  }`}
                >
                  {tab.count}
                </span>
                {selected ? (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--accent-600)] rounded-full"
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        {projects.length > 0 ? (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pb-3 lg:pb-0">
            <div className="relative sm:w-56">
              <label htmlFor="projects-search" className="sr-only">
                Search projects
              </label>
              <SearchIcon className="w-4 h-4 text-[var(--neutral-400)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="projects-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects..."
                className="w-full min-h-[36px] pl-9 pr-3 py-1.5 text-sm bg-[var(--neutral-50)] focus:bg-white border border-[var(--neutral-200)] rounded-[var(--radius-sm)] text-[var(--neutral-900)] placeholder:text-[var(--neutral-400)] transition-colors"
              />
            </div>

            <label htmlFor="projects-type-filter" className="sr-only">
              Filter by work type
            </label>
            <CustomSelect<TypeFilter>
              id="projects-type-filter"
              ariaLabel="Filter by work type"
              size="sm"
              align="right"
              value={typeFilter}
              onChange={setTypeFilter}
              className="sm:w-[170px]"
              buttonClassName="bg-[var(--neutral-50)] hover:bg-white border-[var(--neutral-200)]"
              options={[
                { value: "all", label: "All types" },
                { value: "project", label: "Projects" },
                { value: "research", label: "Research papers" },
                { value: "thesis", label: "Theses" },
                { value: "assignment", label: "Assignments" },
              ]}
            />
          </div>
        ) : null}
      </div>

      {projects.length === 0 ? (
        <div aria-label="Empty projects list" className="p-8 sm:p-14">
          <div className="max-w-[520px] mx-auto text-center space-y-5">
            <img
              src="/images/empty-projects.jpg"
              alt=""
              width={800}
              height={597}
              className="w-52 sm:w-60 h-auto mx-auto mix-blend-multiply"
            />
            <div className="space-y-2">
              <h2 className="text-2xl font-medium">No projects yet</h2>
              <p className="text-sm sm:text-base text-[var(--neutral-600)] leading-relaxed">
                Start with a topic or assignment question. Collate verifies credible sources first,
                then drafts one checked chapter at a time.
              </p>
            </div>
            <div className="pt-1">
              <LinkButton href="/projects/new" variant="primary">
                Start your first project
              </LinkButton>
            </div>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-10 text-center space-y-3">
          <h2 className="text-lg font-medium">No matching projects</h2>
          <p className="text-sm text-[var(--neutral-600)]">
            {activeTab === "completed"
              ? "Projects move here once every chapter is finished."
              : activeTab === "archived"
                ? "You do not have any archived projects."
                : "Try a different keyword or clear your filters."}
          </p>
          {hasFilters ? (
            <div className="pt-1">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setActiveTab("all");
                  setTypeFilter("all");
                  setQuery("");
                }}
              >
                Show all projects
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {/* Desktop column header */}
          <div className="hidden md:grid md:grid-cols-12 gap-4 px-6 py-2.5 bg-[var(--neutral-50)] border-b border-[var(--neutral-200)] text-[11px] font-semibold uppercase tracking-wider text-[var(--neutral-500)]">
            <div className="col-span-5">Project</div>
            <div className="col-span-3">Stage &amp; progress</div>
            <div className="col-span-2">Sources</div>
            <div className="col-span-2 text-right">Next step</div>
          </div>

          <ul className="divide-y divide-[var(--neutral-200)] list-none p-0">
            {filtered.map((project) => {
              const status = resolveProjectDisplayStatus(project);
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
                ? `Step ${project.wizardStep} of 8`
                : project.chaptersTotal > 0
                  ? project.type === "assignment"
                    ? completedChapters > 0
                      ? "Draft ready"
                      : "Ready to draft"
                    : `${completedChapters} of ${project.chaptersTotal} chapters drafted`
                  : "Outline ready";
              const projectOverviewHref = inSetup
                ? `/projects/${project.id}/setup`
                : `/projects/${project.id}`;

              return (
                <li
                  key={project.id}
                  className="px-5 sm:px-6 py-3.5 md:py-4 grid grid-cols-1 md:grid-cols-12 gap-2.5 md:gap-4 items-start md:items-center hover:bg-[var(--neutral-50)] transition-colors duration-150 group"
                >
                  {/* Project title & type */}
                  <div className="md:col-span-5 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--neutral-500)]">
                      <span className="font-medium text-[var(--neutral-700)]">
                        {formatProjectType(project.type)}
                      </span>
                    </div>
                    <Link
                      href={projectOverviewHref}
                      title={project.title}
                      className="block text-[0.9375rem] font-semibold text-[var(--neutral-900)] group-hover:text-[var(--accent-600)] transition-colors truncate"
                    >
                      {project.title}
                    </Link>
                    {project.field || project.institution ? (
                      <p className="text-xs text-[var(--neutral-500)] truncate">
                        {[project.field, project.institution].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                  </div>

                  {/* Stage & slim progress bar */}
                  <div className="md:col-span-3 space-y-1.5">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium border rounded-[4px] ${STATUS_BADGE_CLASSES[status.tone]}`}
                    >
                      {status.label}
                    </span>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-[var(--neutral-600)] tabular-nums">
                        <span>{progressLabel}</span>
                        <span>{progressPct}%</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-[var(--neutral-100)] overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            status.tone === "success"
                              ? "bg-[var(--success-text)]"
                              : status.tone === "warning" || status.tone === "error"
                                ? "bg-[var(--warning-text)]"
                                : "bg-[var(--accent-600)]"
                          }`}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Sources & date */}
                  <div className="md:col-span-2 text-xs text-[var(--neutral-600)] tabular-nums flex items-center justify-between gap-2 md:block md:space-y-0.5">
                    <p className="font-medium text-[var(--neutral-800)]">
                      {project.sourcesCount} {project.sourcesCount === 1 ? "source" : "sources"}
                    </p>
                    <p className="text-[var(--neutral-500)]">
                      {formatShortDate(project.updatedAt)}
                    </p>
                  </div>

                  {/* Next step action */}
                  <div className="md:col-span-2 flex items-center md:justify-end gap-3">
                    <Link
                      href={project.nextAction.href}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent-600)] hover:text-[var(--accent-700)]"
                    >
                      <span>{project.nextAction.label}</span>
                      <ArrowRightIcon className="w-4 h-4 transition-transform duration-150 group-hover:translate-x-0.5 shrink-0" />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
