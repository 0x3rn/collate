import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { loadProjectCitationMap } from "@/db/queries/citations";
import { getWizardStateForUser } from "@/db/queries/wizard";
import { chapters, chapterVersions, claims, originalityReports, projectMemory } from "@/db/schema";
import { isAllowedOrigin, jsonNoStore, readSessionTokenFromRequest } from "@/lib/auth/cookies";
import type { HttpAuthDeps } from "@/lib/auth/http-handlers";
import { getSessionFromToken } from "@/lib/auth/service";
import type { R2ReadWriteBucket } from "@/lib/export/http-handlers";
import { calculateWordsPerPage } from "@/lib/outline/planner";
import { countWords } from "./section-pipeline";

export interface ChapterReaderDeps extends HttpAuthDeps {
  bucket: R2ReadWriteBucket;
}

const SaveLightEditSchema = z.object({
  markdown: z.string().trim().min(20, "Chapter text cannot be empty.").max(250_000),
  editSummary: z.string().trim().max(400).optional(),
});

export function extractMarkdownHeadings(
  markdown: string
): Array<{ id: string; text: string; level: number }> {
  const headings: Array<{ id: string; text: string; level: number }> = [];
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      headings.push({
        id: `sec-${headings.length + 1}`,
        text: trimmed.slice(3).trim(),
        level: 2,
      });
    } else if (trimmed.startsWith("### ")) {
      headings.push({
        id: `sec-${headings.length + 1}`,
        text: trimmed.slice(4).trim(),
        level: 3,
      });
    }
  }
  return headings;
}

export async function handleGetChapterReader(
  request: Request,
  projectId: string,
  chapterId: string,
  deps: ChapterReaderDeps
): Promise<Response> {
  const isProd = deps.appEnv === "prod";
  const session = await getSessionFromToken(
    deps.db,
    readSessionTokenFromRequest(request, isProd),
    deps.nowFn
  );
  if (!session) {
    return jsonNoStore({ ok: false, error: "Authentication required." }, 401);
  }

  const wizard = await getWizardStateForUser(deps.db, session.user.id, projectId);
  if (!wizard) {
    return jsonNoStore({ ok: false, error: "Project not found." }, 404);
  }

  const [chapter] = await deps.db
    .select()
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, projectId)))
    .limit(1);

  if (!chapter) {
    return jsonNoStore({ ok: false, error: "Chapter not found." }, 404);
  }

  const versions = await deps.db
    .select()
    .from(chapterVersions)
    .where(eq(chapterVersions.chapterId, chapter.id))
    .orderBy(desc(chapterVersions.version));

  const latest = versions[0] ?? null;
  let markdown = "";
  if (latest) {
    const obj = await deps.bucket.get(latest.contentR2Key);
    if (obj) {
      markdown = await obj.text();
    }
  }

  const citationMap = await loadProjectCitationMap(deps.db, projectId, { excludeRejected: true });
  const citedKeys = Array.from(
    new Set(
      Array.from(markdown.matchAll(/@([a-zA-Z0-9_:-]+)/g))
        .map((m) => m[1]!)
        .filter((k) => citationMap.has(k))
    )
  );

  const citationCards = citedKeys.map((key) => {
    const item = citationMap.get(key)!;
    const year = item.issued?.["date-parts"]?.[0]?.[0] ?? null;
    return {
      citeKey: key,
      title: item.title,
      year,
      venue: item["container-title"] ?? item.publisher ?? null,
      doi: item.DOI ?? null,
      url: item.URL ?? null,
    };
  });

  const [latestReport] = await deps.db
    .select()
    .from(originalityReports)
    .where(eq(originalityReports.chapterId, chapter.id))
    .orderBy(desc(originalityReports.createdAt))
    .limit(1);

  const chapterClaims = await deps.db.select().from(claims).where(eq(claims.chapterId, chapter.id));

  return jsonNoStore(
    {
      ok: true,
      chapter: {
        id: chapter.id,
        number: chapter.number,
        title: chapter.title,
        status: chapter.status,
        pageBudget: chapter.pageBudget,
        wordBudget: chapter.wordBudget,
      },
      latestVersion: latest
        ? {
            id: latest.id,
            version: latest.version,
            wordCount: latest.wordCount,
            pageCount: latest.pageCount,
            createdBy: latest.createdBy,
            createdAt: latest.createdAt.toISOString(),
          }
        : null,
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        wordCount: v.wordCount,
        pageCount: v.pageCount,
        createdBy: v.createdBy,
        revisionNotes: v.revisionNotes,
        createdAt: v.createdAt.toISOString(),
      })),
      markdown,
      headings: extractMarkdownHeadings(markdown),
      citations: citationCards,
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
    },
    200
  );
}

