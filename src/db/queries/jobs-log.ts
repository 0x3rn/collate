import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "../client";
import { JOB_STATUSES, jobsLog, type JobLogRecord } from "../schema";

export const RecordJobLogInputSchema = z.object({
  id: z.string().min(1),
  workflowId: z.string().min(1),
  projectId: z.string().min(1).nullable().optional(),
  step: z.string().min(1),
  provider: z.string().min(1).default("anthropic"),
  model: z.string().min(1),
  status: z.enum(JOB_STATUSES),
  tokensIn: z.number().int().nonnegative().default(0),
  tokensOut: z.number().int().nonnegative().default(0),
  costEstimateUsd: z.number().nonnegative().default(0),
  latencyMs: z.number().int().nonnegative().nullable().optional(),
  error: z.string().max(4000).nullable().optional(),
  now: z.date().optional(),
});

export type RecordJobLogInput = z.input<typeof RecordJobLogInputSchema>;

export async function recordJobLog(db: AppDb, rawInput: RecordJobLogInput): Promise<JobLogRecord> {
  const input = RecordJobLogInputSchema.parse(rawInput);
  const [created] = await db
    .insert(jobsLog)
    .values({
      id: input.id,
      workflowId: input.workflowId,
      projectId: input.projectId ?? null,
      step: input.step,
      provider: input.provider,
      model: input.model,
      status: input.status,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      costEstimateUsd: input.costEstimateUsd,
      latencyMs: input.latencyMs ?? null,
      error: input.error ?? null,
      createdAt: input.now ?? new Date(),
    })
    .returning();

  if (!created) {
    throw new Error("Failed to insert jobs_log record");
  }

  return created;
}

export async function listJobLogsByWorkflow(
  db: AppDb,
  workflowId: string
): Promise<JobLogRecord[]> {
  return db
    .select()
    .from(jobsLog)
    .where(eq(jobsLog.workflowId, workflowId))
    .orderBy(desc(jobsLog.createdAt));
}

export async function sumWorkflowCostUsd(db: AppDb, workflowId: string): Promise<number> {
  const rows = await db
    .select({
      total: sql<number>`coalesce(sum(${jobsLog.costEstimateUsd}), 0)`,
    })
    .from(jobsLog)
    .where(eq(jobsLog.workflowId, workflowId));

  return Number(rows[0]?.total ?? 0);
}
