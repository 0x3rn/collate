import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { WRITING_CONFIG } from "@/config/writing";
import { getProjectForUser } from "@/db/queries/projects";
import { chapters, projectDatasets } from "@/db/schema";
import { isAllowedOrigin, jsonNoStore, readSessionTokenFromRequest } from "@/lib/auth/cookies";
import type { HttpAuthDeps } from "@/lib/auth/http-handlers";
import { extractClientIp } from "@/lib/auth/cookies";
import { consumeAuthRateLimit } from "@/lib/auth/rate-limit";
import { getSessionFromToken } from "@/lib/auth/service";
import { checkSpendCircuitBreaker } from "@/lib/billing/ledger";
import type { R2WritableBucket } from "@/lib/pdf/render-pdf";
import type { WriteChapterPayload } from "./chapter-orchestrator";
import { analyzeCsvDataset } from "./results-data";
import { canStartChapter } from "./state-machine";

export interface ChapterWorkflowLauncher {
  create(options: { id?: string; params: WriteChapterPayload }): Promise<{ id: string }>;
}

export interface ChapterHttpDeps extends HttpAuthDeps {
  workflowLauncher?: ChapterWorkflowLauncher;
  bucket?: R2WritableBucket;
}

async function authenticateAndLoadProject(
  request: Request,
  projectId: string,
  deps: ChapterHttpDeps,
  requireCsrf: boolean
): Promise<
  | { ok: false; error: Response }
  | {
      ok: true;
      session: NonNullable<Awaited<ReturnType<typeof getSessionFromToken>>>;
      project: NonNullable<Awaited<ReturnType<typeof getProjectForUser>>>;
    }
> {
  if (requireCsrf && !isAllowedOrigin(request, deps.appUrl)) {
    return {
      ok: false,
      error: jsonNoStore({ ok: false, error: "Forbidden cross-origin request." }, 403),
    };
  }
  const isProd = deps.appEnv === "prod";
  const session = await getSessionFromToken(
    deps.db,
    readSessionTokenFromRequest(request, isProd),
    deps.nowFn
  );
  if (!session) {
    return {
      ok: false,
      error: jsonNoStore({ ok: false, error: "Authentication required." }, 401),
    };
  }
  const project = await getProjectForUser(deps.db, session.user.id, projectId);
  if (!project) {
    return { ok: false, error: jsonNoStore({ ok: false, error: "Project not found." }, 404) };
  }
  return { ok: true, session, project };
}

export async function handleStartChapter(
  request: Request,
  projectId: string,
  chapterId: string,
  deps: ChapterHttpDeps
): Promise<Response> {
  const auth = await authenticateAndLoadProject(request, projectId, deps, true);
  if (!auth.ok) return auth.error;

  const allChapters = await deps.db
    .select()
    .from(chapters)
    .where(eq(chapters.projectId, auth.project.id))
    .orderBy(asc(chapters.number));

  const target = allChapters.find((c) => c.id === chapterId);
  if (!target) {
    return jsonNoStore({ ok: false, error: "Chapter not found." }, 404);
  }

  if (target.status === "queued" || target.status === "writing") {
    return jsonNoStore(
      {
        ok: true,
        alreadyRunning: true,
        chapterId: target.id,
        workflowInstanceId: target.workflowInstanceId,
      },
      202
    );
  }

  const gate = canStartChapter(
    allChapters.map((c) => ({
      number: c.number,
      title: c.title,
      status: c.status,
      isAutoReferences: c.isAutoReferences,
    })),
    target.number
  );

  if (!gate.allowed) {
    return jsonNoStore({ ok: false, error: gate.reason ?? "Chapter cannot be started yet." }, 409);
  }

  const now = (deps.nowFn ?? (() => new Date()))();
  const breaker = await checkSpendCircuitBreaker(deps.db, now);
  if (!breaker.allowed) {
    return jsonNoStore(
      { ok: false, error: breaker.reason ?? "Chapter writing is temporarily paused." },
      503
    );
  }

  const rl = await consumeAuthRateLimit(
    deps.db,
    "chapterStart",
    `${auth.session.user.id}:${extractClientIp(request)}`,
    now.getTime()
  );
  if (!rl.allowed) {
    return jsonNoStore(
      {
        ok: false,
        error: "Hourly chapter start limit reached. Please wait before starting another.",
      },
      429,
      { "retry-after": String(rl.retryAfterSeconds) }
    );
  }
  const runId = `crun_${crypto.randomUUID()}`;
  let workflowInstanceId: string | null = null;

  await deps.db
    .update(chapters)
    .set({ status: "queued", startedAt: target.startedAt ?? now, updatedAt: now })
    .where(eq(chapters.id, target.id));

  if (deps.workflowLauncher) {
    const instance = await deps.workflowLauncher.create({
      params: {
        runId,
        projectId: auth.project.id,
        chapterId: target.id,
        createdBy: "ai",
        spendCapUsd: WRITING_CONFIG.limits.perChapterSpendCapUsd,
      },
    });
    workflowInstanceId = instance.id;

    await deps.db
      .update(chapters)
      .set({ workflowInstanceId, updatedAt: now })
      .where(eq(chapters.id, target.id));
  }

  return jsonNoStore(
    { ok: true, alreadyRunning: false, chapterId: target.id, runId, workflowInstanceId },
    202
  );
}

