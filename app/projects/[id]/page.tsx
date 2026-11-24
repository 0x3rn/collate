import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { env } from "cloudflare:workers";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { STATUS_BADGE_CLASSES } from "@/components/dashboard/project-card";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { ArrowLeftIcon } from "@/components/layout/workspace-icons";
import { AssignmentPipelinePanel } from "@/components/project/assignment-pipeline-panel";
import {
  ChapterPipelinePanel,
  type ChapterPanelItem,
} from "@/components/project/chapter-pipeline-panel";
import { ReviseOutlineButton } from "@/components/wizard/revise-outline-button";
import { createDb } from "@/db/client";
import { getProjectOutlineForUser } from "@/db/queries/outline";
import {
  chapterVersions,
  citations,
  originalityReports,
  projectDatasets,
  sections,
} from "@/db/schema";
import { ExportControls } from "@/components/project/export-controls";
import { IntegrityPanel } from "@/components/project/integrity-panel";
import { generateAiDisclosureStatement } from "@/lib/originality/integrity-exports";
import { getCurrentUserWizardState } from "@/lib/auth/server";
import { loadChapterAttentionMap } from "@/lib/writing/attention";
import {
  formatCitationStyle,
  formatNumber,
  formatProjectType,
  formatShortDate,
  resolveProjectDisplayStatus,
} from "@/lib/ui/formatters";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Project overview | Collate",
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

  const pausedChapters = state.chapters
    .filter((ch) => !ch.isAutoReferences && ch.status === "needs_attention")
    .map((ch) => ({ id: ch.id, chapterType: ch.chapterType }));
  const chapterAttentionMap = await loadChapterAttentionMap(db, pausedChapters);

  const chapterIds = state.chapters.map((c) => c.id);
  const existingVersionRows =
    chapterIds.length > 0
      ? await db
          .select({ chapterId: chapterVersions.chapterId })
          .from(chapterVersions)
          .where(inArray(chapterVersions.chapterId, chapterIds))
      : [];
  const chaptersWithDraftVersion = new Set(existingVersionRows.map((v) => v.chapterId));

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
      userInstructions: ch.userInstructions ?? null,
      userAttachmentName: ch.userAttachmentName ?? null,
      userAttachmentKind: ch.userAttachmentKind ?? null,
      hasUserDataTables: Boolean(ch.userDataSummaryMarkdown?.trim()),
      attention: chapterAttentionMap.get(ch.id) ?? null,
      hasDraftVersion: chaptersWithDraftVersion.has(ch.id),
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
  const writableChapters = state.chapters.filter((ch) => !ch.isAutoReferences);
  const statusDisplay = resolveProjectDisplayStatus({
    status: project.status,
    chaptersTotal: writableChapters.length,
    chaptersReady: writableChapters.filter((c) => c.status === "ready").length,
    chaptersApproved: writableChapters.filter((c) => c.status === "approved").length,
    chaptersWriting: writableChapters.filter((c) => c.status === "queued" || c.status === "writing")
      .length,
    chaptersNeedsAttention: writableChapters.filter((c) => c.status === "needs_attention").length,
  });

  return (
    <WorkspaceShell user={user} maxWidthClassName="max-w-[980px]">
      <div className="space-y-7">
        {/* Clean separated breadcrumb + structured project header */}
        <header className="space-y-4 border-b border-[var(--neutral-200)] pb-6">
          <div>
            <Link
              href="/projects"
              className="inline-flex items-center gap-2 text-sm font-medium text-[var(--neutral-600)] hover:text-[var(--neutral-900)] transition-colors"
            >
              <ArrowLeftIcon className="w-4 h-4 shrink-0" />
              <span>Back to projects</span>
            </Link>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="space-y-3 min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-[var(--neutral-700)]">
                  {formatProjectType(project.type)}
                </span>
                <span
                  className={`inline-flex items-center px-2 py-0.5 font-medium border rounded-[4px] ${STATUS_BADGE_CLASSES[statusDisplay.tone]}`}
                >
                  {statusDisplay.label}
                </span>
                {outlineData?.outlineLocked ? (
                  <span className="text-[var(--neutral-500)]">Outline locked</span>
                ) : null}
              </div>

              <h1 className="text-2xl sm:text-[1.875rem] font-medium leading-[1.25] text-[var(--neutral-900)]">
                {project.title}
              </h1>

              <p className="text-sm text-[var(--neutral-600)] tabular-nums">
                Target:{" "}
                {(project.targetPages ?? project.idealPages)
                  ? `${formatNumber((project.targetPages ?? project.idealPages)!)} pages`
                  : "—"}
                {" · "}Updated {formatShortDate(project.updatedAt)}
              </p>
            </div>

            <div className="shrink-0 sm:pt-1">
              <ReviseOutlineButton
                projectId={project.id}
                outlineLocked={Boolean(outlineData?.outlineLocked)}
              />
            </div>
          </div>
        </header>

        {/* Single-surface horizontal Citations & Formatting bar */}
        <section
          aria-label="Project style and formatting"
          className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--neutral-200)]"
        >
          <div className="p-5 sm:p-6 space-y-3">
            <h2 className="text-base font-semibold text-[var(--neutral-900)]">Citations</h2>
            <dl className="space-y-2 text-sm m-0">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-[var(--neutral-500)]">Style</dt>
                <dd className="font-medium text-[var(--neutral-900)] m-0">
                  {formatCitationStyle(settings.citationStyle)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-[var(--neutral-500)]">Format</dt>
                <dd className="text-[var(--neutral-800)] text-right m-0">
                  {settings.inlineMode === "inline_and_list"
                    ? "In-text citations + reference list"
                    : "Reference list only"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="p-5 sm:p-6 space-y-3">
            <h2 className="text-base font-semibold text-[var(--neutral-900)]">Formatting</h2>
            <dl className="space-y-2 text-sm m-0">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-[var(--neutral-500)]">Typography</dt>
                <dd className="text-[var(--neutral-900)] text-right tabular-nums m-0">
                  {settings.font}, {settings.fontSizePt}pt, {settings.lineSpacing.replace("_", " ")}{" "}
                  spacing
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-[var(--neutral-500)]">Layout</dt>
                <dd className="text-[var(--neutral-800)] text-right tabular-nums m-0">
                  {settings.pageSize === "letter" ? "US Letter" : "A4"} · {settings.marginsMm}mm
                  margins · {settings.spelling.toUpperCase()} English ·{" "}
                  {settings.pageNumbering ? "Page numbers included" : "No page numbers"}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {project.type === "assignment" ? (
          <AssignmentPipelinePanel
            projectId={project.id}
            questions={(outlineData?.outline.assignmentPlans ?? []).map((q) => ({
              questionId: q.questionId,
              orderIndex: q.orderIndex,
              questionText: q.questionText,
              pageBudget: q.pageBudget,
              wordBudget: q.wordBudget,
              sectionHeadings: q.sections.map((s) => s.heading),
            }))}
            assignmentChapter={
              chapterPanelItems[0]
                ? {
                    id: chapterPanelItems[0].id,
                    status: chapterPanelItems[0].status,
                    originalityReport: chapterPanelItems[0].originalityReport,
                  }
                : null
            }
          />
        ) : (
          <ChapterPipelinePanel
            projectId={project.id}
            chapters={chapterPanelItems}
            isExperimental={settings.isExperimental}
            experimentalDataMode={settings.experimentalDataMode}
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
      </div>
    </WorkspaceShell>
  );
}
