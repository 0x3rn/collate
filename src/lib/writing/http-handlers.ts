import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  estimateAssignmentCredits,
  estimateChapterCredits,
  estimateRevisionCredits,
} from "@/config/pricing";
import { WRITING_CONFIG } from "@/config/writing";
import { getProjectForUser } from "@/db/queries/projects";
import { chapters, projectDatasets, projectSettings, questions } from "@/db/schema";
import {
  extractClientIp,
  isAllowedOrigin,
  jsonNoStore,
  readSessionTokenFromRequest,
} from "@/lib/auth/cookies";
import type { HttpAuthDeps } from "@/lib/auth/http-handlers";
import { consumeAuthRateLimit } from "@/lib/auth/rate-limit";
import { getSessionFromToken } from "@/lib/auth/service";
import {
  BillingError,
  checkSpendCircuitBreaker,
  refundChapterReservation,
  reserveChapterCredits,
} from "@/lib/billing/ledger";
import { calculateWordsPerPage } from "@/lib/outline/planner";
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
  const creditsRequired = estimateChapterCredits(target.pageBudget);
  let reservationId: string;

  try {
    const reserved = await reserveChapterCredits(deps.db, {
      userId: auth.session.user.id,
      projectId: auth.project.id,
      chapterId: target.id,
      credits: creditsRequired,
      idempotencyKey: `chapter:${runId}`,
      note: `Reserved ${creditsRequired} credits for Chapter ${target.number}: ${target.title}`,
      now,
    });
    reservationId = reserved.reservationId;
  } catch (err) {
    if (err instanceof BillingError) {
      return jsonNoStore(
        {
          ok: false,
          code: err.code,
          creditsRequired,
          error: `Chapter ${target.number} requires ${creditsRequired} credits. Top up your credit balance on your Account page to continue.`,
        },
        err.status
      );
    }
    throw err;
  }

  const previousStatus = target.status;
  let workflowInstanceId: string | null = null;

  await deps.db
    .update(chapters)
    .set({ status: "queued", startedAt: target.startedAt ?? now, updatedAt: now })
    .where(eq(chapters.id, target.id));

  if (deps.workflowLauncher) {
    try {
      const instance = await deps.workflowLauncher.create({
        params: {
          runId,
          projectId: auth.project.id,
          chapterId: target.id,
          reservationId,
          createdBy: "ai",
          spendCapUsd: WRITING_CONFIG.limits.perChapterSpendCapUsd,
        },
      });
      workflowInstanceId = instance.id;

      await deps.db
        .update(chapters)
        .set({ workflowInstanceId, updatedAt: now })
        .where(eq(chapters.id, target.id));
    } catch {
      await deps.db
        .update(chapters)
        .set({ status: previousStatus, updatedAt: now })
        .where(eq(chapters.id, target.id));
      await refundChapterReservation(
        deps.db,
        reservationId,
        "Chapter workflow failed to start",
        now
      );
      return jsonNoStore(
        {
          ok: false,
          error: "Could not start chapter drafting. Your reserved credits were refunded.",
        },
        500
      );
    }
  }

  return jsonNoStore(
    {
      ok: true,
      alreadyRunning: false,
      chapterId: target.id,
      runId,
      workflowInstanceId,
      creditsReserved: creditsRequired,
      reservationId,
    },
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
  const breaker = await checkSpendCircuitBreaker(deps.db, now);
  if (!breaker.allowed) {
    return jsonNoStore(
      { ok: false, error: breaker.reason ?? "Chapter revisions are temporarily paused." },
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
        error: "Hourly chapter run limit reached. Please wait before requesting another revision.",
      },
      429,
      { "retry-after": String(rl.retryAfterSeconds) }
    );
  }

  const runId = `rev_${crypto.randomUUID()}`;
  const creditsRequired = estimateRevisionCredits(target.pageBudget);
  let reservationId: string;

  try {
    const reserved = await reserveChapterCredits(deps.db, {
      userId: auth.session.user.id,
      projectId: auth.project.id,
      chapterId: target.id,
      credits: creditsRequired,
      idempotencyKey: `revision:${runId}`,
      note: `Reserved ${creditsRequired} credits for Chapter ${target.number} revision`,
      now,
    });
    reservationId = reserved.reservationId;
  } catch (err) {
    if (err instanceof BillingError) {
      return jsonNoStore(
        {
          ok: false,
          code: err.code,
          creditsRequired,
          error: `Revising Chapter ${target.number} requires ${creditsRequired} credits. Top up your credit balance on your Account page to continue.`,
        },
        err.status
      );
    }
    throw err;
  }

  const previousStatus = target.status;
  let workflowInstanceId: string | null = null;

  await deps.db
    .update(chapters)
    .set({ status: "queued", startedAt: now, updatedAt: now })
    .where(eq(chapters.id, target.id));

  if (deps.workflowLauncher) {
    try {
      const instance = await deps.workflowLauncher.create({
        params: {
          mode: target.chapterType === "assignment" ? "assignment" : "chapter",
          runId,
          projectId: auth.project.id,
          chapterId: target.id,
          reservationId,
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
    } catch {
      await deps.db
        .update(chapters)
        .set({ status: previousStatus, updatedAt: now })
        .where(eq(chapters.id, target.id));
      await refundChapterReservation(
        deps.db,
        reservationId,
        "Revision workflow failed to start",
        now
      );
      return jsonNoStore(
        {
          ok: false,
          error: "Could not start chapter revision. Your reserved credits were refunded.",
        },
        500
      );
    }
  }

  return jsonNoStore(
    {
      ok: true,
      chapterId: target.id,
      runId,
      workflowInstanceId,
      creditsReserved: creditsRequired,
      reservationId,
    },
    202
  );
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

export async function handleStartAssignment(
  request: Request,
  projectId: string,
  deps: ChapterHttpDeps
): Promise<Response> {
  const auth = await authenticateAndLoadProject(request, projectId, deps, true);
  if (!auth.ok) return auth.error;

  if (auth.project.type !== "assignment") {
    return jsonNoStore({ ok: false, error: "This endpoint is only for Assignment projects." }, 400);
  }

  const qRows = await deps.db
    .select()
    .from(questions)
    .where(eq(questions.projectId, auth.project.id))
    .orderBy(asc(questions.orderIndex));

  if (qRows.length === 0) {
    return jsonNoStore(
      { ok: false, error: "Add at least one assignment question before starting." },
      400
    );
  }

  const [existingCh] = await deps.db
    .select()
    .from(chapters)
    .where(and(eq(chapters.projectId, auth.project.id), eq(chapters.number, 1)))
    .limit(1);

  if (existingCh && (existingCh.status === "queued" || existingCh.status === "writing")) {
    return jsonNoStore(
      {
        ok: true,
        alreadyRunning: true,
        chapterId: existingCh.id,
        workflowInstanceId: existingCh.workflowInstanceId,
      },
      202
    );
  }

  const now = (deps.nowFn ?? (() => new Date()))();
  const breaker = await checkSpendCircuitBreaker(deps.db, now);
  if (!breaker.allowed) {
    return jsonNoStore(
      { ok: false, error: breaker.reason ?? "Assignment drafting is temporarily paused." },
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
        error: "Hourly drafting limit reached. Please wait before starting another assignment.",
      },
      429,
      { "retry-after": String(rl.retryAfterSeconds) }
    );
  }

  const runId = `asgn_${crypto.randomUUID()}`;
  const creditsRequired = estimateAssignmentCredits(auth.project.targetPages, qRows.length);

  const [settingsRow] = await deps.db
    .select()
    .from(projectSettings)
    .where(eq(projectSettings.projectId, auth.project.id))
    .limit(1);
  const wpp = calculateWordsPerPage(
    settingsRow?.lineSpacing ?? "double",
    settingsRow?.fontSizePt ?? 12
  );
  const targetPages = Math.max(qRows.length * 2, auth.project.targetPages ?? qRows.length * 4);

  let chapterId = existingCh?.id;
  const previousStatus = existingCh?.status ?? "not_started";
  let createdNewChapter = false;

  if (!chapterId) {
    chapterId = `chp_${crypto.randomUUID()}`;
    createdNewChapter = true;
    await deps.db.insert(chapters).values({
      id: chapterId,
      projectId: auth.project.id,
      number: 1,
      title: auth.project.title,
      chapterType: "assignment",
      pageBudget: targetPages,
      wordBudget: targetPages * wpp,
      isAutoReferences: false,
      status: "not_started",
      createdAt: now,
      updatedAt: now,
    });
  }

  let reservationId: string;
  try {
    const reserved = await reserveChapterCredits(deps.db, {
      userId: auth.session.user.id,
      projectId: auth.project.id,
      chapterId,
      credits: creditsRequired,
      idempotencyKey: `assignment:${runId}`,
      note: `Reserved ${creditsRequired} credits for assignment (${qRows.length} question${qRows.length === 1 ? "" : "s"})`,
      now,
    });
    reservationId = reserved.reservationId;
  } catch (err) {
    if (createdNewChapter) {
      await deps.db.delete(chapters).where(eq(chapters.id, chapterId));
    }
    if (err instanceof BillingError) {
      return jsonNoStore(
        {
          ok: false,
          code: err.code,
          creditsRequired,
          error: `Drafting this assignment requires ${creditsRequired} credits. Top up your credit balance on your Account page to continue.`,
        },
        err.status
      );
    }
    throw err;
  }

  await deps.db
    .update(chapters)
    .set({ status: "queued", startedAt: existingCh?.startedAt ?? now, updatedAt: now })
    .where(eq(chapters.id, chapterId));

  let workflowInstanceId: string | null = null;
  if (deps.workflowLauncher) {
    try {
      const instance = await deps.workflowLauncher.create({
        params: {
          mode: "assignment",
          runId,
          projectId: auth.project.id,
          chapterId,
          reservationId,
          createdBy: "ai",
          spendCapUsd: WRITING_CONFIG.limits.perChapterSpendCapUsd,
        },
      });
      workflowInstanceId = instance.id;

      await deps.db
        .update(chapters)
        .set({ workflowInstanceId, updatedAt: now })
        .where(eq(chapters.id, chapterId));
    } catch {
      await deps.db
        .update(chapters)
        .set({ status: previousStatus, updatedAt: now })
        .where(eq(chapters.id, chapterId));
      await refundChapterReservation(
        deps.db,
        reservationId,
        "Assignment workflow failed to start",
        now
      );
      return jsonNoStore(
        {
          ok: false,
          error: "Could not start assignment drafting. Your reserved credits were refunded.",
        },
        500
      );
    }
  }

  return jsonNoStore(
    {
      ok: true,
      alreadyRunning: false,
      chapterId,
      runId,
      workflowInstanceId,
      creditsReserved: creditsRequired,
      reservationId,
    },
    202
  );
}
