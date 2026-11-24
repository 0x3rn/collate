import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { loadProjectCitationMap } from "@/db/queries/citations";
import { getWizardStateForUser } from "@/db/queries/wizard";
import {
  chapters,
  chapterVersions,
  EXPORT_FORMATS,
  EXPORT_SCOPES,
  exportsTable,
  projectMemory,
} from "@/db/schema";
import {
  extractClientIp,
  isAllowedOrigin,
  jsonNoStore,
  readSessionTokenFromRequest,
} from "@/lib/auth/cookies";
import type { HttpAuthDeps } from "@/lib/auth/http-handlers";
import { consumeAuthRateLimit } from "@/lib/auth/rate-limit";
import { getSessionFromToken } from "@/lib/auth/service";
import { renderDraftWithCitations } from "@/lib/citations/formatter";
import { logEvent } from "@/lib/observability/logger";
import type { BrowserRunPdfBinding, R2WritableBucket } from "@/lib/pdf/render-pdf";
import { formatProjectType } from "@/lib/ui/formatters";
import { buildThesisDocx } from "./docx-builder";
import { resolveExportFiguresForChapters } from "./figure-assets";
import { buildThesisPdfTwoPass } from "./pdf-assembler";
import { signExportDownloadParams, verifyExportDownloadParams } from "./signed-urls";
import type { ExportChapterContent, ThesisExportDocument } from "./templates";

export interface R2ReadWriteBucket extends R2WritableBucket {
  get(
    key: string
  ): Promise<{ text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> } | null>;
}

export interface ExportHttpDeps extends HttpAuthDeps {
  bucket: R2ReadWriteBucket;
  browser?: BrowserRunPdfBinding;
  signingSecret?: string;
}

const CreateExportSchema = z.object({
  scope: z.enum(EXPORT_SCOPES),
  format: z.enum(EXPORT_FORMATS),
  chapterId: z.string().trim().min(1).optional(),
});

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function resolveSigningSecret(deps: ExportHttpDeps): string | null {
  const configured = deps.signingSecret?.trim();
  if (configured) return configured;
  if (deps.appEnv === "dev") return "collate-local-dev-export-signing-secret";
  return null;
}

function sanitizeDownloadFilename(title: string, suffix: string, ext: "pdf" | "docx"): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "collate-export";
  return `${slug}-${suffix}.${ext}`;
}

