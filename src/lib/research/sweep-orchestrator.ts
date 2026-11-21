import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { RESEARCH_CONFIG } from "@/config/research";
import type { AppDb } from "@/db/client";
import { projects, questions, researchRuns, sourcePassages, sources } from "@/db/schema";
import type { CallLLMContext } from "@/lib/ai/call-llm";
import type { R2WritableBucket } from "@/lib/pdf/render-pdf";
import { chunkSourceText } from "./chunker";
import { runConnectorsForQueries } from "./connectors/registry";
import type { ConnectorEnv, SourceConnector } from "./connectors/types";
import { enrichSourcesWithUnpaywall } from "./connectors/unpaywall";
import { deduplicateSources } from "./dedupe";
import { buildPassageVectorId, type EmbeddingProvider, type VectorStore } from "./embeddings";
import { fetchAndSnapshotSource, type BrowserRunContentBinding } from "./fetcher";
import { planResearchQueries, type QueryPlan } from "./query-planner";
import { RobotsChecker } from "./robots";
import { countCoveredSubtopics, scoreAndRankSources } from "./scoring";

export const ResearchSweepPayloadSchema = z.object({
  runId: z.string().min(1),
  projectId: z.string().min(1),
  questionId: z.string().min(1).nullable().optional(),
  spendCapUsd: z.number().positive().default(RESEARCH_CONFIG.caps.defaultSpendCapUsd),
  maxSourcesToFetch: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(RESEARCH_CONFIG.caps.maxSourcesToFetchPerRun),
});

export type ResearchSweepPayload = z.input<typeof ResearchSweepPayloadSchema>;

export interface PlanStepOutput {
  topic: string;
  subtopics: string[];
  queries: Array<{ query: string; intent: string; subtopic: string }>;
  reusedExistingPlan: boolean;
}

export interface SearchStepOutput {
  totalProjectSources: number;
  newlyInsertedCount: number;
  pendingFetchCount: number;
  unpaywallEnriched: number;
}

export interface FetchBatchOutput {
  batchIndex: number;
  attempted: number;
  fetched: number;
  passagesCreated: number;
  remainingPending: number;
}

export interface ScoreStepOutput {
  runId: string;
  projectId: string;
  totalSources: number;
  fetchedSources: number;
  subtopicsCovered: number;
  status: "completed";
}

export interface ResearchSweepSteps {
  planQueries(fn: () => Promise<PlanStepOutput>): Promise<PlanStepOutput>;
  searchAndDedupe(fn: () => Promise<SearchStepOutput>): Promise<SearchStepOutput>;
  fetchBatch(batchIndex: number, fn: () => Promise<FetchBatchOutput>): Promise<FetchBatchOutput>;
  scoreAndFinalize(fn: () => Promise<ScoreStepOutput>): Promise<ScoreStepOutput>;
}

export interface ResearchSweepDeps {
  db: AppDb;
  bucket: R2WritableBucket;
  connectorEnv: ConnectorEnv;
  llmCtx?: CallLLMContext;
  connectors?: SourceConnector[];
  browser?: BrowserRunContentBinding;
  embedder?: EmbeddingProvider;
  vectorStore?: VectorStore;
  fetchFn?: typeof fetch;
  nowFn?: () => Date;
  batchSize?: number;
}

