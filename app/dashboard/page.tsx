import { env } from "cloudflare:workers";
import type { Metadata } from "next";
import Link from "next/link";
import { ProjectCard, STATUS_BADGE_CLASSES } from "@/components/dashboard/project-card";
import { ArrowRightIcon, DownloadIcon } from "@/components/layout/workspace-icons";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { LinkButton } from "@/components/ui/button";
import { createDb } from "@/db/client";
import {
  getDashboardOverviewForUser,
  resolveExportSigningSecret,
  SETUP_PROJECT_STATUSES,
} from "@/db/queries/dashboard";
import { requireUser } from "@/lib/auth/server";
import {
  formatCitationStyle,
  formatExportFormat,
  formatExportScope,
  formatProjectStatus,
  formatProjectType,
  formatShortDate,
} from "@/lib/ui/formatters";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Overview — Collate",
  description: "Track your active research projects, chapters awaiting review, and credit balance.",
};

export default async function DashboardOverviewPage() {
  const user = await requireUser("/dashboard");
  const db = createDb(env.DB);
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  const signingSecret = resolveExportSigningSecret({
    configuredSecret: runtimeEnv.EXPORT_SIGNING_SECRET,
    appEnv: runtimeEnv.APP_ENV,
  });

  const overview = await getDashboardOverviewForUser(db, user.id, { signingSecret });
  const { stats, spotlightProject, attentionItems, recentProjects, recentExports } = overview;
  const firstName = user.name.trim().split(/\s+/)[0] || user.name;

  return (
    <WorkspaceShell user={user}>
      <div className="space-y-8">
        {/* Page Header */}
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-[var(--neutral-200)]">
          <div className="space-y-1">
            <h1 className="text-[1.875rem] sm:text-[2.125rem] font-medium m-0">
              Welcome back, {firstName}
            </h1>
            <p className="text-sm sm:text-base text-[var(--neutral-600)] m-0">
              Track your active drafts, review finished chapters, and pick up where you left off.
            </p>
          </div>
          <LinkButton href="/projects/new" variant="primary" className="shrink-0 w-fit">
            Start a new project
          </LinkButton>
        </header>

        {/* 4 Live KPI Metric Cards */}
        <section
          aria-label="Workspace summary"
          className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4"
        >
          <Link
            href="/projects"
            className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-4 sm:p-5 space-y-1.5 hover:border-[var(--neutral-300)] transition-colors"
          >
            <p className="text-xs font-medium text-[var(--neutral-500)] m-0">Active projects</p>
            <p className="text-2xl sm:text-[1.75rem] font-semibold text-[var(--neutral-900)] tabular-nums leading-tight m-0">
              {stats.activeProjects}
            </p>
            <p className="text-xs text-[var(--neutral-600)] tabular-nums m-0">
              {stats.completedProjects} completed
            </p>
          </Link>

          <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-4 sm:p-5 space-y-1.5">
            <p className="text-xs font-medium text-[var(--neutral-500)] m-0">Ready for review</p>
            <p
              className={`text-2xl sm:text-[1.75rem] font-semibold tabular-nums leading-tight m-0 ${
                stats.chaptersReadyForReview > 0
                  ? "text-[var(--accent-600)]"
                  : "text-[var(--neutral-900)]"
              }`}
            >
              {stats.chaptersReadyForReview}
            </p>
            <p className="text-xs text-[var(--neutral-600)] tabular-nums m-0">
              {stats.chaptersCompleted} of {stats.chaptersTotal} chapters drafted
            </p>
          </div>

          <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-4 sm:p-5 space-y-1.5">
            <p className="text-xs font-medium text-[var(--neutral-500)] m-0">Verified sources</p>
            <p className="text-2xl sm:text-[1.75rem] font-semibold text-[var(--neutral-900)] tabular-nums leading-tight m-0">
              {stats.verifiedSourcesTotal}
            </p>
            <p className="text-xs text-[var(--neutral-600)] tabular-nums m-0">
              {stats.exportsTotal} saved {stats.exportsTotal === 1 ? "export" : "exports"}
            </p>
          </div>

          <Link
            href="/billing"
            className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-4 sm:p-5 space-y-1.5 hover:border-[var(--neutral-300)] transition-colors"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-[var(--neutral-500)] m-0">Credits</p>
              <span className="text-[11px] font-medium text-[var(--accent-600)]">Buy more</span>
            </div>
            <p className="text-2xl sm:text-[1.75rem] font-semibold text-[var(--neutral-900)] tabular-nums leading-tight m-0">
              {user.creditsBalance}
            </p>
            <p className="text-xs text-[var(--neutral-600)] tabular-nums m-0">
              {stats.freeSweepsRemaining} free topic{" "}
              {stats.freeSweepsRemaining === 1 ? "check" : "checks"} left
            </p>
          </Link>
        </section>

        {/* Empty State for New Users */}
        {stats.totalProjects === 0 ? (
          <section
            aria-label="Get started"
            className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 sm:p-10"
          >
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-7 space-y-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent-600)] m-0">
                  Ready to begin
                </p>
                <div className="space-y-2">
                  <h2 className="text-2xl sm:text-[1.75rem] font-medium m-0">
                    Start your first evidence-backed project
                  </h2>
                  <p className="text-sm sm:text-base text-[var(--neutral-600)] leading-relaxed max-w-[54ch] m-0">
                    Pick a project, research paper, thesis, or assignment. Collate checks real
                    scholarly sources first, then helps you draft and export one verified chapter at
                    a time.
                  </p>
                </div>

                <ol className="grid grid-cols-1 sm:grid-cols-3 gap-3 list-none p-0 m-0 pt-1">
                  <li className="p-3.5 rounded-[var(--radius-sm)] bg-[var(--neutral-50)] border border-[var(--neutral-200)] space-y-1">
                    <span className="text-xs font-semibold text-[var(--accent-600)] tabular-nums">
                      01
                    </span>
                    <p className="text-sm font-medium text-[var(--neutral-900)] m-0">
                      Check your topic
                    </p>
                    <p className="text-xs text-[var(--neutral-600)] m-0">
                      {stats.freeSweepsRemaining} free source checks included.
                    </p>
                  </li>
                  <li className="p-3.5 rounded-[var(--radius-sm)] bg-[var(--neutral-50)] border border-[var(--neutral-200)] space-y-1">
                    <span className="text-xs font-semibold text-[var(--accent-600)] tabular-nums">
                      02
                    </span>
                    <p className="text-sm font-medium text-[var(--neutral-900)] m-0">
                      Confirm outline
                    </p>
                    <p className="text-xs text-[var(--neutral-600)] m-0">
                      Set pages, chapters, and citation style.
                    </p>
                  </li>
                  <li className="p-3.5 rounded-[var(--radius-sm)] bg-[var(--neutral-50)] border border-[var(--neutral-200)] space-y-1">
                    <span className="text-xs font-semibold text-[var(--accent-600)] tabular-nums">
                      03
                    </span>
                    <p className="text-sm font-medium text-[var(--neutral-900)] m-0">
                      Review &amp; export
                    </p>
                    <p className="text-xs text-[var(--neutral-600)] m-0">
                      Approve chapters and download PDF or Word.
                    </p>
                  </li>
                </ol>

                <div className="pt-1 flex flex-wrap items-center gap-3">
                  <LinkButton href="/projects/new" variant="primary">
                    Start your first project
                  </LinkButton>
                  <LinkButton href="/billing" variant="secondary">
                    View credit packs
                  </LinkButton>
                </div>
              </div>

              <div className="lg:col-span-5 flex justify-center">
                <img
                  src="/images/empty-projects.jpg"
                  alt=""
                  width={800}
                  height={597}
                  className="w-full max-w-[320px] h-auto rounded-[var(--radius-sm)]"
                />
              </div>
            </div>
          </section>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left primary column: Spotlight + Recent Projects */}
            <div className="lg:col-span-7 space-y-6">
              {spotlightProject ? (
                <section
                  aria-label="Continue where you left off"
                  className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] overflow-hidden shadow-[var(--shadow-subtle)]"
                >
                  <div className="px-6 py-3 bg-[var(--neutral-100)] border-b border-[var(--neutral-200)] flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[var(--neutral-600)]">
                      Continue where you left off
                    </span>
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium border rounded-[var(--radius-sm)] ${STATUS_BADGE_CLASSES[formatProjectStatus(spotlightProject.status).tone]}`}
                    >
                      {formatProjectStatus(spotlightProject.status).label}
                    </span>
                  </div>

                  <div className="p-6 space-y-5">
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-[var(--neutral-600)] m-0">
                        {formatProjectType(spotlightProject.type)} ·{" "}
                        {formatCitationStyle(spotlightProject.citationStyle)}
                        {spotlightProject.institution ? ` · ${spotlightProject.institution}` : ""}
                      </p>
                      <h2 className="text-xl sm:text-2xl font-medium text-[var(--neutral-900)] leading-snug m-0">
                        {spotlightProject.title}
                      </h2>
                    </div>

                    {(() => {
                      const inSetup = SETUP_PROJECT_STATUSES.has(spotlightProject.status);
                      const doneChapters =
                        spotlightProject.chaptersApproved + spotlightProject.chaptersReady;
                      const pct = inSetup
                        ? Math.min(
                            100,
                            Math.max(12, Math.round((spotlightProject.wizardStep / 8) * 100))
                          )
                        : spotlightProject.chaptersTotal > 0
                          ? Math.min(
                              100,
                              Math.round((doneChapters / spotlightProject.chaptersTotal) * 100)
                            )
                          : spotlightProject.status === "completed"
                            ? 100
                            : 0;

                      return (
                        <div className="p-4 rounded-[var(--radius-sm)] bg-[var(--neutral-50)] border border-[var(--neutral-200)] space-y-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--neutral-700)] tabular-nums">
                            <span className="font-medium">
                              {inSetup
                                ? `Project setup · Step ${spotlightProject.wizardStep} of 8`
                                : spotlightProject.chaptersTotal > 0
                                  ? `${doneChapters} of ${spotlightProject.chaptersTotal} chapters drafted`
                                  : "Outline ready"}
                            </span>
                            <span>{pct}%</span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-white border border-[var(--neutral-200)] overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[var(--accent-600)] transition-all duration-300"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--neutral-600)] tabular-nums">
                            {spotlightProject.targetPages ? (
                              <span>Target: {spotlightProject.targetPages} pages</span>
                            ) : null}
                            <span>{spotlightProject.sourcesCount} verified sources</span>
                            <span>Updated {formatShortDate(spotlightProject.updatedAt)}</span>
                          </div>
                        </div>
                      );
                    })()}

                    <div className="flex flex-wrap items-center gap-3">
                      <LinkButton href={spotlightProject.nextAction.href} variant="primary">
                        {spotlightProject.nextAction.label}
                      </LinkButton>
                      {spotlightProject.nextAction.href !== `/projects/${spotlightProject.id}` &&
                      !SETUP_PROJECT_STATUSES.has(spotlightProject.status) ? (
                        <LinkButton href={`/projects/${spotlightProject.id}`} variant="secondary">
                          Open project overview
                        </LinkButton>
                      ) : null}
                    </div>
                  </div>
                </section>
              ) : null}

              {/* Recent projects preview */}
              <section aria-label="Recent projects" className="space-y-3.5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl font-medium m-0">Recent projects</h2>
                  <Link
                    href="/projects"
                    className="inline-flex items-center gap-1 text-sm font-medium text-[var(--accent-600)] hover:text-[var(--accent-700)]"
                  >
                    <span>View all ({stats.totalProjects})</span>
                    <ArrowRightIcon className="w-4 h-4" />
                  </Link>
                </div>

                <ul className="space-y-3.5 list-none p-0 m-0">
                  {recentProjects.map((project) => (
                    <li key={project.id}>
                      <ProjectCard project={project} />
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            {/* Right secondary column: Needs attention + Recent exports */}
            <div className="lg:col-span-5 space-y-6">
              {/* Needs your attention */}
              <section
                aria-label="Needs your attention"
                className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] overflow-hidden"
              >
                <div className="px-5 py-4 border-b border-[var(--neutral-200)] flex items-center justify-between gap-2">
                  <h2 className="text-lg font-medium m-0">Needs your attention</h2>
                  {attentionItems.length > 0 ? (
                    <span className="px-2 py-0.5 text-xs font-semibold tabular-nums rounded-[var(--radius-sm)] bg-[var(--accent-100)] text-[var(--accent-600)]">
                      {attentionItems.length}
                    </span>
                  ) : null}
                </div>

                {attentionItems.length === 0 ? (
                  <div className="p-5 space-y-1">
                    <p className="text-sm font-medium text-[var(--neutral-900)] m-0">
                      You&apos;re all caught up
                    </p>
                    <p className="text-xs text-[var(--neutral-600)] leading-relaxed m-0">
                      No chapters are paused or waiting for review right now.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-[var(--neutral-200)] list-none p-0 m-0">
                    {attentionItems.map((item) => (
                      <li key={item.id} className="p-4 sm:px-5 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 space-y-0.5">
                            <p className="text-xs text-[var(--neutral-500)] truncate m-0">
                              {item.projectTitle}
                            </p>
                            <p className="text-sm font-semibold text-[var(--neutral-900)] m-0">
                              {item.title}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 px-2 py-0.5 text-[11px] font-medium border rounded-[var(--radius-sm)] ${STATUS_BADGE_CLASSES[item.tone]}`}
                          >
                            {item.kind === "chapter_needs_attention"
                              ? "Paused"
                              : item.kind === "chapter_ready"
                                ? "Ready"
                                : item.kind === "ready_to_plan"
                                  ? "Passed"
                                  : "Action"}
                          </span>
                        </div>
                        <p className="text-xs text-[var(--neutral-600)] m-0 line-clamp-2">
                          {item.detail}
                        </p>
                        <Link
                          href={item.href}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent-600)] hover:text-[var(--accent-700)]"
                        >
                          <span>{item.actionLabel}</span>
                          <ArrowRightIcon className="w-3.5 h-3.5" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Recent exports */}
              <section
                aria-label="Recent exports"
                className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] overflow-hidden"
              >
                <div className="px-5 py-4 border-b border-[var(--neutral-200)] flex items-center justify-between gap-2">
                  <h2 className="text-lg font-medium m-0">Recent exports</h2>
                  <Link
                    href="/exports"
                    className="text-xs font-medium text-[var(--accent-600)] hover:underline underline-offset-4"
                  >
                    View all
                  </Link>
                </div>

                {recentExports.length === 0 ? (
                  <div className="p-5 space-y-1">
                    <p className="text-sm font-medium text-[var(--neutral-900)] m-0">
                      No exported files yet
                    </p>
                    <p className="text-xs text-[var(--neutral-600)] leading-relaxed m-0">
                      PDF and Word files you export from your projects will appear here for quick
                      download.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-[var(--neutral-200)] list-none p-0 m-0">
                    {recentExports.map((exp) => (
                      <li
                        key={exp.id}
                        className="px-5 py-3.5 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <Link
                            href={`/projects/${exp.projectId}`}
                            className="text-sm font-medium text-[var(--neutral-900)] hover:text-[var(--accent-600)] block truncate"
                          >
                            {exp.projectTitle}
                          </Link>
                          <p className="text-xs text-[var(--neutral-600)] tabular-nums m-0">
                            {formatExportFormat(exp.format)} ·{" "}
                            {formatExportScope(exp.scope, exp.chapterNumber)} ·{" "}
                            {formatShortDate(exp.createdAt)}
                          </p>
                        </div>

                        {exp.downloadUrl ? (
                          <a
                            href={exp.downloadUrl}
                            aria-label={`Download ${exp.projectTitle}`}
                            className="w-9 h-9 rounded-[var(--radius-sm)] border border-[var(--neutral-200)] bg-[var(--neutral-50)] hover:bg-[var(--neutral-100)] text-[var(--accent-600)] grid place-items-center shrink-0 transition-colors"
                          >
                            <DownloadIcon className="w-4 h-4" />
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}