export async function handleCreateExport(
  request: Request,
  projectId: string,
  deps: ExportHttpDeps
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

  const signingSecret = resolveSigningSecret(deps);
  if (!signingSecret) {
    return jsonNoStore(
      {
        ok: false,
        error: "Document downloads are temporarily unavailable. Please try again shortly.",
      },
      503
    );
  }

  const now = (deps.nowFn ?? (() => new Date()))();
  const rl = await consumeAuthRateLimit(
    deps.db,
    "exportGenerate",
    `${session.user.id}:${extractClientIp(request)}`,
    now.getTime()
  );
  if (!rl.allowed) {
    return jsonNoStore(
      {
        ok: false,
        error: "Hourly export limit reached. Please wait before generating another file.",
      },
      429,
      { "retry-after": String(rl.retryAfterSeconds) }
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
  }

  const parsed = CreateExportSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonNoStore(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid export request." },
      400
    );
  }

  const { scope, format, chapterId } = parsed.data;
  if (scope === "chapter" && !chapterId) {
    return jsonNoStore(
      { ok: false, error: "chapterId is required for single-chapter exports." },
      400
    );
  }
  if (format === "pdf" && !deps.browser) {
    return jsonNoStore(
      { ok: false, error: "PDF export is temporarily unavailable. Please try again shortly." },
      503
    );
  }

  const wizard = await getWizardStateForUser(deps.db, session.user.id, projectId);
  if (!wizard) {
    return jsonNoStore({ ok: false, error: "Project not found." }, 404);
  }

  const allChapters = await deps.db
    .select()
    .from(chapters)
    .where(eq(chapters.projectId, projectId))
    .orderBy(asc(chapters.number));

  const targetChapters = allChapters.filter((ch) => {
    if (ch.isAutoReferences) return false;
    if (scope === "chapter") return ch.id === chapterId;
    if (scope === "combined") return ch.status === "ready" || ch.status === "approved";
    return true;
  });

  if (targetChapters.length === 0) {
    return jsonNoStore(
      { ok: false, error: "No matching completed chapters are ready to export yet." },
      409
    );
  }

  const citationMap = await loadProjectCitationMap(deps.db, projectId, { excludeRejected: true });
  const exportChapters: ExportChapterContent[] = [];
  const allCombinedRawMarkdown: string[] = [];

  for (const ch of targetChapters) {
    const [latestVer] = await deps.db
      .select()
      .from(chapterVersions)
      .where(eq(chapterVersions.chapterId, ch.id))
      .orderBy(desc(chapterVersions.version))
      .limit(1);

    if (!latestVer) continue;
    const obj = await deps.bucket.get(latestVer.contentR2Key);
    if (!obj) continue;

    const rawMd = await obj.text();
    allCombinedRawMarkdown.push(rawMd);
    const formatted = renderDraftWithCitations({
      draftText: rawMd,
      registry: citationMap,
      style: wizard.settings.citationStyle,
      inlineMode: wizard.settings.inlineMode,
    });
    exportChapters.push({
      number: ch.number,
      title: ch.title,
      markdown: formatted.renderedText,
    });
  }

  if (exportChapters.length === 0) {
    return jsonNoStore(
      { ok: false, error: "Draft chapter content has not been generated yet." },
      409
    );
  }

  const combinedCitations = renderDraftWithCitations({
    draftText: allCombinedRawMarkdown.join("\n\n"),
    registry: citationMap,
    style: wizard.settings.citationStyle,
    inlineMode: wizard.settings.inlineMode,
  });

  const [memory] = await deps.db
    .select()
    .from(projectMemory)
    .where(eq(projectMemory.projectId, projectId))
    .limit(1);

  let abstractText = "";
  if (memory?.chapterSummariesJson) {
    try {
      const summaries = JSON.parse(memory.chapterSummariesJson) as Array<{ summary: string }>;
      abstractText = summaries.map((s) => s.summary).join(" ");
    } catch {
      abstractText = "";
    }
  }

  const resolvedFigures = await resolveExportFiguresForChapters(exportChapters, {
    fetchFn: deps.fetchFn,
  });

  const thesisDoc: ThesisExportDocument = {
    projectTitle: wizard.project.title,
    workTypeLabel: formatProjectType(wizard.project.type),
    level: wizard.project.level,
    abstractText: abstractText || undefined,
    formatting: {
      font: wizard.settings.font,
      fontSizePt: wizard.settings.fontSizePt,
      lineSpacing: wizard.settings.lineSpacing,
      marginsMm: wizard.settings.marginsMm,
      pageNumbering: wizard.settings.pageNumbering,
      frontMatter: wizard.settings.frontMatter,
      cover: wizard.settings.cover,
    },
    chapters: exportChapters,
    bibliographyEntries: combinedCitations.bibliography.map((b) => b.formatted),
    resolvedFigures,
  };

  const includeFrontMatter = scope === "full";
  let bytes: Uint8Array;
  let pageCount: number;
  let contentType: string;

  try {
    if (format === "pdf") {
      const rendered = await buildThesisPdfTwoPass(thesisDoc, deps.browser!, {
        includeFrontMatter,
        includeReferences: true,
      });
      bytes = rendered.pdfBytes;
      pageCount = rendered.totalPageCount;
      contentType = "application/pdf";
    } else {
      bytes = await buildThesisDocx(thesisDoc, {
        includeFrontMatter,
        includeReferences: true,
      });
      pageCount = Math.max(1, exportChapters.length * 2);
      contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }
  } catch (err) {
    logEvent("error", "export.build_failed", {
      projectId,
      data: {
        scope,
        format,
        chapterId: chapterId ?? null,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return jsonNoStore(
      {
        ok: false,
        error: "We couldn't generate your document right now. Please try again in a moment.",
      },
      502
    );
  }

  const exportId = `exp_${crypto.randomUUID()}`;
  const r2Key = `exports/${projectId}/${exportId}.${format}`;
  const sha256 = await sha256Hex(bytes);

  try {
    await deps.bucket.put(r2Key, bytes, {
      httpMetadata: { contentType },
      customMetadata: {
        projectId,
        scope,
        format,
        sha256,
      },
    });
  } catch (err) {
    logEvent("error", "export.storage_failed", {
      projectId,
      data: {
        exportId,
        scope,
        format,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return jsonNoStore(
      {
        ok: false,
        error: "We couldn't save your export file right now. Please try again in a moment.",
      },
      502
    );
  }

  await deps.db.insert(exportsTable).values({
    id: exportId,
    projectId,
    chapterId: scope === "chapter" ? (chapterId ?? null) : null,
    scope,
    format,
    r2Key,
    pageCount,
    sizeBytes: bytes.byteLength,
    sha256,
    createdAt: now,
  });

  const signed = await signExportDownloadParams({
    exportId,
    projectId,
    userId: session.user.id,
    secret: signingSecret,
    nowMs: now.getTime(),
  });

  const downloadUrl = `/api/projects/${projectId}/exports/${exportId}/download?exp=${signed.exp}&sig=${signed.sig}`;

  return jsonNoStore(
    {
      ok: true,
      export: {
        id: exportId,
        scope,
        format,
        pageCount,
        sizeBytes: bytes.byteLength,
        downloadUrl,
      },
    },
    201
  );
}

export async function handleDownloadExport(
  request: Request,
  projectId: string,
  exportId: string,
  deps: ExportHttpDeps
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

  const signingSecret = resolveSigningSecret(deps);
  if (!signingSecret) {
    return jsonNoStore(
      {
        ok: false,
        error: "Document downloads are temporarily unavailable. Please try again shortly.",
      },
      503
    );
  }

  const url = new URL(request.url);
  const exp = Number(url.searchParams.get("exp") ?? "");
  const sig = url.searchParams.get("sig") ?? "";

  const verified = await verifyExportDownloadParams({
    exportId,
    projectId,
    userId: session.user.id,
    exp,
    sig,
    secret: signingSecret,
    nowMs: (deps.nowFn ?? (() => new Date()))().getTime(),
  });
  if (!verified.valid) {
    return jsonNoStore({ ok: false, error: verified.reason ?? "Invalid download link." }, 403);
  }

  const wizard = await getWizardStateForUser(deps.db, session.user.id, projectId);
  if (!wizard) {
    return jsonNoStore({ ok: false, error: "Project not found." }, 404);
  }

  const [expRow] = await deps.db
    .select()
    .from(exportsTable)
    .where(and(eq(exportsTable.id, exportId), eq(exportsTable.projectId, projectId)))
    .limit(1);

  if (!expRow) {
    return jsonNoStore({ ok: false, error: "Export record not found." }, 404);
  }

  const obj = await deps.bucket.get(expRow.r2Key);
  if (!obj) {
    return jsonNoStore({ ok: false, error: "Export file not found in storage." }, 404);
  }

  const fileBytes = await obj.arrayBuffer();
  const contentType =
    expRow.format === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const filename = sanitizeDownloadFilename(wizard.project.title, expRow.scope, expRow.format);

  return new Response(fileBytes, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
