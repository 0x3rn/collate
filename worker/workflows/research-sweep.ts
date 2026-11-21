import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createDb } from "@/db/client";
import type { AIGatewayEnv } from "@/lib/ai/call-llm";
import {
  createVectorizeStore,
  createWorkersAiEmbedder,
  type CloudflareVectorizeBinding,
  type WorkersAiBinding,
} from "@/lib/research/embeddings";
import type { BrowserRunContentBinding } from "@/lib/research/fetcher";
import {
  runResearchSweepOrchestration,
  type ResearchSweepPayload,
  type ScoreStepOutput,
} from "@/lib/research/sweep-orchestrator";

export class ResearchSweepWorkflow extends WorkflowEntrypoint<Env, ResearchSweepPayload> {
  async run(
    event: WorkflowEvent<ResearchSweepPayload>,
    step: WorkflowStep
  ): Promise<ScoreStepOutput> {
    const runtimeEnv = this.env as unknown as Record<string, unknown>;
    const db = createDb(this.env.DB);

    const hasAiGateway =
      Boolean(runtimeEnv.CLOUDFLARE_ACCOUNT_ID) && Boolean(runtimeEnv.CLOUDFLARE_AI_GATEWAY_ID);
    const allowDirectDev =
      runtimeEnv.ALLOW_DIRECT_ANTHROPIC === "true" && Boolean(runtimeEnv.ANTHROPIC_API_KEY);

    const aiBinding = runtimeEnv.AI as WorkersAiBinding | undefined;
    const vectorizeBinding = runtimeEnv.VECTORIZE as CloudflareVectorizeBinding | undefined;

    return runResearchSweepOrchestration(
      event.payload,
      {
        planQueries: (fn) => step.do("plan-queries", fn),
        searchAndDedupe: (fn) => step.do("search-and-dedupe", fn),
        fetchBatch: (idx, fn) => step.do(`fetch-batch-${idx}`, fn),
        scoreAndFinalize: (fn) => step.do("score-and-finalize", fn),
      },
      {
        db,
        bucket: this.env.FILES,
        browser: this.env.BROWSER as unknown as BrowserRunContentBinding,
        connectorEnv: {
          TAVILY_API_KEY: runtimeEnv.TAVILY_API_KEY as string | undefined,
          BRAVE_SEARCH_API_KEY: runtimeEnv.BRAVE_SEARCH_API_KEY as string | undefined,
          SEMANTIC_SCHOLAR_API_KEY: runtimeEnv.SEMANTIC_SCHOLAR_API_KEY as string | undefined,
          CORE_API_KEY: runtimeEnv.CORE_API_KEY as string | undefined,
          SCHOLARLY_CONTACT_EMAIL: runtimeEnv.SCHOLARLY_CONTACT_EMAIL as string | undefined,
        },
        llmCtx:
          hasAiGateway || allowDirectDev
            ? { db, env: runtimeEnv as unknown as AIGatewayEnv }
            : undefined,
        embedder: aiBinding ? createWorkersAiEmbedder(aiBinding) : undefined,
        vectorStore: vectorizeBinding ? createVectorizeStore(vectorizeBinding) : undefined,
      }
    );
  }
}
