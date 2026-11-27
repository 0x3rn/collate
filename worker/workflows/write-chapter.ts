import { eq } from "drizzle-orm";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { createDb } from "@/db/client";
import { projects, projectSettings, users } from "@/db/schema";
import { formatProjectType } from "@/lib/ui/formatters";
import type { AIGatewayEnv } from "@/lib/ai/call-llm";
import { LLMError } from "@/lib/ai/errors";
import { type CloudflareEmailBinding, createEmailSender } from "@/lib/email/mailer";
import {
  buildChapterNeedsAttentionEmail,
  buildChapterReadyEmail,
  buildProjectCompleteEmail,
  dispatchUserNotification,
} from "@/lib/email/notifications";
import type { BrowserRunPdfBinding } from "@/lib/pdf/render-pdf";
import {
  createVectorizeStore,
  createWorkersAiEmbedder,
  type CloudflareVectorizeBinding,
  type WorkersAiBinding,
} from "@/lib/research/embeddings";
import {
  runWriteAssignmentOrchestration,
  runWriteChapterOrchestration,
  type FinalizeChapterOutput,
  type WriteChapterDeps,
  type WriteChapterPayload,
} from "@/lib/writing/chapter-orchestrator";

export class WriteChapterWorkflow extends WorkflowEntrypoint<Env, WriteChapterPayload> {
  async run(
    event: WorkflowEvent<WriteChapterPayload>,
    step: WorkflowStep
  ): Promise<FinalizeChapterOutput> {
    const runtimeEnv = this.env as unknown as Record<string, unknown>;
    const db = createDb(this.env.DB);
    const aiBinding = runtimeEnv.AI as WorkersAiBinding | undefined;
    const vectorizeBinding = runtimeEnv.VECTORIZE as CloudflareVectorizeBinding | undefined;

    let appUrl = (runtimeEnv.APP_URL as string | undefined)?.trim() || "https://collate.app";
    while (appUrl.endsWith("/")) {
      appUrl = appUrl.slice(0, -1);
    }

    const mailer = createEmailSender({
      EMAIL_PROVIDER: runtimeEnv.EMAIL_PROVIDER as string | undefined,
      EMAIL_FROM: runtimeEnv.EMAIL_FROM as string | undefined,
      EMAIL_REPLY_TO: runtimeEnv.EMAIL_REPLY_TO as string | undefined,
      APP_URL: appUrl,
      binding: (runtimeEnv.EMAIL as CloudflareEmailBinding | undefined) ?? null,
    });

    const sharedDeps: WriteChapterDeps = {
      db,
      bucket: this.env.FILES,
      llmCtx: { db, env: runtimeEnv as unknown as AIGatewayEnv },
      embedder: aiBinding ? createWorkersAiEmbedder(aiBinding) : undefined,
      vectorStore: vectorizeBinding ? createVectorizeStore(vectorizeBinding) : undefined,
      citationFetchFn: globalThis.fetch,
      contactEmail: runtimeEnv.SCHOLARLY_CONTACT_EMAIL as string | undefined,
      browser: this.env.BROWSER as unknown as BrowserRunPdfBinding,
      onChapterReady: async (info) => {
        const [proj] = await db
          .select()
          .from(projects)
          .where(eq(projects.id, info.projectId))
          .limit(1);
        if (!proj) return;
        const [usr] = await db.select().from(users).where(eq(users.id, proj.userId)).limit(1);
        if (!usr) return;
        const [settingsRow] = await db
          .select({ useChapters: projectSettings.useChapters })
          .from(projectSettings)
          .where(eq(projectSettings.projectId, proj.id))
          .limit(1);
        const useChapters = settingsRow?.useChapters ?? true;

        await dispatchUserNotification(db, mailer, {
          userId: usr.id,
          kind: "chapter_ready",
          message: buildChapterReadyEmail({
            name: usr.name,
            projectTitle: proj.title,
            chapterNumber: info.chapterNumber,
            chapterTitle: info.chapterTitle,
            chapterUrl: `${appUrl}/projects/${proj.id}/chapters/${info.chapterId}`,
            wordCount: info.wordCount,
            pageCount: info.pageCount,
            useChapters,
          }),
        });

        if (info.allChaptersComplete) {
          await dispatchUserNotification(db, mailer, {
            userId: usr.id,
            kind: "project_complete",
            message: buildProjectCompleteEmail({
              name: usr.name,
              projectTitle: proj.title,
              projectUrl: `${appUrl}/projects/${proj.id}`,
              workTypeLabel: formatProjectType(proj.type),
              useChapters,
            }),
          });
        }
      },
      onNeedsAttention: async (info) => {
        const [proj] = await db
          .select()
          .from(projects)
          .where(eq(projects.id, info.projectId))
          .limit(1);
        if (!proj) return;
        const [usr] = await db.select().from(users).where(eq(users.id, proj.userId)).limit(1);
        if (!usr) return;
        const [settingsRow] = await db
          .select({ useChapters: projectSettings.useChapters })
          .from(projectSettings)
          .where(eq(projectSettings.projectId, proj.id))
          .limit(1);

        await dispatchUserNotification(db, mailer, {
          userId: usr.id,
          kind: "needs_attention",
          message: buildChapterNeedsAttentionEmail({
            name: usr.name,
            projectTitle: proj.title,
            chapterNumber: info.chapterNumber,
            chapterTitle: info.chapterTitle,
            projectUrl: `${appUrl}/projects/${proj.id}`,
            reason: info.reason,
            kind: info.kind,
            useChapters: settingsRow?.useChapters ?? true,
          }),
        });
      },
    };

    // Cap workflow retries strictly at 1 retry (2 total attempts) so transient blips recover
    // without looping, and convert non-retryable errors (spend cap, auth, config, validation)
    // into Cloudflare NonRetryableError so they halt immediately on attempt 1.
    const llmStepRetryConfig = {
      retries: {
        limit: 1,
        delay: "20 seconds" as const,
        backoff: "exponential" as const,
      },
    };

    const guardStep = async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof NonRetryableError) {
          throw err;
        }
        if (err instanceof LLMError && !err.retryable) {
          throw new NonRetryableError(err.message);
        }
        const msg = err instanceof Error ? err.message : String(err ?? "");
        if (
          /not found|24-hour execution ceiling|generated by the citation engine|has no questions|reached spend cap/i.test(
            msg
          )
        ) {
          throw new NonRetryableError(msg);
        }
        throw err;
      }
    };

    if (event.payload.mode === "assignment") {
      return runWriteAssignmentOrchestration(
        {
          runId: event.payload.runId,
          projectId: event.payload.projectId,
          chapterId: event.payload.chapterId,
          reservationId: event.payload.reservationId,
          createdBy: event.payload.createdBy,
          revisionNotes: event.payload.revisionNotes,
          spendCapUsd: event.payload.spendCapUsd,
        },
        sharedDeps,
        {
          loadContext: (fn) =>
            step.do("load-assignment-context", llmStepRetryConfig, () => guardStep(fn)),
          draftQuestion: (idx, fn) =>
            step.do(`draft-question-${idx}`, llmStepRetryConfig, () => guardStep(fn)),
          assembleAndFinalize: (fn) =>
            step.do("assemble-assignment", llmStepRetryConfig, () => guardStep(fn)),
          notifyNeedsAttention: (fn) => step.do("notify-assignment-needs-attention", fn),
        }
      );
    }

    return runWriteChapterOrchestration(
      event.payload,
      {
        loadContext: (fn) => step.do("load-context", llmStepRetryConfig, () => guardStep(fn)),
        draftSection: (idx, fn) =>
          step.do(`draft-section-${idx}`, llmStepRetryConfig, () => guardStep(fn)),
        assembleAndFinalize: (fn) =>
          step.do("assemble-and-finalize", llmStepRetryConfig, () => guardStep(fn)),
        notifyNeedsAttention: (fn) => step.do("notify-needs-attention", fn),
      },
      sharedDeps
    );
  }
}
