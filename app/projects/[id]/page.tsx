import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { env } from "cloudflare:workers";
import { asc, desc, eq } from "drizzle-orm";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import {
  ChapterPipelinePanel,
  type ChapterPanelItem,
} from "@/components/project/chapter-pipeline-panel";
import { ReviseOutlineButton } from "@/components/wizard/revise-outline-button";
import { createDb } from "@/db/client";
import { getProjectOutlineForUser } from "@/db/queries/outline";
import { citations, originalityReports, projectDatasets, sections } from "@/db/schema";
import { ExportControls } from "@/components/project/export-controls";
import { IntegrityPanel } from "@/components/project/integrity-panel";
import { generateAiDisclosureStatement } from "@/lib/originality/integrity-exports";
import { getCurrentUserWizardState } from "@/lib/auth/server";
import { formatProjectStatus, formatProjectType, formatShortDate } from "@/lib/ui/formatters";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Project overview — Collate",
  description: "Manage chapters, datasets, outline, citations, and formatting for your project.",
};

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, state } = await getCurrentUserWizardState(id, `/projects/${id}`);

  if (!state) {
    notFound();
  }

  const db = createDb(env.DB);
  const outlineData = await getProjectOutlineForUser(db, user.id, id);
  const datasetRows = await db
    .select()
    .from(projectDatasets)
    .where(eq(projectDatasets.projectId, id))
    .orderBy(desc(projectDatasets.createdAt));

  const reportRows = await db
    .select()
    .from(originalityReports)
    .where(eq(originalityReports.projectId, id))
    .orderBy(desc(originalityReports.createdAt));

  const latestReportByChapter = new Map<string, (typeof reportRows)[number]>();
  for (const rep of reportRows) {
    if (!latestReportByChapter.has(rep.chapterId)) {
      latestReportByChapter.set(rep.chapterId, rep);
    }
  }

  const citationRows = await db.select().from(citations).where(eq(citations.projectId, id));

  const chapterPanelItems: ChapterPanelItem[] = [];
  for (const ch of state.chapters) {
    const secRows = await db
      .select()
      .from(sections)
      .where(eq(sections.chapterId, ch.id))
      .orderBy(asc(sections.orderIndex));
    chapterPanelItems.push({
      id: ch.id,
      number: ch.number,
      title: ch.title,
      chapterType: ch.chapterType,
      pageBudget: ch.pageBudget,
      wordBudget: ch.wordBudget,
      isAutoReferences: ch.isAutoReferences,
      status: ch.status,
      sectionHeadings: secRows.map((s) => s.heading),
      originalityReport: latestReportByChapter.has(ch.id)
        ? {
            passed: latestReportByChapter.get(ch.id)!.passed,
            overlapScore: latestReportByChapter.get(ch.id)!.overlapScore,
            quoteSharePct: latestReportByChapter.get(ch.id)!.quoteSharePct,
            crossUserScore: latestReportByChapter.get(ch.id)!.crossUserScore,
          }
        : null,
    });
  }

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
          <ChapterPipelinePanel
            projectId={project.id}
            chapters={chapterPanelItems}
            datasets={datasetRows.map((d) => ({
              id: d.id,
              filename: d.filename,
              rowCount: d.rowCount,
            }))}
          />
        )}
        <ExportControls
          projectId={project.id}
          hasCompletedChapters={chapterPanelItems.some(
            (c) => !c.isAutoReferences && (c.status === "ready" || c.status === "approved")
          )}
          allChaptersReady={
            chapterPanelItems.filter((c) => !c.isAutoReferences).length > 0 &&
            chapterPanelItems
              .filter((c) => !c.isAutoReferences)
              .every((c) => c.status === "ready" || c.status === "approved")
          }
        />

        <IntegrityPanel
          projectId={project.id}
          disclosureStatement={generateAiDisclosureStatement({
            authorName: settings.cover.authorName || user.name,
            institution: project.institution,
            projectTitle: project.title,
            citationStyle: settings.citationStyle,
            verifiedSourceCount: citationRows.length,
          })}
        />
      </main>
      <SiteFooter />
    </>
  );
}
