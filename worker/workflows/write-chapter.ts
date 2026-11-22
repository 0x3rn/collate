import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createDb } from "@/db/client";
import type { AIGatewayEnv } from "@/lib/ai/call-llm";
import {
  createVectorizeStore,
  createWorkersAiEmbedder,
  type CloudflareVectorizeBinding,
  type WorkersAiBinding,
} from "@/lib/research/embeddings";
import {
  runWriteChapterOrchestration,
  type FinalizeChapterOutput,
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

    return runWriteChapterOrchestration(
      event.payload,
      {
        loadContext: (fn) => step.do("load-context", fn),
        draftSection: (idx, fn) => step.do(`draft-section-${idx}`, fn),
        assembleAndFinalize: (fn) => step.do("assemble-and-finalize", fn),
      },
      {
        db,
        bucket: this.env.FILES,
        llmCtx: { db, env: runtimeEnv as unknown as AIGatewayEnv },
        embedder: aiBinding ? createWorkersAiEmbedder(aiBinding) : undefined,
        vectorStore: vectorizeBinding ? createVectorizeStore(vectorizeBinding) : undefined,
      }
    );
  }
}