export async function handleSaveChapterLightEdit(
  request: Request,
  projectId: string,
  chapterId: string,
  deps: ChapterReaderDeps
): Promise<Response> {
  if (!isAllowedOrigin(request, deps.appUrl)) {
    return jsonNoStore({ ok: false, error: "Forbidden cross-origin request." }, 403);
  }

  const isProd = deps.appEnv === "prod";
  const session = await getSessionFromToken(
    deps.db,
    readSessionTokenFromRequest(request, isProd),
    deps.nowFn
  );
  if (!session) {
    return jsonNoStore({ ok: false, error: "Authentication required." }, 401);
  }

  const wizard = await getWizardStateForUser(deps.db, session.user.id, projectId);
  if (!wizard) {
    return jsonNoStore({ ok: false, error: "Project not found." }, 404);
  }

  const [chapter] = await deps.db
    .select()
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, projectId)))
    .limit(1);

  if (!chapter) {
    return jsonNoStore({ ok: false, error: "Chapter not found." }, 404);
  }
  if (chapter.isAutoReferences) {
    return jsonNoStore({ ok: false, error: "References chapter cannot be edited manually." }, 409);
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
  }

  const parsed = SaveLightEditSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonNoStore(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Check your edits and try again." },
      400
    );
  }

  const now = (deps.nowFn ?? (() => new Date()))();
  const [latest] = await deps.db
    .select()
    .from(chapterVersions)
    .where(eq(chapterVersions.chapterId, chapter.id))
    .orderBy(desc(chapterVersions.version))
    .limit(1);

  const nextVersion = (latest?.version ?? 0) + 1;
  const versionId = `ver_${crypto.randomUUID()}`;
  const contentR2Key = `chapters/${projectId}/${chapter.id}/v${nextVersion}.md`;
  const wordCount = countWords(parsed.data.markdown);
  const wpp = calculateWordsPerPage(wizard.settings.lineSpacing, wizard.settings.fontSizePt);
  const pageCount = Math.max(1, Math.round(wordCount / wpp));

  await deps.bucket.put(contentR2Key, parsed.data.markdown, {
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    customMetadata: {
      projectId,
      chapterId: chapter.id,
      version: String(nextVersion),
      createdBy: "user",
    },
  });

  await deps.db.insert(chapterVersions).values({
    id: versionId,
    chapterId: chapter.id,
    version: nextVersion,
    contentR2Key,
    wordCount,
    pageCount,
    promptVersion: "user-edit",
    createdBy: "user",
    revisionNotes: parsed.data.editSummary ?? "Manual author edit",
    createdAt: now,
  });

  const [memory] = await deps.db
    .select()
    .from(projectMemory)
    .where(eq(projectMemory.projectId, projectId))
    .limit(1);

  let summaries: Array<{ chapterNumber: number; title: string; summary: string }> = [];
  if (memory?.chapterSummariesJson) {
    try {
      summaries = JSON.parse(memory.chapterSummariesJson) as typeof summaries;
    } catch {
      summaries = [];
    }
  }

  const plainExcerpt = parsed.data.markdown.replace(/#+\s*/g, "").slice(0, 320).trim();
  const noteSuffix = parsed.data.editSummary ? ` (Author edit: ${parsed.data.editSummary})` : "";
  const updatedSummaries = [
    ...summaries.filter((s) => s.chapterNumber !== chapter.number),
    {
      chapterNumber: chapter.number,
      title: chapter.title,
      summary: `Author-edited Chapter ${chapter.number}: ${plainExcerpt}...${noteSuffix}`,
    },
  ].sort((a, b) => a.chapterNumber - b.chapterNumber);

  await deps.db
    .insert(projectMemory)
    .values({
      projectId,
      outlineJson: memory?.outlineJson ?? "{}",
      outlineLocked: memory?.outlineLocked ?? true,
      chapterSummariesJson: JSON.stringify(updatedSummaries),
      glossaryJson: memory?.glossaryJson ?? "[]",
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: projectMemory.projectId,
      set: {
        chapterSummariesJson: JSON.stringify(updatedSummaries),
        updatedAt: now,
      },
    });

  return jsonNoStore(
    {
      ok: true,
      version: {
        id: versionId,
        version: nextVersion,
        wordCount,
        pageCount,
        createdBy: "user",
      },
    },
    201
  );
}
