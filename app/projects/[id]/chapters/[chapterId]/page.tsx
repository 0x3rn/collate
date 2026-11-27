import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { env } from "cloudflare:workers";
import { and, desc, eq } from "drizzle-orm";
import { ArrowLeftIcon } from "@/components/layout/workspace-icons";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import {
  ChapterReaderClient,
  type ChapterReaderInitialData,
} from "@/components/project/chapter-reader-client";
import { createDb } from "@/db/client";
import { loadProjectCitationMap } from "@/db/queries/citations";
import { chapters, chapterVersions, claims, originalityReports, projectFigures } from "@/db/schema";
import { getCurrentUserWizardState } from "@/lib/auth/server";
import { buildReaderCitationLabels } from "@/lib/citations/reader-format";
import { formatFigureAttributionForDisplay } from "@/lib/export/figure-layout";
import type { R2ReadWriteBucket } from "@/lib/export/http-handlers";
import { calculateWordsPerPage } from "@/lib/outline/planner";
import { formatUnitHeading } from "@/lib/outline/structures";
import { loadChapterAttentionMap } from "@/lib/writing/attention";
import { extractMarkdownHeadings } from "@/lib/writing/chapter-reader-handlers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Chapter reader | Collate",
  description: "Read, inspect verified citations, review similarity metrics, and make light edits.",
};

export default async function ChapterReaderPage({
  params,
}: {
  params: Promise<{ id: string; chapterId: string }>;
}) {
  const { id, chapterId } = await params;
  const { user, state } = await getCurrentUserWizardState(
    id,
    `/projects/${id}/chapters/${chapterId}`
  );

  if (!state) {
    notFound();
  }

  const db = createDb(env.DB);
  const [chapter] = await db
    .select()
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, id)))
    .limit(1);

  if (!chapter) {
    notFound();
  }

  const versions = await db
    .select()
    .from(chapterVersions)
    .where(eq(chapterVersions.chapterId, chapter.id))
    .orderBy(desc(chapterVersions.version));

  const latest = versions[0] ?? null;
  let markdown = "";
  if (latest) {
    const bucket = env.FILES as unknown as R2ReadWriteBucket;
    const obj = await bucket.get(latest.contentR2Key);
    if (obj) {
      markdown = await obj.text();
    }
  }

  const citationMap = await loadProjectCitationMap(db, id, { excludeRejected: true });
  const citedKeys = Array.from(
    new Set(
      Array.from(markdown.matchAll(/@([a-zA-Z0-9_:-]+)/g))
        .map((m) => m[1]!)
        .filter((k) => citationMap.has(k))
    )
  );
  const formattedReaderCitations = buildReaderCitationLabels({
    markdown,
    registry: citationMap,
    style: state.settings.citationStyle,
  });

  const [latestReport] = await db
    .select()
    .from(originalityReports)
    .where(eq(originalityReports.chapterId, chapter.id))
    .orderBy(desc(originalityReports.createdAt))
    .limit(1);

  const chapterClaims = await db.select().from(claims).where(eq(claims.chapterId, chapter.id));

  const storedFigures = await db
    .select()
    .from(projectFigures)
    .where(eq(projectFigures.projectId, id))
    .orderBy(desc(projectFigures.createdAt))
    .limit(12);

  const attentionMap =
    chapter.status === "needs_attention"
      ? await loadChapterAttentionMap(db, [{ id: chapter.id, chapterType: chapter.chapterType }])
      : new Map();

  const wordsPerPage = calculateWordsPerPage(state.settings.lineSpacing, state.settings.fontSizePt);

  const initial: ChapterReaderInitialData = {
    projectId: id,
    projectType: state.project.type,
    useChapters: state.settings.useChapters,
    projectTitle: state.project.title,
    wordsPerPage,
    pageSize: state.settings.pageSize,
    marginsMm: state.settings.marginsMm,
    chapter: {
      id: chapter.id,
      number: chapter.number,
      title: chapter.title,
      status: chapter.status,
    },
    attention: attentionMap.get(chapter.id) ?? null,
    markdown,
    headings: extractMarkdownHeadings(markdown),
    citationClusters: formattedReaderCitations.clusters,
    citations: citedKeys.map((key) => {
      const item = citationMap.get(key)!;
      return {
        citeKey: key,
        inlineLabel: formattedReaderCitations.singleKeyLabels[key],
        title: item.title,
        authors: formattedReaderCitations.authorLabels[key] ?? null,
        year: item.issued?.["date-parts"]?.[0]?.[0] ?? null,
        yearLabel: formattedReaderCitations.yearLabels[key] ?? null,
        venue: item["container-title"] ?? item.publisher ?? null,
        doi: item.DOI ?? null,
        url: item.URL ?? null,
      };
    }),
    projectFigures: storedFigures.map((f) => ({
      id: f.id,
      url: f.url,
      sourcePageUrl: f.sourcePageUrl,
      title: f.title,
      alt: f.alt,
      caption: f.caption,
      attribution: formatFigureAttributionForDisplay(f.attribution, f.sourcePageUrl).displayText,
      license: f.license,
      naturalWidth: f.naturalWidth,
      naturalHeight: f.naturalHeight,
    })),
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      wordCount: v.wordCount,
      pageCount: v.pageCount,
      createdBy: v.createdBy,
      revisionNotes: v.revisionNotes,
      createdAt: v.createdAt.toISOString(),
    })),
    verifiedClaimsCount: chapterClaims.filter((c) => c.verified).length,
    originalityReport: latestReport
      ? {
          passed: latestReport.passed,
          overlapScore: latestReport.overlapScore,
          semanticScore: latestReport.semanticScore,
          quoteSharePct: latestReport.quoteSharePct,
          crossUserScore: latestReport.crossUserScore,
        }
      : null,
  };

  return (
    <WorkspaceShell user={user} maxWidthClassName="max-w-[1120px]">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 border-b border-[var(--neutral-200)] pb-5">
          <Link
            href={`/projects/${id}`}
            title={`Back to ${state.project.title}`}
            className="inline-flex items-center gap-2 max-w-full text-sm font-medium text-[var(--neutral-600)] hover:text-[var(--neutral-900)] transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4 shrink-0" />
            <span className="truncate">Back to {state.project.title}</span>
          </Link>
          <h1 className="text-[1.75rem] sm:text-[1.875rem] font-medium leading-tight">
            {state.project.type === "assignment"
              ? chapter.title
              : formatUnitHeading(chapter.number, chapter.title, state.settings.useChapters)}
          </h1>
        </div>

        <ChapterReaderClient initial={initial} />
      </div>
    </WorkspaceShell>
  );
}
