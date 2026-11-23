import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { env } from "cloudflare:workers";
import { and, desc, eq } from "drizzle-orm";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import {
  ChapterReaderClient,
  type ChapterReaderInitialData,
} from "@/components/project/chapter-reader-client";
import { createDb } from "@/db/client";
import { loadProjectCitationMap } from "@/db/queries/citations";
import { chapters, chapterVersions, claims, originalityReports } from "@/db/schema";
import { getCurrentUserWizardState } from "@/lib/auth/server";
import type { R2ReadWriteBucket } from "@/lib/export/http-handlers";
import { extractMarkdownHeadings } from "@/lib/writing/chapter-reader-handlers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Chapter reader — Collate",
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

  const [latestReport] = await db
    .select()
    .from(originalityReports)
    .where(eq(originalityReports.chapterId, chapter.id))
    .orderBy(desc(originalityReports.createdAt))
    .limit(1);

  const chapterClaims = await db.select().from(claims).where(eq(claims.chapterId, chapter.id));

  const initial: ChapterReaderInitialData = {
    projectId: id,
    chapter: {
      id: chapter.id,
      number: chapter.number,
      title: chapter.title,
      status: chapter.status,
    },
    markdown,
    headings: extractMarkdownHeadings(markdown),
    citations: citedKeys.map((key) => {
      const item = citationMap.get(key)!;
      return {
        citeKey: key,
        title: item.title,
        year: item.issued?.["date-parts"]?.[0]?.[0] ?? null,
        venue: item["container-title"] ?? item.publisher ?? null,
        doi: item.DOI ?? null,
        url: item.URL ?? null,
      };
    }),
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
    <>
      <SiteHeader user={user} />
      <main className="flex-1 mx-auto w-full max-w-[1120px] px-4 sm:px-6 py-10 space-y-6">
        <div className="space-y-1 border-b border-[var(--neutral-200)] pb-5">
          <Link
            href={`/projects/${id}`}
            className="text-sm text-[var(--neutral-600)] hover:text-[var(--neutral-900)] underline underline-offset-4"
          >
            Back to {state.project.title}
          </Link>
          <h1 className="text-[1.875rem] font-medium m-0">
            Chapter {chapter.number}: {chapter.title}
          </h1>
        </div>

        <ChapterReaderClient initial={initial} />
      </main>
      <SiteFooter />
    </>
  );
}
