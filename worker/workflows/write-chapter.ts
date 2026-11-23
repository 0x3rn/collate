import { eq } from "drizzle-orm";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createDb } from "@/db/client";
import { projects, users } from "@/db/schema";
import type { AIGatewayEnv } from "@/lib/ai/call-llm";
import { createEmailSender } from "@/lib/email/mailer";
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
      RESEND_API_KEY: runtimeEnv.RESEND_API_KEY as string | undefined,
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
          }),
        });
      },
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
          loadContext: (fn) => step.do("load-assignment-context", fn),
          draftQuestion: (idx, fn) => step.do(`draft-question-${idx}`, fn),
          assembleAndFinalize: (fn) => step.do("assemble-assignment", fn),
        }
      );
    }

    return runWriteChapterOrchestration(
      event.payload,
      {
        loadContext: (fn) => step.do("load-context", fn),
        draftSection: (idx, fn) => step.do(`draft-section-${idx}`, fn),
        assembleAndFinalize: (fn) => step.do("assemble-and-finalize", fn),
      },
      sharedDeps
    );
  }
}
