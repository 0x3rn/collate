import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { env } from "cloudflare:workers";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { FormAlert } from "@/components/ui/alert";
import { ReviseOutlineButton } from "@/components/wizard/revise-outline-button";
import { createDb } from "@/db/client";
import { getProjectOutlineForUser } from "@/db/queries/outline";
import { getCurrentUserWizardState } from "@/lib/auth/server";
import { formatProjectStatus, formatProjectType, formatShortDate } from "@/lib/ui/formatters";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Project overview — Collate",
  description: "Review your confirmed project outline, chapters, sections, and settings.",
};

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, state } = await getCurrentUserWizardState(id, `/projects/${id}`);

  if (!state) {
    notFound();
  }

  const db = createDb(env.DB);
  const outlineData = await getProjectOutlineForUser(db, user.id, id);

  const { project, settings } = state;
  const statusDisplay = formatProjectStatus(project.status);

  return (
    <>
      <SiteHeader user={user} />
      <main className="flex-1 mx-auto w-full max-w-[960px] px-4 sm:px-6 py-10 sm:py-12 space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[var(--neutral-200)] pb-6">
          <div className="space-y-1.5">
            <Link
              href="/dashboard"
              className="text-sm text-[var(--neutral-600)] hover:text-[var(--neutral-900)] underline underline-offset-4"
            >
              Back to projects
            </Link>
            <p className="text-xs font-medium text-[var(--accent-600)] m-0">
              {formatProjectType(project.type)} · {statusDisplay.label}
              {outlineData?.outlineLocked ? " · Outline locked" : ""}
            </p>
            <h1 className="text-[2rem] font-medium m-0">{project.title}</h1>
            <p className="text-sm text-[var(--neutral-600)] tabular-nums m-0">
              Target: {project.targetPages ?? project.idealPages ?? "—"} pages · Updated{" "}
              {formatShortDate(project.updatedAt)}
            </p>
          </div>
          <ReviseOutlineButton
            projectId={project.id}
            outlineLocked={Boolean(outlineData?.outlineLocked)}
          />
        </div>

        <FormAlert tone="info">
          Confirmed outline and section budgets are persisted in project memory. Citation formatting
          (Phase 6) and durable chapter-by-chapter writing (Phase 7) connect next.
        </FormAlert>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-2">
            <h2 className="text-lg font-medium m-0">Citations</h2>
            <p className="text-sm text-[var(--neutral-700)] m-0">
              Style: <strong>{settings.citationStyle.toUpperCase()}</strong>
            </p>
            <p className="text-sm text-[var(--neutral-600)] m-0">
              Mode:{" "}
              {settings.inlineMode === "inline_and_list"
                ? "Inline citations + reference list"
                : "Reference list only"}
            </p>
          </section>

          <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-2">
            <h2 className="text-lg font-medium m-0">Formatting</h2>
            <p className="text-sm text-[var(--neutral-700)] m-0">
              {settings.font}, {settings.fontSizePt}pt, {settings.lineSpacing.replace("_", " ")}{" "}
              spacing, {settings.marginsMm}mm margins
            </p>
            <p className="text-sm text-[var(--neutral-600)] m-0">
              Spelling: {settings.spelling.toUpperCase()} English · Page numbers:{" "}
              {settings.pageNumbering ? "On" : "Off"}
            </p>
          </section>
        </div>

        {project.type === "assignment" ? (
          <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-4">
            <h2 className="text-xl font-medium m-0">
              Assignment answer plan ({outlineData?.outline.assignmentPlans.length ?? 0} questions)
            </h2>
            <ol className="space-y-4 list-none p-0 m-0">
              {(outlineData?.outline.assignmentPlans ?? []).map((q) => (
                <li
                  key={q.questionId}
                  className="p-4 border border-[var(--neutral-200)] rounded-[var(--radius-sm)] space-y-1.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-[var(--neutral-900)] m-0">
                      <span className="tabular-nums font-semibold mr-1.5">Q{q.orderIndex}.</span>
                      {q.questionText}
                    </p>
                    <span className="text-xs text-[var(--neutral-600)] tabular-nums">
                      ~{q.pageBudget} pages (~{q.wordBudget.toLocaleString()} words)
                    </span>
                  </div>
                  <p className="text-xs text-[var(--neutral-600)] m-0">
                    Sections: {q.sections.map((s) => s.heading).join(" · ")}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        ) : (
          <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-4">
            <h2 className="text-xl font-medium m-0">
              Confirmed chapters ({outlineData?.outline.chapters.length ?? 0})
            </h2>
            <ul className="divide-y divide-[var(--neutral-200)] list-none p-0 m-0">
              {(outlineData?.outline.chapters ?? []).map((ch) => (
                <li key={ch.number} className="py-4 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <span className="text-xs font-semibold text-[var(--neutral-500)] mr-2 tabular-nums">
                        {ch.isAutoReferences ? "AUTO" : `Chapter ${ch.number}`}
                      </span>
                      <span className="text-base font-medium text-[var(--neutral-900)]">
                        {ch.title}
                      </span>
                    </div>
                    <span className="text-xs font-medium text-[var(--neutral-600)] tabular-nums">
                      {ch.isAutoReferences
                        ? "Generated by citation engine"
                        : `~${ch.pageBudget} pages (~${ch.wordBudget.toLocaleString()} words)`}
                    </span>
                  </div>
                  {ch.sections.length > 0 ? (
                    <p className="text-xs text-[var(--neutral-600)] m-0">
                      Sections: {ch.sections.map((s) => s.heading).join(" · ")}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
