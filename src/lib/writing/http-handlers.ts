import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  estimateAssignmentCredits,
  estimateChapterCredits,
  estimateRevisionCredits,
} from "@/config/pricing";
import { WRITING_CONFIG } from "@/config/writing";
import { getProjectForUser } from "@/db/queries/projects";
import {
  chapters,
  projectDatasets,
  projects,
  projectSettings,
  questions,
  sections,
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
import {
  BillingError,
  checkSpendCircuitBreaker,
  PUBLIC_WRITING_PAUSED_MESSAGE,
  refundChapterReservation,
  reserveChapterCredits,
} from "@/lib/billing/ledger";
import { logEvent } from "@/lib/observability/logger";
import { calculateWordsPerPage } from "@/lib/outline/planner";
import type { R2WritableBucket } from "@/lib/pdf/render-pdf";
import type { WriteChapterPayload } from "./chapter-orchestrator";
import { analyzeCsvDataset } from "./results-data";
import { matchExplicitRevisionTargets } from "./section-revision";
import { canStartChapter } from "./state-machine";

export interface ChapterWorkflowLauncher {
  create(options: { id?: string; params: WriteChapterPayload }): Promise<{ id: string }>;
  get?(id: string): Promise<{ status(): Promise<{ status: string }> }>;
}

const ACTIVE_WORKFLOW_STATUSES = new Set(["queued", "running", "waiting", "waitingForPause"]);

async function isWorkflowInstanceStillActive(
  launcher: ChapterWorkflowLauncher | undefined,
  workflowInstanceId: string | null | undefined
): Promise<boolean> {
  if (!launcher?.get || !workflowInstanceId) return false;
  try {
    const instance = await launcher.get(workflowInstanceId);
    const info = await instance.status();
    return ACTIVE_WORKFLOW_STATUSES.has(info.status);
  } catch {
    return false;
  }
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

const StartChapterBodySchema = z
  .object({
    details: z
      .string()
      .trim()
      .max(2000, "Keep additional details under 2000 characters.")
      .optional(),
  })
  .optional();

export async function handleStartChapter(
  request: Request,
  projectId: string,
  chapterId: string,
  deps: ChapterHttpDeps
): Promise<Response> {
  const auth = await authenticateAndLoadProject(request, projectId, deps, true);
  if (!auth.ok) return auth.error;

  let providedDetails: string | undefined;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const rawText = await request.text();
      if (rawText.trim()) {
        const parsedBody = StartChapterBodySchema.safeParse(JSON.parse(rawText));
        if (!parsedBody.success) {
          return jsonNoStore(
            {
              ok: false,
              error: parsedBody.error.issues[0]?.message ?? "Invalid details provided.",
            },
            400
          );
        }
        providedDetails = parsedBody.data?.details?.trim() || undefined;
      }
    } catch {
      return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
    }
  }

  const allChapters = await deps.db
    .select()
    .from(chapters)
    .where(eq(chapters.projectId, auth.project.id))
    .orderBy(asc(chapters.number));

  const target = allChapters.find((c) => c.id === chapterId);
  if (!target) {
    return jsonNoStore({ ok: false, error: "Chapter not found." }, 404);
  }

  if (
    target.status === "queued" ||
    target.status === "writing" ||
    (await isWorkflowInstanceStillActive(deps.workflowLauncher, target.workflowInstanceId))
  ) {
    if (target.status !== "queued" && target.status !== "writing") {
      await deps.db
        .update(chapters)
        .set({ status: "writing", updatedAt: (deps.nowFn ?? (() => new Date()))() })
        .where(eq(chapters.id, target.id));
    }
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
    logEvent("warn", "circuit_breaker_blocked", {
      projectId: auth.project.id,
      data: {
        action: "start_chapter",
        chapterId: target.id,
        reason: breaker.reason ?? "unknown",
        globalDailySpendUsd: breaker.globalDailySpendUsd,
      },
    });
    return jsonNoStore({ ok: false, error: PUBLIC_WRITING_PAUSED_MESSAGE }, 503);
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
          creditsAvailable: err.availableCredits ?? auth.session.user.creditsBalance,
          error: `Chapter ${target.number} requires ${creditsRequired} credits. Top up your credit balance on Credits & Billing to continue.`,
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
          ...(providedDetails ? { revisionNotes: providedDetails } : {}),
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

  const projectChapters = await deps.db
    .select({ status: chapters.status, isAutoReferences: chapters.isAutoReferences })
    .from(chapters)
    .where(eq(chapters.projectId, auth.project.id));
  const contentChapters = projectChapters.filter((c) => !c.isAutoReferences);
  if (contentChapters.length > 0 && contentChapters.every((c) => c.status === "approved")) {
    await deps.db
      .update(projects)
      .set({ status: "completed", updatedAt: now })
      .where(eq(projects.id, auth.project.id));
  }

  return jsonNoStore({ ok: true, chapterId: target.id, status: "approved" }, 200);
}

const ReviseBodySchema = z.object({
  instructions: z
    .string()
    .trim()
    .min(10, "Describe the requested changes in at least 10 characters.")
    .max(2000, "Keep revision instructions under 2000 characters."),
  targetSectionHeadings: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
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
    logEvent("warn", "circuit_breaker_blocked", {
      projectId: auth.project.id,
      data: {
        action: "revise_chapter",
        chapterId: target.id,
        reason: breaker.reason ?? "unknown",
        globalDailySpendUsd: breaker.globalDailySpendUsd,
      },
    });
    return jsonNoStore({ ok: false, error: PUBLIC_WRITING_PAUSED_MESSAGE }, 503);
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

  if (await isWorkflowInstanceStillActive(deps.workflowLauncher, target.workflowInstanceId)) {
    return jsonNoStore(
      {
        ok: false,
        error:
          "A run for this chapter is already in progress. Wait for it to finish before requesting changes.",
      },
      409
    );
  }

  const chapterSections = await deps.db
    .select({
      id: sections.id,
      orderIndex: sections.orderIndex,
      heading: sections.heading,
    })
    .from(sections)
    .where(eq(sections.chapterId, target.id))
    .orderBy(asc(sections.orderIndex));

  const explicitTargetHeadings =
    parsed.data.targetSectionHeadings && parsed.data.targetSectionHeadings.length > 0
      ? parsed.data.targetSectionHeadings
      : undefined;

  const matchedSelectedIds = explicitTargetHeadings
    ? matchExplicitRevisionTargets({
        chapterNumber: target.number,
        revisionInstructions: parsed.data.instructions,
        sectionPlan: chapterSections.map((s) => ({
          sectionId: s.id,
          orderIndex: s.orderIndex,
          heading: s.heading,
        })),
        explicitTargetHeadings,
      })
    : [];

  const isTargetedSectionRun =
    chapterSections.length > 1 &&
    matchedSelectedIds.length > 0 &&
    matchedSelectedIds.length < chapterSections.length;

  const runId = `rev_${crypto.randomUUID()}`;
  const creditsRequired = estimateRevisionCredits(target.pageBudget, {
    totalSections: chapterSections.length,
    selectedSectionsCount: isTargetedSectionRun ? matchedSelectedIds.length : undefined,
  });
  const revisionSpendCapUsd = isTargetedSectionRun
    ? WRITING_CONFIG.limits.sectionRevisionSpendCapUsd
    : WRITING_CONFIG.limits.maxRevisionSpendCapUsd;
  let reservationId: string;

  try {
    const reserved = await reserveChapterCredits(deps.db, {
      userId: auth.session.user.id,
      projectId: auth.project.id,
      chapterId: target.id,
      credits: creditsRequired,
      idempotencyKey: `revision:${runId}`,
      note: isTargetedSectionRun
        ? `Reserved ${creditsRequired} credit${creditsRequired === 1 ? "" : "s"} for Chapter ${target.number} targeted section revision`
        : `Reserved ${creditsRequired} credits for Chapter ${target.number} revision`,
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
          creditsAvailable: err.availableCredits ?? auth.session.user.creditsBalance,
          error: `Revising Chapter ${target.number} requires ${creditsRequired} credit${creditsRequired === 1 ? "" : "s"}. Top up your credit balance on Credits & Billing to continue.`,
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
          ...(explicitTargetHeadings ? { targetSectionHeadings: explicitTargetHeadings } : {}),
          spendCapUsd: revisionSpendCapUsd,
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
    logEvent("warn", "circuit_breaker_blocked", {
      projectId: auth.project.id,
      data: {
        action: "start_assignment",
        reason: breaker.reason ?? "unknown",
        globalDailySpendUsd: breaker.globalDailySpendUsd,
      },
    });
    return jsonNoStore({ ok: false, error: PUBLIC_WRITING_PAUSED_MESSAGE }, 503);
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
          creditsAvailable: err.availableCredits ?? auth.session.user.creditsBalance,
          error: `Drafting this assignment requires ${creditsRequired} credits. Top up your credit balance on Credits & Billing to continue.`,
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