export async function runResearchSweepOrchestration(
  rawPayload: unknown,
  steps: ResearchSweepSteps,
  deps: ResearchSweepDeps
): Promise<ScoreStepOutput> {
  const payload = ResearchSweepPayloadSchema.parse(rawPayload);
  const nowFn = deps.nowFn ?? (() => new Date());
  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const batchSize = deps.batchSize ?? 8;
  const robots = new RobotsChecker();

  try {
    const planOutput = await steps.planQueries(async () => {
      const [project] = await deps.db
        .select()
        .from(projects)
        .where(eq(projects.id, payload.projectId))
        .limit(1);
      if (!project) {
        throw new Error(`Project ${payload.projectId} not found`);
      }

      let targetTopic = project.title;
      if (payload.questionId) {
        const [q] = await deps.db
          .select()
          .from(questions)
          .where(
            and(eq(questions.id, payload.questionId), eq(questions.projectId, payload.projectId))
          )
          .limit(1);
        if (q) targetTopic = q.text;
      }

      const [existingRun] = await deps.db
        .select()
        .from(researchRuns)
        .where(eq(researchRuns.id, payload.runId))
        .limit(1);

      if (existingRun) {
        try {
          const prevSubtopics = JSON.parse(existingRun.subtopicsJson) as string[];
          const prevQueries = JSON.parse(existingRun.queriesJson) as PlanStepOutput["queries"];
          if (prevSubtopics.length > 0 && prevQueries.length >= 5) {
            await deps.db
              .update(researchRuns)
              .set({ status: "searching", error: null, updatedAt: nowFn() })
              .where(eq(researchRuns.id, payload.runId));

            return {
              topic: targetTopic,
              subtopics: prevSubtopics,
              queries: prevQueries,
              reusedExistingPlan: true,
            };
          }
        } catch {
          // Re-plan cleanly if stored JSON is empty/corrupt
        }
      }

      await deps.db
        .update(researchRuns)
        .set({ status: "planning", error: null, updatedAt: nowFn() })
        .where(eq(researchRuns.id, payload.runId));

      await deps.db
        .update(projects)
        .set({ status: "researching", updatedAt: nowFn() })
        .where(eq(projects.id, payload.projectId));

      const { plan } = await planResearchQueries(
        {
          workflowId: payload.runId,
          projectId: payload.projectId,
          topic: targetTopic,
          projectType: project.type,
          field: project.field,
          level: project.level,
          supervisorNotes: project.supervisorNotes,
          spendCapUsd: payload.spendCapUsd,
        },
        deps.llmCtx
      );

      await deps.db
        .update(researchRuns)
        .set({
          status: "searching",
          subtopicsJson: JSON.stringify(plan.subtopics),
          queriesJson: JSON.stringify(plan.queries),
          updatedAt: nowFn(),
        })
        .where(eq(researchRuns.id, payload.runId));

      return {
        topic: targetTopic,
        subtopics: plan.subtopics,
        queries: plan.queries,
        reusedExistingPlan: false,
      };
    });

    const searchOutput = await steps.searchAndDedupe(async () => {
      const existingSources = await deps.db
        .select()
        .from(sources)
        .where(eq(sources.projectId, payload.projectId));

      const existingByDoi = new Set(
        existingSources.map((s) => s.doi?.toLowerCase()).filter((v): v is string => Boolean(v))
      );
      const existingByUrl = new Set(existingSources.map((s) => s.canonicalUrl));
      const existingByTitle = new Set(existingSources.map((s) => s.normalizedTitle));

      const fanOut = await runConnectorsForQueries(planOutput.queries, {
        connectors: deps.connectors,
        env: deps.connectorEnv,
        fetchFn,
        now: nowFn(),
      });

      const deduped = deduplicateSources(fanOut.candidates);
      const unpaywallStats = await enrichSourcesWithUnpaywall(deduped, {
        email: deps.connectorEnv.SCHOLARLY_CONTACT_EMAIL,
        timeoutMs: RESEARCH_CONFIG.caps.perRequestTimeoutMs,
        fetchFn,
      });

      let newlyInsertedCount = 0;
      const now = nowFn();

      for (const candidate of deduped) {
        if (candidate.doi && existingByDoi.has(candidate.doi)) continue;
        if (existingByUrl.has(candidate.canonicalUrl)) continue;
        if (
          candidate.normalizedTitle.length >= 12 &&
          existingByTitle.has(candidate.normalizedTitle)
        ) {
          continue;
        }

        const sourceId = `src_${crypto.randomUUID()}`;
        await deps.db.insert(sources).values({
          id: sourceId,
          projectId: payload.projectId,
          questionId: payload.questionId ?? null,
          researchRunId: payload.runId,
          url: candidate.openAccessPdfUrl ?? candidate.url,
          canonicalUrl: candidate.canonicalUrl,
          doi: candidate.doi,
          title: candidate.title,
          normalizedTitle: candidate.normalizedTitle,
          authorsJson: JSON.stringify(candidate.authors),
          year: candidate.year,
          publisher: candidate.publisher,
          venue: candidate.venue,
          sourceType: candidate.sourceType,
          connectorName: candidate.connectorName,
          citationCount: candidate.citationCount,
          credibilityScore: 0,
          relevanceScore: 0,
          accessStatus: candidate.accessStatus,
          fetchStatus: "pending",
          abstractText: candidate.abstractText,
          snapshotR2Key: null,
          retrievedAt: candidate.retrievedAt,
          createdAt: now,
        });

        if (candidate.doi) existingByDoi.add(candidate.doi);
        existingByUrl.add(candidate.canonicalUrl);
        existingByTitle.add(candidate.normalizedTitle);
        newlyInsertedCount++;
      }

      const allAfter = await deps.db
        .select()
        .from(sources)
        .where(eq(sources.projectId, payload.projectId));

      const pendingCount = allAfter.filter((s) => s.fetchStatus === "pending").length;
      const fetchedSoFar = allAfter.filter((s) => s.fetchStatus === "fetched").length;

      await deps.db
        .update(researchRuns)
        .set({
          status: "fetching",
          sourcesFound: allAfter.length,
          sourcesFetched: fetchedSoFar,
          updatedAt: nowFn(),
        })
        .where(eq(researchRuns.id, payload.runId));

      return {
        totalProjectSources: allAfter.length,
        newlyInsertedCount,
        pendingFetchCount: pendingCount,
        unpaywallEnriched: unpaywallStats.enriched,
      };
    });

    const totalBatches = Math.min(
      Math.ceil(Math.min(searchOutput.pendingFetchCount, payload.maxSourcesToFetch) / batchSize),
      15
    );

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchResult = await steps.fetchBatch(batchIndex, async () => {
        const pendingRows = await deps.db
          .select()
          .from(sources)
          .where(and(eq(sources.projectId, payload.projectId), eq(sources.fetchStatus, "pending")))
          .limit(batchSize);

        let fetchedInBatch = 0;
        let passagesCreated = 0;

        for (const row of pendingRows) {
          const outcome = await fetchAndSnapshotSource(
            {
              projectId: payload.projectId,
              sourceId: row.id,
              url: row.url,
              existingAbstract: row.abstractText,
            },
            {
              fetchFn,
              bucket: deps.bucket,
              robots,
              browser: deps.browser,
              contactEmail: deps.connectorEnv.SCHOLARLY_CONTACT_EMAIL,
              now: nowFn(),
            }
          );

          await deps.db
            .update(sources)
            .set({
              fetchStatus: outcome.fetchStatus,
              accessStatus: outcome.accessStatus,
              snapshotR2Key: outcome.snapshotR2Key,
              retrievedAt: outcome.retrievedAt,
            })
            .where(eq(sources.id, row.id));

          if (outcome.fetchStatus === "fetched") {
            fetchedInBatch++;
          }

          if (outcome.extractedText) {
            const chunks = chunkSourceText(outcome.extractedText, {
              locationPrefix: outcome.accessStatus === "abstract_only" ? "abstract" : "section",
            });

            let vectors: number[][] | null = null;
            if (deps.embedder && deps.vectorStore && chunks.length > 0) {
              try {
                vectors = await deps.embedder.embed(chunks.map((c) => c.text));
              } catch {
                vectors = null;
              }
            }

            const vectorRecords = [];
            for (let i = 0; i < chunks.length; i++) {
              const chunk = chunks[i]!;
              const vectorId = buildPassageVectorId(row.id, chunk.passageIndex);

              await deps.db
                .insert(sourcePassages)
                .values({
                  id: `psg_${crypto.randomUUID()}`,
                  sourceId: row.id,
                  projectId: payload.projectId,
                  passageIndex: chunk.passageIndex,
                  text: chunk.text,
                  location: chunk.location,
                  tokenCount: chunk.tokenCount,
                  vectorId: vectors ? vectorId : null,
                  createdAt: nowFn(),
                })
                .onConflictDoNothing();

              passagesCreated++;
              if (vectors?.[i]) {
                vectorRecords.push({
                  id: vectorId,
                  values: vectors[i]!,
                  metadata: {
                    projectId: payload.projectId,
                    sourceId: row.id,
                    passageIndex: chunk.passageIndex,
                  },
                });
              }
            }

            if (deps.vectorStore && vectorRecords.length > 0) {
              try {
                await deps.vectorStore.upsert(vectorRecords);
              } catch {
                // D1 passages remain intact even if Vectorize is temporarily unavailable
              }
            }
          }
        }

        const allNow = await deps.db
          .select()
          .from(sources)
          .where(eq(sources.projectId, payload.projectId));

        const fetchedTotal = allNow.filter((s) => s.fetchStatus === "fetched").length;
        const remainingPending = allNow.filter((s) => s.fetchStatus === "pending").length;

        await deps.db
          .update(researchRuns)
          .set({
            sourcesFound: allNow.length,
            sourcesFetched: fetchedTotal,
            updatedAt: nowFn(),
          })
          .where(eq(researchRuns.id, payload.runId));

        return {
          batchIndex,
          attempted: pendingRows.length,
          fetched: fetchedInBatch,
          passagesCreated,
          remainingPending,
        };
      });

      if (batchResult.remainingPending === 0) break;
    }

    return await steps.scoreAndFinalize(async () => {
      await deps.db
        .update(researchRuns)
        .set({ status: "scoring", updatedAt: nowFn() })
        .where(eq(researchRuns.id, payload.runId));

      const stored = await deps.db
        .select()
        .from(sources)
        .where(eq(sources.projectId, payload.projectId));

      const normalizedForScoring = stored.map((row) => {
        let authors: string[];
        try {
          authors = JSON.parse(row.authorsJson) as string[];
        } catch {
          authors = [];
        }
        return {
          id: row.id,
          url: row.url,
          canonicalUrl: row.canonicalUrl,
          doi: row.doi,
          title: row.title,
          normalizedTitle: row.normalizedTitle,
          authors,
          year: row.year,
          publisher: row.publisher,
          venue: row.venue,
          sourceType: row.sourceType,
          connectorName: row.connectorName,
          connectorNames: [row.connectorName],
          citationCount: row.citationCount,
          abstractText: row.abstractText,
          openAccessPdfUrl: null,
          accessStatus: row.accessStatus,
          retrievedAt: row.retrievedAt,
        };
      });

      const ranked = scoreAndRankSources(
        normalizedForScoring,
        planOutput.topic,
        planOutput.subtopics,
        nowFn().getUTCFullYear()
      );

      for (const item of ranked) {
        const match = normalizedForScoring.find(
          (n) => n.canonicalUrl === item.canonicalUrl && n.normalizedTitle === item.normalizedTitle
        );
        if (!match) continue;
        await deps.db
          .update(sources)
          .set({
            credibilityScore: item.credibilityScore,
            relevanceScore: item.relevanceScore,
          })
          .where(eq(sources.id, match.id));
      }

      const subtopicsCovered = countCoveredSubtopics(ranked);
      const fetchedSources = stored.filter((s) => s.fetchStatus === "fetched").length;
      const doneAt = nowFn();

      await deps.db
        .update(researchRuns)
        .set({
          status: "completed",
          sourcesFound: stored.length,
          sourcesFetched: fetchedSources,
          subtopicsCovered,
          finishedAt: doneAt,
          updatedAt: doneAt,
        })
        .where(eq(researchRuns.id, payload.runId));

      return {
        runId: payload.runId,
        projectId: payload.projectId,
        totalSources: stored.length,
        fetchedSources,
        subtopicsCovered,
        status: "completed",
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000);
    await deps.db
      .update(researchRuns)
      .set({
        status: "failed",
        error: message,
        updatedAt: nowFn(),
      })
      .where(eq(researchRuns.id, payload.runId));
    throw err;
  }
}

export async function getLatestResearchRunSummary(db: AppDb, projectId: string) {
  const [run] = await db
    .select()
    .from(researchRuns)
    .where(eq(researchRuns.projectId, projectId))
    .orderBy(desc(researchRuns.startedAt))
    .limit(1);

  const projectSources = await db
    .select()
    .from(sources)
    .where(eq(sources.projectId, projectId))
    .orderBy(desc(sources.credibilityScore), desc(sources.relevanceScore))
    .limit(15);

  let subtopics: string[] = [];
  if (run) {
    try {
      subtopics = JSON.parse(run.subtopicsJson) as string[];
    } catch {
      subtopics = [];
    }
  }

  return {
    run: run
      ? {
          id: run.id,
          status: run.status,
          workflowInstanceId: run.workflowInstanceId,
          sourcesFound: run.sourcesFound,
          sourcesFetched: run.sourcesFetched,
          subtopicsCovered: run.subtopicsCovered,
          totalSubtopics: subtopics.length,
          error: run.error,
          startedAt: run.startedAt.toISOString(),
          finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
        }
      : null,
    topSources: projectSources.map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      doi: s.doi,
      year: s.year,
      venue: s.venue,
      sourceType: s.sourceType,
      connectorName: s.connectorName,
      credibilityScore: s.credibilityScore,
      relevanceScore: s.relevanceScore,
      accessStatus: s.accessStatus,
      retrievedAt: s.retrievedAt.toISOString(),
    })),
  };
}

export type { QueryPlan };
