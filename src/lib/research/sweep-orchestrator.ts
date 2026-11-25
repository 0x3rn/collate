import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { RESEARCH_CONFIG } from "@/config/research";
import type { AppDb } from "@/db/client";
import { syncCitationRegistryForProject, verifyProjectCitations } from "@/db/queries/citations";
import {
  feasibilityReports,
  projectFigures,
  projects,
  questions,
  researchRuns,
  sourcePassages,
  sources,
  type FeasibilityVerdict,
} from "@/db/schema";
import type { CallLLMContext } from "@/lib/ai/call-llm";
import { captureChapterReservation, refundChapterReservation } from "@/lib/billing/ledger";
import {
  evaluateAssignmentFeasibility,
  evaluateFeasibility,
  type FeasibilitySourceInput,
} from "@/lib/feasibility/evaluator";
import type { R2WritableBucket } from "@/lib/pdf/render-pdf";
import { chunkSourceText } from "./chunker";
import { runConnectorsForQueries } from "./connectors/registry";
import type { ConnectorEnv, SourceConnector } from "./connectors/types";
import { enrichSourcesWithUnpaywall } from "./connectors/unpaywall";
import { buildTopicImageQuery, searchWikimediaAcademicImages } from "./connectors/wikimedia-images";
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
  reservationId: z.string().min(1).nullable().optional(),
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
  queries: Array<{ query: string; intent: string; subtopic: string; questionId?: string | null }>;
  questionSubtopics?: Record<string, string[]>;
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
  verdict: FeasibilityVerdict;
  feasibilityScore: number;
  idealPages: number;
  requiresPrimaryData: boolean;
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
  citationFetchFn?: typeof fetch;
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

            const rebuiltQuestionSubtopics: Record<string, string[]> = {};
            for (const qItem of prevQueries) {
              if (qItem.questionId) {
                const list = rebuiltQuestionSubtopics[qItem.questionId] ?? [];
                if (!list.includes(qItem.subtopic)) list.push(qItem.subtopic);
                rebuiltQuestionSubtopics[qItem.questionId] = list;
              }
            }

            return {
              topic: targetTopic,
              subtopics: prevSubtopics,
              queries: prevQueries,
              ...(Object.keys(rebuiltQuestionSubtopics).length > 0
                ? { questionSubtopics: rebuiltQuestionSubtopics }
                : {}),
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

      if (project.type === "assignment" && !payload.questionId) {
        const questionRows = await deps.db
          .select()
          .from(questions)
          .where(eq(questions.projectId, payload.projectId))
          .orderBy(asc(questions.orderIndex));

        if (questionRows.length > 0) {
          const allSubtopics: string[] = [];
          const allQueries: PlanStepOutput["queries"] = [];
          const questionSubtopics: Record<string, string[]> = {};
          const perQuestionCap = Math.max(4, Math.floor(40 / questionRows.length));

          for (const q of questionRows) {
            const { plan } = await planResearchQueries(
              {
                workflowId: payload.runId,
                projectId: payload.projectId,
                topic: q.text,
                projectType: "assignment",
                field: project.field,
                level: project.level,
                supervisorNotes: project.supervisorNotes,
                spendCapUsd: payload.spendCapUsd,
              },
              deps.llmCtx
            );
            questionSubtopics[q.id] = plan.subtopics;
            for (const sub of plan.subtopics) {
              if (!allSubtopics.includes(sub)) allSubtopics.push(sub);
            }
            for (const qItem of plan.queries.slice(0, perQuestionCap)) {
              allQueries.push({
                query: qItem.query,
                intent: qItem.intent,
                subtopic: qItem.subtopic,
                questionId: q.id,
              });
            }
          }

          await deps.db
            .update(researchRuns)
            .set({
              status: "searching",
              subtopicsJson: JSON.stringify(allSubtopics),
              queriesJson: JSON.stringify(allQueries),
              updatedAt: nowFn(),
            })
            .where(eq(researchRuns.id, payload.runId));

          return {
            topic: targetTopic,
            subtopics: allSubtopics,
            queries: allQueries,
            questionSubtopics,
            reusedExistingPlan: false,
          };
        }
      }

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

      const questionGroups = new Map<string, PlanStepOutput["queries"]>();
      for (const qItem of planOutput.queries) {
        if (qItem.questionId) {
          const list = questionGroups.get(qItem.questionId) ?? [];
          list.push(qItem);
          questionGroups.set(qItem.questionId, list);
        }
      }

      const searchBuckets: Array<{
        questionId: string | null;
        queries: PlanStepOutput["queries"];
      }> =
        questionGroups.size > 0
          ? Array.from(questionGroups.entries()).map(([qId, qQueries]) => ({
              questionId: qId,
              queries: qQueries,
            }))
          : [{ questionId: payload.questionId ?? null, queries: planOutput.queries }];

      let newlyInsertedCount = 0;
      let totalUnpaywallEnriched = 0;
      const now = nowFn();

      for (const bucket of searchBuckets) {
        const scopedExisting = existingSources.filter(
          (s) => (s.questionId ?? null) === bucket.questionId
        );
        const existingByDoi = new Set(
          scopedExisting.map((s) => s.doi?.toLowerCase()).filter((v): v is string => Boolean(v))
        );
        const existingByUrl = new Set(scopedExisting.map((s) => s.canonicalUrl));
        const existingByTitle = new Set(scopedExisting.map((s) => s.normalizedTitle));

        const fanOut = await runConnectorsForQueries(bucket.queries, {
          connectors: deps.connectors,
          env: deps.connectorEnv,
          maxQueriesPerConnector: searchBuckets.length > 1 ? 4 : 6,
          fetchFn,
          now: nowFn(),
        });

        const deduped = deduplicateSources(fanOut.candidates);
        const unpaywallStats = await enrichSourcesWithUnpaywall(deduped, {
          email: deps.connectorEnv.SCHOLARLY_CONTACT_EMAIL,
          timeoutMs: RESEARCH_CONFIG.caps.perRequestTimeoutMs,
          fetchFn,
        });
        totalUnpaywallEnriched += unpaywallStats.enriched;

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
            questionId: bucket.questionId,
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
      }

      // Opportunistically collect verified open-license figures (Wikimedia Commons) relevant to the topic
      try {
        const topicImgQuery = buildTopicImageQuery(planOutput.topic);
        if (topicImgQuery.length >= 3) {
          const verifiedImages = await searchWikimediaAcademicImages({
            query: topicImgQuery,
            limit: 4,
            timeoutMs: RESEARCH_CONFIG.caps.perRequestTimeoutMs,
            fetchFn,
          });
          for (const img of verifiedImages) {
            await deps.db
              .insert(projectFigures)
              .values({
                id: `fig_${crypto.randomUUID()}`,
                projectId: payload.projectId,
                url: img.url,
                sourcePageUrl: img.sourcePageUrl,
                title: img.title,
                alt: img.alt,
                caption: img.caption,
                attribution: img.attribution,
                license: img.license,
                mimeType: img.mimeType,
                naturalWidth: img.naturalWidth,
                naturalHeight: img.naturalHeight,
                createdAt: now,
              })
              .onConflictDoNothing();
          }
        }
      } catch {
        // Non-fatal: academic image discovery never blocks research sweep completion
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
        unpaywallEnriched: totalUnpaywallEnriched,
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

      const [project] = await deps.db
        .select()
        .from(projects)
        .where(eq(projects.id, payload.projectId))
        .limit(1);
      if (!project) {
        throw new Error(`Project ${payload.projectId} not found during scoring`);
      }

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
          questionId: row.questionId,
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

      const refYear = nowFn().getUTCFullYear();
      const ranked = scoreAndRankSources(
        normalizedForScoring,
        planOutput.topic,
        planOutput.subtopics,
        refYear
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

      const feasibilitySources: FeasibilitySourceInput[] = ranked.map((r) => ({
        url: r.url,
        doi: r.doi,
        title: r.title,
        year: r.year,
        publisher: r.publisher,
        sourceType: r.sourceType,
        credibilityScore: r.credibilityScore,
        relevanceScore: r.relevanceScore,
        accessStatus: r.accessStatus,
        matchedSubtopics: r.matchedSubtopics,
      }));

      const doneAt = nowFn();
      await deps.db
        .delete(feasibilityReports)
        .where(eq(feasibilityReports.projectId, payload.projectId));

      let finalVerdict: FeasibilityVerdict;
      let finalScore: number;
      let finalIdealPages: number;
      let requiresPrimaryData: boolean;

      if (project.type === "assignment") {
        const questionRows = await deps.db
          .select()
          .from(questions)
          .where(eq(questions.projectId, payload.projectId))
          .orderBy(asc(questions.orderIndex));

        if (questionRows.length > 0) {
          const hasPerQuestionTagging = normalizedForScoring.some((n) => n.questionId !== null);
          const perQuestionInputs = [];

          for (const q of questionRows) {
            const qSubtopics = planOutput.questionSubtopics?.[q.id] ?? planOutput.subtopics;
            const qRawSources = hasPerQuestionTagging
              ? normalizedForScoring.filter((n) => n.questionId === q.id)
              : normalizedForScoring;

            const qRanked = scoreAndRankSources(qRawSources, q.text, qSubtopics, refYear);
            for (const item of qRanked) {
              const match = qRawSources.find(
                (n) =>
                  n.canonicalUrl === item.canonicalUrl && n.normalizedTitle === item.normalizedTitle
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

            perQuestionInputs.push({
              questionId: q.id,
              questionText: q.text,
              subtopics: qSubtopics,
              sources: qRanked.map((r) => ({
                url: r.url,
                doi: r.doi,
                title: r.title,
                year: r.year,
                publisher: r.publisher,
                sourceType: r.sourceType,
                credibilityScore: r.credibilityScore,
                relevanceScore: r.relevanceScore,
                accessStatus: r.accessStatus,
                matchedSubtopics: r.matchedSubtopics,
              })),
            });
          }

          const assignmentEval = evaluateAssignmentFeasibility(perQuestionInputs, refYear);

          finalVerdict = assignmentEval.overallVerdict;
          finalIdealPages = assignmentEval.totalIdealPages;
          finalScore = Math.round(
            assignmentEval.perQuestion.reduce((s, q) => s + q.evaluation.score, 0) /
              assignmentEval.perQuestion.length
          );
          requiresPrimaryData = assignmentEval.perQuestion.some(
            (q) => q.evaluation.requiresPrimaryData
          );

          for (const pq of assignmentEval.perQuestion) {
            await deps.db.insert(feasibilityReports).values({
              id: `fsr_${crypto.randomUUID()}`,
              projectId: payload.projectId,
              questionId: pq.questionId,
              verdict: pq.evaluation.verdict,
              score: pq.evaluation.score,
              reasonsJson: JSON.stringify(pq.evaluation.reasons),
              coverageJson: JSON.stringify({
                sourcesFound: pq.evaluation.coverage.totalSources,
                credibleRelevantSources: pq.evaluation.coverage.credibleRelevantSources,
                accessibleSources: pq.evaluation.coverage.accessibleSources,
                distinctDomains: pq.evaluation.coverage.distinctDomains,
                subtopicsCovered: pq.evaluation.coverage.subtopicsCovered,
                totalSubtopics: pq.evaluation.coverage.totalSubtopics,
                recentShare: pq.evaluation.coverage.recentShare,
                subtopicBreakdown: pq.evaluation.coverage.subtopicBreakdown,
                idealPagesReason: assignmentEval.idealPagesReason,
                idealPagesRange: pq.evaluation.idealPagesRange,
                complexityScore: pq.evaluation.complexityScore,
                requiresPrimaryData: pq.evaluation.requiresPrimaryData,
                primaryDataNotice: pq.evaluation.primaryDataNotice,
                suggestedRefinements: pq.evaluation.suggestedRefinements,
              }),
              isMocked: false,
              createdAt: doneAt,
            });
          }
        } else {
          const singleEval = evaluateFeasibility({
            topic: planOutput.topic,
            projectType: "assignment",
            level: project.level,
            supervisorNotes: project.supervisorNotes,
            subtopics: planOutput.subtopics,
            sources: feasibilitySources,
            referenceYear: refYear,
          });
          finalVerdict = singleEval.verdict;
          finalScore = singleEval.score;
          finalIdealPages = singleEval.idealPages;
          requiresPrimaryData = singleEval.requiresPrimaryData;

          await deps.db.insert(feasibilityReports).values({
            id: `fsr_${crypto.randomUUID()}`,
            projectId: payload.projectId,
            questionId: null,
            verdict: singleEval.verdict,
            score: singleEval.score,
            reasonsJson: JSON.stringify(singleEval.reasons),
            coverageJson: JSON.stringify({
              sourcesFound: singleEval.coverage.totalSources,
              credibleRelevantSources: singleEval.coverage.credibleRelevantSources,
              accessibleSources: singleEval.coverage.accessibleSources,
              distinctDomains: singleEval.coverage.distinctDomains,
              subtopicsCovered: singleEval.coverage.subtopicsCovered,
              totalSubtopics: singleEval.coverage.totalSubtopics,
              recentShare: singleEval.coverage.recentShare,
              subtopicBreakdown: singleEval.coverage.subtopicBreakdown,
              idealPagesReason: singleEval.idealPagesReason,
              idealPagesRange: singleEval.idealPagesRange,
              complexityScore: singleEval.complexityScore,
              requiresPrimaryData: singleEval.requiresPrimaryData,
              primaryDataNotice: singleEval.primaryDataNotice,
              suggestedRefinements: singleEval.suggestedRefinements,
            }),
            isMocked: false,
            createdAt: doneAt,
          });
        }
      } else {
        const evalResult = evaluateFeasibility({
          topic: planOutput.topic,
          projectType: project.type,
          level: project.level,
          supervisorNotes: project.supervisorNotes,
          subtopics: planOutput.subtopics,
          sources: feasibilitySources,
          referenceYear: refYear,
        });

        finalVerdict = evalResult.verdict;
        finalScore = evalResult.score;
        finalIdealPages = evalResult.idealPages;
        requiresPrimaryData = evalResult.requiresPrimaryData;

        await deps.db.insert(feasibilityReports).values({
          id: `fsr_${crypto.randomUUID()}`,
          projectId: payload.projectId,
          questionId: null,
          verdict: evalResult.verdict,
          score: evalResult.score,
          reasonsJson: JSON.stringify(evalResult.reasons),
          coverageJson: JSON.stringify({
            sourcesFound: evalResult.coverage.totalSources,
            credibleRelevantSources: evalResult.coverage.credibleRelevantSources,
            accessibleSources: evalResult.coverage.accessibleSources,
            distinctDomains: evalResult.coverage.distinctDomains,
            subtopicsCovered: evalResult.coverage.subtopicsCovered,
            totalSubtopics: evalResult.coverage.totalSubtopics,
            recentShare: evalResult.coverage.recentShare,
            subtopicBreakdown: evalResult.coverage.subtopicBreakdown,
            idealPagesReason: evalResult.idealPagesReason,
            idealPagesRange: evalResult.idealPagesRange,
            complexityScore: evalResult.complexityScore,
            requiresPrimaryData: evalResult.requiresPrimaryData,
            primaryDataNotice: evalResult.primaryDataNotice,
            suggestedRefinements: evalResult.suggestedRefinements,
          }),
          isMocked: false,
          createdAt: doneAt,
        });
      }

      // Enforce NN-1: only feasible topics unlock Step 4 (Page Length)
      await deps.db
        .update(projects)
        .set({
          status: finalVerdict,
          idealPages: finalIdealPages,
          targetPages: project.targetPages ?? finalIdealPages,
          wizardStep: finalVerdict === "feasible" ? Math.max(project.wizardStep, 4) : 3,
          updatedAt: doneAt,
        })
        .where(eq(projects.id, payload.projectId));

      const subtopicsCovered = countCoveredSubtopics(ranked);
      const fetchedSources = stored.filter((s) => s.fetchStatus === "fetched").length;

      // Build citation registry from verified metadata and verify DOIs/URLs (Rule NN-2)
      await syncCitationRegistryForProject(deps.db, payload.projectId, doneAt);
      if (deps.citationFetchFn) {
        await verifyProjectCitations(deps.db, payload.projectId, {
          onlyUnverified: true,
          fetchFn: deps.citationFetchFn,
          contactEmail: deps.connectorEnv.SCHOLARLY_CONTACT_EMAIL,
          now: doneAt,
        });
      }

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

      if (payload.reservationId) {
        try {
          await captureChapterReservation(deps.db, payload.reservationId, doneAt);
        } catch {
          // Non-fatal if reservation was already settled
        }
      }

      return {
        runId: payload.runId,
        projectId: payload.projectId,
        totalSources: stored.length,
        fetchedSources,
        subtopicsCovered,
        verdict: finalVerdict,
        feasibilityScore: finalScore,
        idealPages: finalIdealPages,
        requiresPrimaryData,
        status: "completed",
      };
    });
  } catch (err) {
    const failedAt = nowFn();
    const message = err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000);
    await deps.db
      .update(researchRuns)
      .set({
        status: "failed",
        error: message,
        updatedAt: failedAt,
      })
      .where(eq(researchRuns.id, payload.runId));

    if (payload.reservationId) {
      try {
        await refundChapterReservation(
          deps.db,
          payload.reservationId,
          "Research sweep failed before completion",
          failedAt
        );
      } catch {
        // Preserve original sweep error
      }
    }
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

  // Only run progress is returned. The retrieved sources themselves stay server-side so the
  // research gathered for a project is never handed to the browser.
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
  };
}

export type { QueryPlan };
