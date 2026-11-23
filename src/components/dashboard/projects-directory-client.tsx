"use client";

import { useMemo, useState } from "react";
import { SearchIcon } from "@/components/layout/workspace-icons";
import { Button, LinkButton } from "@/components/ui/button";
import type { DashboardProjectSummary, ProjectLifecycleTab } from "@/db/queries/dashboard";
import type { ProjectType } from "@/db/schema";
import { ProjectCard } from "./project-card";

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

  if (projects.length === 0) {
    return (
      <section
        aria-label="Empty projects list"
        className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-8 sm:p-12"
      >
        <div className="max-w-[560px] mx-auto text-center space-y-5">
          <img
            src="/images/empty-projects.jpg"
            alt=""
            width={800}
            height={597}
            className="w-56 sm:w-64 h-auto mx-auto rounded-[var(--radius-sm)]"
          />
          <div className="space-y-2">
            <h2 className="text-2xl font-medium m-0">No projects yet</h2>
            <p className="text-sm sm:text-base text-[var(--neutral-600)] leading-relaxed m-0">
              Start with a topic or assignment question. Collate checks real academic sources first,
              then helps you draft one verified chapter at a time.
            </p>
          </div>
          <div className="pt-1">
            <LinkButton href="/projects/new" variant="primary">
              Start your first project
            </LinkButton>
          </div>
        </div>
      </section>
    );
  }

  const tabs: Array<{ id: TabFilter; label: string; count: number }> = [
    { id: "all", label: "All", count: counts.all },
    { id: "active", label: "Active", count: counts.active },
    { id: "completed", label: "Completed", count: counts.completed },
    { id: "archived", label: "Archived", count: counts.archived },
  ];

  const hasFilters = activeTab !== "all" || typeFilter !== "all" || query.trim().length > 0;

  return (
    <div className="space-y-6">
      {/* Status tabs + search & type filter bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[var(--neutral-200)]">
        <div
          role="tablist"
          aria-label="Filter projects by status"
          className="flex flex-wrap items-center gap-1.5"
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
                className={`min-h-[38px] px-3 py-1.5 rounded-[var(--radius-sm)] text-sm font-medium inline-flex items-center gap-2 border transition-colors cursor-pointer ${
                  selected
                    ? "bg-[var(--accent-600)] text-white border-[var(--accent-600)]"
                    : "bg-white text-[var(--neutral-700)] border-[var(--neutral-200)] hover:border-[var(--neutral-300)] hover:text-[var(--neutral-900)]"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`text-xs tabular-nums px-1.5 py-0.5 rounded-[4px] ${
                    selected
                      ? "bg-white/15 text-white"
                      : "bg-[var(--neutral-100)] text-[var(--neutral-600)]"
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="relative flex-1 sm:w-64">
            <label htmlFor="projects-search" className="sr-only">
              Search projects
            </label>
            <SearchIcon className="w-4 h-4 text-[var(--neutral-400)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="projects-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title or field..."
              className="w-full min-h-[40px] pl-9 pr-3 py-2 text-sm bg-white border border-[var(--neutral-300)] rounded-[var(--radius-sm)] text-[var(--neutral-900)] placeholder:text-[var(--neutral-400)]"
            />
          </div>

          <label htmlFor="projects-type-filter" className="sr-only">
            Filter by work type
          </label>
          <select
            id="projects-type-filter"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className="min-h-[40px] px-3 py-2 text-sm bg-white border border-[var(--neutral-300)] rounded-[var(--radius-sm)] text-[var(--neutral-800)]"
          >
            <option value="all">All types</option>
            <option value="project">Projects</option>
            <option value="research">Research papers</option>
            <option value="thesis">Theses</option>
            <option value="assignment">Assignments</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-8 text-center space-y-3">
          <h2 className="text-lg font-medium m-0">No matching projects</h2>
          <p className="text-sm text-[var(--neutral-600)] m-0">
            {activeTab === "completed"
              ? "Projects move here once all chapters are finished."
              : activeTab === "archived"
                ? "You do not have any archived projects."
                : "Try a different search word or clear your filters."}
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
        </section>
      ) : (
        <ul className="grid grid-cols-1 xl:grid-cols-2 gap-4 list-none p-0 m-0">
          {filtered.map((project) => (
            <li key={project.id}>
              <ProjectCard project={project} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
