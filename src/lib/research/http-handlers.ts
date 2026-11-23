import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { BILLING_POLICY } from "@/config/pricing";
import { RESEARCH_CONFIG } from "@/config/research";
import { getProjectForUser } from "@/db/queries/projects";
import { researchRuns } from "@/db/schema";
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
  countUserNonFailedSweeps,
  refundChapterReservation,
  reserveChapterCredits,
} from "@/lib/billing/ledger";
import { screenTopic } from "@/lib/feasibility/topic-screen";
import { getLatestResearchRunSummary, type ResearchSweepPayload } from "./sweep-orchestrator";

export interface ResearchWorkflowLauncher {
  create(options: { id?: string; params: ResearchSweepPayload }): Promise<{ id: string }>;
}

export interface ResearchHttpDeps extends HttpAuthDeps {
  workflowLauncher?: ResearchWorkflowLauncher;
}

const StartSweepBodySchema = z.object({
  questionId: z.string().trim().min(1).optional(),
  resumeRunId: z.string().trim().min(1).optional(),
});

const ACTIVE_RUN_STATUSES = ["queued", "planning", "searching", "fetching", "scoring"] as const;

export async function handleStartResearchSweep(
  request: Request,
  projectId: string,
  deps: ResearchHttpDeps
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

  const project = await getProjectForUser(deps.db, session.user.id, projectId);
  if (!project) {
    return jsonNoStore({ ok: false, error: "Project not found." }, 404);
  }

  const nowCheck = (deps.nowFn ?? (() => new Date()))();
  const topicScreen = screenTopic(project.title, { supervisorNotes: project.supervisorNotes });
  if (topicScreen.flags.includes("disallowed")) {
    return jsonNoStore(
      { ok: false, error: topicScreen.reasons[0] ?? "This topic is disallowed." },
      400
    );
  }

  const breaker = await checkSpendCircuitBreaker(deps.db, nowCheck);
  if (!breaker.allowed) {
    return jsonNoStore(
      { ok: false, error: breaker.reason ?? "Research sweeps are temporarily paused." },
      503
    );
  }

  const rl = await consumeAuthRateLimit(
    deps.db,
    "researchSweep",
    `${session.user.id}:${extractClientIp(request)}`,
    nowCheck.getTime()
  );
  if (!rl.allowed) {
    return jsonNoStore(
      { ok: false, error: "Hourly research sweep rate limit reached. Please try again later." },
      429,
      { "retry-after": String(rl.retryAfterSeconds) }
    );
  }

  let parsedBody: z.infer<typeof StartSweepBodySchema> = {};
  const rawText = await request.text();
  if (rawText.trim()) {
    try {
      const checked = StartSweepBodySchema.safeParse(JSON.parse(rawText));
      if (!checked.success) {
        return jsonNoStore({ ok: false, error: "Invalid research sweep request." }, 400);
      }
      parsedBody = checked.data;
    } catch {
      return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
    }
  }

  const [activeRun] = await deps.db
    .select()
    .from(researchRuns)
    .where(
      and(
        eq(researchRuns.projectId, project.id),
        inArray(researchRuns.status, [...ACTIVE_RUN_STATUSES])
      )
    )
    .orderBy(desc(researchRuns.startedAt))
    .limit(1);

  if (activeRun) {
    return jsonNoStore(
      {
        ok: true,
        alreadyRunning: true,
        runId: activeRun.id,
        workflowInstanceId: activeRun.workflowInstanceId,
      },
      202
    );
  }

  const now = (deps.nowFn ?? (() => new Date()))();
  let runId = `run_${crypto.randomUUID()}`;
  let resumingFailedRun = false;

  if (parsedBody.resumeRunId) {
    const [failedRun] = await deps.db
      .select()
      .from(researchRuns)
      .where(
        and(eq(researchRuns.id, parsedBody.resumeRunId), eq(researchRuns.projectId, project.id))
      )
      .limit(1);

    if (failedRun) {
      runId = failedRun.id;
      resumingFailedRun = true;
    }
  }

  // Enforce free feasibility sweep quota (3 free sweeps per user; 2 credits per additional sweep)
  const usedSweeps = await countUserNonFailedSweeps(deps.db, session.user.id);
  let reservationId: string | null = null;
  let creditsReserved = 0;

  if (usedSweeps >= BILLING_POLICY.freeFeasibilitySweepsPerUser) {
    const sweepCost = BILLING_POLICY.paidFeasibilitySweepCredits;
    const reserveKey = resumingFailedRun ? `sweep:${runId}:${now.getTime()}` : `sweep:${runId}`;
    try {
      const reserved = await reserveChapterCredits(deps.db, {
        userId: session.user.id,
        projectId: project.id,
        credits: sweepCost,
        idempotencyKey: reserveKey,
        note: `Reserved ${sweepCost} credits for feasibility research sweep`,
        now,
      });
      reservationId = reserved.reservationId;
      creditsReserved = sweepCost;
    } catch (err) {
      if (err instanceof BillingError) {
        return jsonNoStore(
          {
            ok: false,
            code: err.code,
            creditsRequired: sweepCost,
            error: `You have used your ${BILLING_POLICY.freeFeasibilitySweepsPerUser} free topic sweeps. Additional sweeps require ${sweepCost} credits — top up on your Account page.`,
          },
          err.status
        );
      }
      throw err;
    }
  }

  if (resumingFailedRun) {
    await deps.db
      .update(researchRuns)
      .set({ status: "queued", error: null, updatedAt: now })
      .where(eq(researchRuns.id, runId));
  } else {
    await deps.db.insert(researchRuns).values({
      id: runId,
      projectId: project.id,
      questionId: parsedBody.questionId ?? null,
      status: "queued",
      spendCapUsd: RESEARCH_CONFIG.caps.defaultSpendCapUsd,
      startedAt: now,
      updatedAt: now,
    });
  }

  let workflowInstanceId: string | null = null;
  if (deps.workflowLauncher) {
    try {
      const instance = await deps.workflowLauncher.create({
        params: {
          runId,
          projectId: project.id,
          questionId: parsedBody.questionId ?? null,
          reservationId,
          spendCapUsd: RESEARCH_CONFIG.caps.defaultSpendCapUsd,
        },
      });
      workflowInstanceId = instance.id;

      await deps.db
        .update(researchRuns)
        .set({ workflowInstanceId, updatedAt: now })
        .where(eq(researchRuns.id, runId));
    } catch {
      await deps.db
        .update(researchRuns)
        .set({ status: "failed", error: "Could not start research workflow.", updatedAt: now })
        .where(eq(researchRuns.id, runId));
      if (reservationId) {
        await refundChapterReservation(
          deps.db,
          reservationId,
          "Research workflow failed to start",
          now
        );
      }
      return jsonNoStore(
        { ok: false, error: "Could not start the research sweep. Any held credits were refunded." },
        500
      );
    }
  }

  return jsonNoStore(
    {
      ok: true,
      alreadyRunning: false,
      runId,
      workflowInstanceId,
      creditsReserved,
      reservationId,
    },
    202
  );
}

export async function handleGetResearchStatus(
  request: Request,
  projectId: string,
  deps: ResearchHttpDeps
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

  const project = await getProjectForUser(deps.db, session.user.id, projectId);
  if (!project) {
    return jsonNoStore({ ok: false, error: "Project not found." }, 404);
  }

  const summary = await getLatestResearchRunSummary(deps.db, project.id);
  return jsonNoStore({ ok: true, ...summary }, 200);
}
