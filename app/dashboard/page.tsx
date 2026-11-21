import type { Metadata } from "next";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { LinkButton } from "@/components/ui/button";
import { listCurrentUserProjects, requireUser } from "@/lib/auth/server";
import { formatProjectStatus, formatProjectType, formatShortDate } from "@/lib/ui/formatters";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Projects — Collate",
  description: "View and manage your research projects, theses, and assignments.",
};

const BADGE_CLASSES = {
  neutral: "bg-[var(--neutral-100)] text-[var(--neutral-700)] border-[var(--neutral-200)]",
  info: "bg-[var(--info-bg)] text-[var(--info-text)] border-[var(--info-border)]",
  success: "bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]",
  warning: "bg-[var(--warning-bg)] text-[var(--warning-text)] border-[var(--warning-border)]",
  error: "bg-[var(--error-bg)] text-[var(--error-text)] border-[var(--error-border)]",
} as const;

export default async function DashboardPage() {
  const user = await requireUser("/dashboard");
  const projects = await listCurrentUserProjects();

  return (
    <>
      <SiteHeader user={user} />

      <main className="flex-1 mx-auto w-full max-w-[1120px] px-4 sm:px-6 py-10 sm:py-12">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[var(--neutral-200)] pb-6 mb-8">
          <div className="space-y-1">
            <h1 className="text-[2rem] font-medium">Projects</h1>
            <p className="text-sm text-[var(--neutral-600)]">
              Signed in as {user.name} ·{" "}
              <span className="tabular-nums font-medium text-[var(--neutral-800)]">
                {user.creditsBalance} credits
              </span>
            </p>
          </div>
          <LinkButton href="/projects/new" variant="primary">
            Start a new project
          </LinkButton>
        </div>

        {projects.length === 0 ? (
          <section
            aria-label="Empty projects list"
            className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-8 sm:p-12 max-w-[640px]"
          >
            <h2 className="text-2xl font-medium mb-2">No projects yet</h2>
            <p className="text-[var(--neutral-600)] leading-relaxed mb-6">
              Each project stores your topic, source sweep results, confirmed chapter outline,
              verified drafts, and PDF or Word exports in one place.
            </p>
            <LinkButton href="/projects/new" variant="primary">
              Start your first project
            </LinkButton>
          </section>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 list-none p-0 m-0">
            {projects.map((project) => {
              const status = formatProjectStatus(project.status);
              return (
                <li
                  key={project.id}
                  className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-[var(--neutral-600)]">
                      {formatProjectType(project.type)}
                    </span>
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium border rounded-[var(--radius-sm)] ${BADGE_CLASSES[status.tone]}`}
                    >
                      {status.label}
                    </span>
                  </div>

                  <h2 className="text-xl font-medium text-[var(--neutral-900)]">{project.title}</h2>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--neutral-600)] tabular-nums">
                    {project.targetPages ? <span>Target: {project.targetPages} pages</span> : null}
                    <span>Updated {formatShortDate(project.updatedAt)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <SiteFooter />
    </>
  );
}