export async function handleApproveChapter(
  request: Request,
  projectId: string,
  chapterId: string,
  deps: ChapterHttpDeps
): Promise<Response> {
  const auth = await authenticateAndLoadProject(request, projectId, deps, true);
  if (!auth.ok) return auth.error;

  const [target] = await deps.db
    .select()
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, auth.project.id)))
    .limit(1);

  if (!target) {
    return jsonNoStore({ ok: false, error: "Chapter not found." }, 404);
  }

  if (target.status === "approved") {
    return jsonNoStore({ ok: true, chapterId: target.id, status: "approved" }, 200);
  }

  if (target.status !== "ready") {
    return jsonNoStore({ ok: false, error: "Only a ready chapter can be approved." }, 409);
  }

  const now = (deps.nowFn ?? (() => new Date()))();
  await deps.db
    .update(chapters)
    .set({ status: "approved", updatedAt: now })
    .where(eq(chapters.id, target.id));

  return jsonNoStore({ ok: true, chapterId: target.id, status: "approved" }, 200);
}

const ReviseBodySchema = z.object({
  instructions: z
    .string()
    .trim()
    .min(10, "Describe the requested changes in at least 10 characters.")
    .max(2000, "Keep revision instructions under 2000 characters."),
});

export async function handleRequestChapterChanges(
  request: Request,
  projectId: string,
  chapterId: string,
  deps: ChapterHttpDeps
): Promise<Response> {
  const auth = await authenticateAndLoadProject(request, projectId, deps, true);
  if (!auth.ok) return auth.error;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
  }

  const parsed = ReviseBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonNoStore(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Provide clear revision notes." },
      400
    );
  }

  const [target] = await deps.db
    .select()
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), eq(chapters.projectId, auth.project.id)))
    .limit(1);

  if (!target) {
    return jsonNoStore({ ok: false, error: "Chapter not found." }, 404);
  }
  if (target.isAutoReferences) {
    return jsonNoStore({ ok: false, error: "References chapter cannot be revised manually." }, 409);
  }
  if (target.status !== "ready" && target.status !== "approved") {
    return jsonNoStore(
      { ok: false, error: "Changes can only be requested after a chapter finishes drafting." },
      409
    );
  }

  const now = (deps.nowFn ?? (() => new Date()))();
  const runId = `rev_${crypto.randomUUID()}`;
  let workflowInstanceId: string | null = null;

  await deps.db
    .update(chapters)
    .set({ status: "queued", startedAt: now, updatedAt: now })
    .where(eq(chapters.id, target.id));

  if (deps.workflowLauncher) {
    const instance = await deps.workflowLauncher.create({
      params: {
        runId,
        projectId: auth.project.id,
        chapterId: target.id,
        createdBy: "revision",
        revisionNotes: parsed.data.instructions,
        spendCapUsd: WRITING_CONFIG.limits.maxRevisionSpendCapUsd,
      },
    });
    workflowInstanceId = instance.id;

    await deps.db
      .update(chapters)
      .set({ workflowInstanceId, updatedAt: now })
      .where(eq(chapters.id, target.id));
  }

  return jsonNoStore({ ok: true, chapterId: target.id, runId, workflowInstanceId }, 202);
}

const UploadDatasetSchema = z.object({
  filename: z
    .string()
    .trim()
    .min(1, "Filename is required.")
    .max(120)
    .refine((f) => f.toLowerCase().endsWith(".csv"), "Only .csv datasets are currently supported."),
  csvContent: z
    .string()
    .min(5, "CSV content is empty.")
    .max(WRITING_CONFIG.limits.maxCsvBytes, "CSV exceeds the 5 MB upload limit."),
});

export async function handleUploadProjectDataset(
  request: Request,
  projectId: string,
  deps: ChapterHttpDeps
): Promise<Response> {
  const auth = await authenticateAndLoadProject(request, projectId, deps, true);
  if (!auth.ok) return auth.error;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
  }

  const parsed = UploadDatasetSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonNoStore(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid CSV upload." },
      400
    );
  }

  let analysis;
  try {
    analysis = analyzeCsvDataset(parsed.data.csvContent);
  } catch (err) {
    return jsonNoStore(
      { ok: false, error: err instanceof Error ? err.message : "Could not parse CSV dataset." },
      400
    );
  }

  const now = (deps.nowFn ?? (() => new Date()))();
  const datasetId = `dst_${crypto.randomUUID()}`;
  const safeFilename = parsed.data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const r2Key = `datasets/${auth.project.id}/${datasetId}.csv`;

  if (deps.bucket) {
    await deps.bucket.put(r2Key, parsed.data.csvContent, {
      httpMetadata: { contentType: "text/csv; charset=utf-8" },
      customMetadata: { originalFilename: safeFilename },
    });
  }

  await deps.db.insert(projectDatasets).values({
    id: datasetId,
    projectId: auth.project.id,
    filename: safeFilename,
    r2Key,
    rowCount: analysis.rowCount,
    columnsJson: JSON.stringify(analysis.columns.map((c) => c.column)),
    summaryJson: JSON.stringify(analysis),
    createdAt: now,
  });

  return jsonNoStore(
    {
      ok: true,
      dataset: {
        id: datasetId,
        filename: safeFilename,
        rowCount: analysis.rowCount,
        columnCount: analysis.columnCount,
        columns: analysis.columns,
      },
    },
    201
  );
}
