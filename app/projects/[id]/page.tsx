import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { FormAlert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { getCurrentUserWizardState } from "@/lib/auth/server";
import { formatProjectStatus, formatProjectType, formatShortDate } from "@/lib/ui/formatters";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Project overview — Collate",
  description: "Review your saved project configuration, chapters, and settings.",
};

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, state } = await getCurrentUserWizardState(id, `/projects/${id}`);

  if (!state) {
    notFound();
  }

  const { project, settings, chapters, questions } = state;
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
            </p>
            <h1 className="text-[2rem] font-medium m-0">{project.title}</h1>
            <p className="text-sm text-[var(--neutral-600)] tabular-nums m-0">
              Target: {project.targetPages ?? project.idealPages ?? "—"} pages · Updated{" "}
              {formatShortDate(project.updatedAt)}
            </p>
          </div>
          <LinkButton href={`/projects/${project.id}/setup`} variant="secondary">
            Edit setup
          </LinkButton>
        </div>

        <FormAlert tone="info">
          Your setup and outline selections are saved in D1. Real multi-source research sweeps and
          chapter-by-chapter writing connect in Phases 3 through 7.
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
            <h2 className="text-xl font-medium m-0">Assignment questions ({questions.length})</h2>
            <ol className="list-decimal pl-5 space-y-2.5 text-sm text-[var(--neutral-800)] m-0">
              {questions.map((q) => (
                <li key={q.id}>{q.text}</li>
              ))}
            </ol>
          </section>
        ) : (
          <section className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 space-y-4">
            <h2 className="text-xl font-medium m-0">Chapters ({chapters.length})</h2>
            <ul className="divide-y divide-[var(--neutral-200)] list-none p-0 m-0">
              {chapters.map((ch) => (
                <li
                  key={ch.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
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
                      : `~${ch.pageBudget ?? 0} pages · Not started`}
                  </span>
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
