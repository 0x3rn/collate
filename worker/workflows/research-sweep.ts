import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { createDb } from "@/db/client";
import { hasConfiguredLlmProvider, type AIGatewayEnv } from "@/lib/ai/call-llm";
import { LLMError } from "@/lib/ai/errors";
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
    const llmEnv = runtimeEnv as unknown as AIGatewayEnv;
    const llmReady = hasConfiguredLlmProvider(llmEnv);

    const aiBinding = runtimeEnv.AI as WorkersAiBinding | undefined;
    const vectorizeBinding = runtimeEnv.VECTORIZE as CloudflareVectorizeBinding | undefined;

    const stepRetryConfig = {
      retries: {
        limit: 1,
        delay: "15 seconds" as const,
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
        if (/not found|reached spend cap/i.test(msg)) {
          throw new NonRetryableError(msg);
        }
        throw err;
      }
    };

    return runResearchSweepOrchestration(
      event.payload,
      {
        planQueries: (fn) => step.do("plan-queries", stepRetryConfig, () => guardStep(fn)),
        searchAndDedupe: (fn) => step.do("search-and-dedupe", stepRetryConfig, () => guardStep(fn)),
        fetchBatch: (idx, fn) =>
          step.do(`fetch-batch-${idx}`, stepRetryConfig, () => guardStep(fn)),
        scoreAndFinalize: (fn) =>
          step.do("score-and-finalize", stepRetryConfig, () => guardStep(fn)),
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
        llmCtx: llmReady ? { db, env: llmEnv } : undefined,
        embedder: aiBinding ? createWorkersAiEmbedder(aiBinding) : undefined,
        vectorStore: vectorizeBinding ? createVectorizeStore(vectorizeBinding) : undefined,
        citationFetchFn: globalThis.fetch,
      }
    );
  }
}
