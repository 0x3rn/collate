import { and, asc, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { WRITING_CONFIG } from "@/config/writing";
import type { AppDb } from "@/db/client";
import { syncCitationRegistryForProject, verifyProjectCitations } from "@/db/queries/citations";
import {
  chapterFingerprints,
  chapters,
  chapterVersions,
  claims,
  originalityReports,
  projectDatasets,
  projectMemory,
  projects,
  projectSettings,
  questions,
  sectionDrafts,
  sections,
  sourcePassages,
  type ChapterVersionCreator,
  type SpellingVariant,
} from "@/db/schema";
import type { CallLLMContext } from "@/lib/ai/call-llm";
import { captureChapterReservation, refundChapterReservation } from "@/lib/billing/ledger";
import { createBrowserRunPageMeasurer } from "@/lib/export/pdf-assembler";
import type { ExportFormattingSettings } from "@/lib/export/templates";
import { calculateWordsPerPage } from "@/lib/outline/planner";
import type { BrowserRunPdfBinding, R2WritableBucket } from "@/lib/pdf/render-pdf";
import type { EmbeddingProvider, VectorStore } from "@/lib/research/embeddings";
import {
  runOriginalityGateWithRewrite,
  type ExternalPlagiarismProvider,
} from "@/lib/originality/checker";
import { normalizeTitle } from "@/lib/research/dedupe";
import {
  CoverDetailsSchema,
  DEFAULT_COVER_DETAILS,
  DEFAULT_FRONT_MATTER,
  FrontMatterTogglesSchema,
} from "@/lib/wizard/schema";
import {
  buildOriginalityAttention,
  classifyChapterRuntimeError,
  recordChapterNeedsAttentionAudit,
  type ChapterAttentionKind,
} from "./attention";
import { buildLabelledResultsFramework, type DatasetAnalysisResult } from "./results-data";
import { retrieveEvidencePassages, type RetrievedEvidencePassage } from "./retrieval";
import {
  countWords,
  defaultMeasurePages,
  draftAndVerifySection,
  enforceChapterLengthBand,
  summarizeChapterForMemory,
  type MeasurePagesFn,
} from "./section-pipeline";
import { isChapterTimedOut } from "./state-machine";

export const WriteChapterPayloadSchema = z.object({
  mode: z.enum(["chapter", "assignment"]).default("chapter"),
  runId: z.string().min(1),
  projectId: z.string().min(1),
  chapterId: z.string().min(1),
  reservationId: z.string().min(1).nullable().optional(),
  createdBy: z.enum(["ai", "revision"]).default("ai"),
  revisionNotes: z.string().trim().max(2000).nullable().optional(),
  spendCapUsd: z.number().positive().default(WRITING_CONFIG.limits.perChapterSpendCapUsd),
});

export type WriteChapterPayload = z.input<typeof WriteChapterPayloadSchema>;

export interface LoadedChapterContext {
  userId: string;
  projectId: string;
  chapterId: string;
  chapterNumber: number;
  chapterTitle: string;
  chapterType: string;
  topic: string;
  level: string | null;
  spelling: SpellingVariant;
  targetPages: number;
  wordsPerPage: number;
  formatting: ExportFormattingSettings;
  startedAtIso: string;
  priorSummaryText: string;
  glossaryText: string;
  resultsMode: "standard" | "user_dataset" | "public_dataset" | "labelled_framework";
  datasetMarkdown: string | null;
  sectionPlan: Array<{
    sectionId: string;
    orderIndex: number;
    heading: string;
    wordBudget: number;
  }>;
}

export interface SectionStepOutput {
  sectionId: string;
  reusedCheckpoint: boolean;
  wordCount: number;
  verifiedClaimsCount: number;
}

export interface FinalizeChapterOutput {
  chapterId: string;
  versionId: string;
  version: number;
  contentR2Key: string;
  wordCount: number;
  pageCount: number;
  totalVerifiedClaims: number;
  status: "ready" | "needs_attention";
}

export interface WriteChapterSteps {
  loadContext(fn: () => Promise<LoadedChapterContext>): Promise<LoadedChapterContext>;
  draftSection(
    sectionIndex: number,
    fn: () => Promise<SectionStepOutput>
  ): Promise<SectionStepOutput>;
  assembleAndFinalize(fn: () => Promise<FinalizeChapterOutput>): Promise<FinalizeChapterOutput>;
  notifyNeedsAttention?(fn: () => Promise<void>): Promise<void>;
}

export interface WriteChapterDeps {
  db: AppDb;
  bucket: R2WritableBucket;
  llmCtx: CallLLMContext;
  embedder?: EmbeddingProvider;
  vectorStore?: VectorStore;
  citationFetchFn?: typeof fetch;
  contactEmail?: string;
  browser?: BrowserRunPdfBinding;
  measurePagesFn?: MeasurePagesFn;
  externalPlagiarismProvider?: ExternalPlagiarismProvider;
  waiveOriginalityGate?: boolean;
  nowFn?: () => Date;
  onChapterReady?: (info: {
    projectId: string;
    chapterId: string;
    chapterNumber: number;
    chapterTitle: string;
    version: number;
    wordCount: number;
    pageCount: number;
    allChaptersComplete: boolean;
  }) => Promise<void>;
  onNeedsAttention?: (info: {
    projectId: string;
    chapterId: string;
    chapterNumber: number;
    chapterTitle: string;
    reason: string;
    kind: ChapterAttentionKind;
  }) => Promise<void>;
}

export async function runWriteChapterOrchestration(
  rawPayload: unknown,
  steps: WriteChapterSteps,
  deps: WriteChapterDeps
): Promise<FinalizeChapterOutput> {
  const payload = WriteChapterPayloadSchema.parse(rawPayload);
  const nowFn = deps.nowFn ?? (() => new Date());

  try {
    const context = await steps.loadContext(async () => {
      const now = nowFn();
      const [project] = await deps.db
        .select()
        .from(projects)
        .where(eq(projects.id, payload.projectId))
        .limit(1);
      if (!project) throw new Error(`Project ${payload.projectId} not found`);

      const [chapter] = await deps.db
        .select()
        .from(chapters)
        .where(and(eq(chapters.id, payload.chapterId), eq(chapters.projectId, payload.projectId)))
        .limit(1);
      if (!chapter) throw new Error(`Chapter ${payload.chapterId} not found`);
      if (chapter.isAutoReferences) {
        throw new Error(
          "References chapter is generated by the citation engine, not written by LLM."
        );
      }

      const startedAt = chapter.startedAt ?? now;
      await deps.db
        .update(chapters)
        .set({ status: "writing", startedAt, updatedAt: now })
        .where(eq(chapters.id, chapter.id));

      await deps.db
        .update(projects)
        .set({ status: "in_progress", updatedAt: now })
        .where(eq(projects.id, project.id));

      await deps.db
        .insert(projectMemory)
        .values({
          projectId: project.id,
          outlineJson: "{}",
          outlineLocked: true,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: projectMemory.projectId,
          set: { outlineLocked: true, updatedAt: now },
        });

      await syncCitationRegistryForProject(deps.db, project.id, now);
      if (deps.citationFetchFn) {
        // Scope citation checks to sources with extracted passages, trust scholarly API records,
        // and cap live external HTTP fetches so Cloudflare Free-plan (50 subrequest) budgets
        // remain intact for LLM drafting, verification, and email notifications.
        const passageSourceRows = await deps.db
          .select({ sourceId: sourcePassages.sourceId })
          .from(sourcePassages)
          .where(eq(sourcePassages.projectId, project.id));
        const passageSourceIds = new Set(passageSourceRows.map((p) => p.sourceId));

        await verifyProjectCitations(deps.db, project.id, {
          onlyUnverified: true,
          sourceIds: passageSourceIds.size > 0 ? passageSourceIds : undefined,
          autoVerifyTrustedConnectors: true,
          maxExternalChecks: 8,
          concurrency: 4,
          fetchFn: deps.citationFetchFn,
          contactEmail: deps.contactEmail,
          now,
        });
      }

      const [settingsRow] = await deps.db
        .select()
        .from(projectSettings)
        .where(eq(projectSettings.projectId, project.id))
        .limit(1);

      const wordsPerPage = calculateWordsPerPage(
        settingsRow?.lineSpacing ?? "double",
        settingsRow?.fontSizePt ?? 12
      );
      const targetPages = chapter.pageBudget ?? 6;

      let sectionRows = await deps.db
        .select()
        .from(sections)
        .where(eq(sections.chapterId, chapter.id))
        .orderBy(asc(sections.orderIndex));

      if (sectionRows.length === 0) {
        const defaultSecId = `sec_${crypto.randomUUID()}`;
        await deps.db.insert(sections).values({
          id: defaultSecId,
          chapterId: chapter.id,
          orderIndex: 1,
          heading: chapter.title,
          wordBudget: targetPages * wordsPerPage,
          status: "not_started",
          createdAt: now,
          updatedAt: now,
        });
        sectionRows = await deps.db
          .select()
          .from(sections)
          .where(eq(sections.chapterId, chapter.id))
          .orderBy(asc(sections.orderIndex));
      }

      const [memoryRow] = await deps.db
        .select()
        .from(projectMemory)
        .where(eq(projectMemory.projectId, project.id))
        .limit(1);

      let priorSummaryText = "";
      let glossaryText = "";
      if (memoryRow) {
        try {
          const summaries = JSON.parse(memoryRow.chapterSummariesJson) as Array<{
            chapterNumber: number;
            title: string;
            summary: string;
          }>;
          priorSummaryText = summaries
            .filter((s) => s.chapterNumber < chapter.number)
            .map((s) => `Chapter ${s.chapterNumber} (${s.title}): ${s.summary}`)
            .join("\n");
        } catch {
          priorSummaryText = "";
        }
        try {
          const gloss = JSON.parse(memoryRow.glossaryJson) as Array<{
            term: string;
            definition: string;
          }>;
          glossaryText = gloss.map((g) => `- ${g.term}: ${g.definition}`).join("\n");
        } catch {
          glossaryText = "";
        }
      }

      let resultsMode: LoadedChapterContext["resultsMode"] = "standard";
      let datasetMarkdown: string | null = null;
      if (chapter.chapterType === "results") {
        const [dataset] = await deps.db
          .select()
          .from(projectDatasets)
          .where(eq(projectDatasets.projectId, project.id))
          .orderBy(desc(projectDatasets.createdAt))
          .limit(1);

        if (dataset) {
          resultsMode = "user_dataset";
          try {
            const summary = JSON.parse(dataset.summaryJson) as DatasetAnalysisResult;
            datasetMarkdown = summary.markdownTables || null;
          } catch {
            datasetMarkdown = null;
          }
        } else {
          const publicDataPassages = await retrieveEvidencePassages(deps.db, {
            projectId: project.id,
            queryText: `${project.title} empirical statistics dataset findings`,
            topK: 4,
            sourceTypeFilter: ["dataset", "institutional"],
          });
          resultsMode = publicDataPassages.length >= 2 ? "public_dataset" : "labelled_framework";
        }
      }

      let frontMatter = { ...DEFAULT_FRONT_MATTER };
      let cover = { ...DEFAULT_COVER_DETAILS };
      if (settingsRow?.frontMatterJson) {
        try {
          frontMatter = FrontMatterTogglesSchema.parse(JSON.parse(settingsRow.frontMatterJson));
        } catch {
          frontMatter = { ...DEFAULT_FRONT_MATTER };
        }
      }
      if (settingsRow?.coverJson) {
        try {
          cover = CoverDetailsSchema.parse(JSON.parse(settingsRow.coverJson));
        } catch {
          cover = { ...DEFAULT_COVER_DETAILS };
        }
      }
      const formatting: ExportFormattingSettings = {
        font: settingsRow?.font ?? "Times New Roman",
        fontSizePt: settingsRow?.fontSizePt ?? 12,
        lineSpacing: settingsRow?.lineSpacing ?? "double",
        marginsMm: settingsRow?.marginsMm ?? 25,
        pageNumbering: settingsRow?.pageNumbering ?? true,
        frontMatter,
        cover,
      };

      return {
        userId: project.userId,
        projectId: project.id,
        chapterId: chapter.id,
        chapterNumber: chapter.number,
        chapterTitle: chapter.title,
        chapterType: chapter.chapterType,
        topic: project.title,
        level: project.level,
        spelling: settingsRow?.spelling ?? "uk",
        targetPages,
        wordsPerPage,
        formatting,
        startedAtIso: startedAt.toISOString(),
        priorSummaryText,
        glossaryText,
        resultsMode,
        datasetMarkdown,
        sectionPlan: sectionRows.map((s) => ({
          sectionId: s.id,
          orderIndex: s.orderIndex,
          heading: s.heading,
          wordBudget: Math.max(150, s.wordBudget),
        })),
      };
    });

    if (context.resultsMode === "labelled_framework") {
      return await steps.assembleAndFinalize(async () => {
        const now = nowFn();
        const frameworkMd = buildLabelledResultsFramework({
          chapterTitle: `Chapter ${context.chapterNumber}: ${context.chapterTitle}`,
          topic: context.topic,
          sectionHeadings: context.sectionPlan.map((s) => s.heading),
        });

        const existingVersions = await deps.db
          .select()
          .from(chapterVersions)
          .where(eq(chapterVersions.chapterId, context.chapterId))
          .orderBy(desc(chapterVersions.version))
          .limit(1);

        const nextVersion = (existingVersions[0]?.version ?? 0) + 1;
        const versionId = `ver_${crypto.randomUUID()}`;
        const contentR2Key = `chapters/${context.projectId}/${context.chapterId}/v${nextVersion}.md`;
        const wordCount = countWords(frameworkMd);
        const pageCount = Math.max(1, Math.round(wordCount / context.wordsPerPage));

        await deps.bucket.put(contentR2Key, frameworkMd, {
          httpMetadata: { contentType: "text/markdown; charset=utf-8" },
        });

        await deps.db.insert(chapterVersions).values({
          id: versionId,
          chapterId: context.chapterId,
          version: nextVersion,
          contentR2Key,
          wordCount,
          pageCount,
          promptVersion: WRITING_CONFIG.promptVersion,
          createdBy: payload.createdBy as ChapterVersionCreator,
          revisionNotes:
            payload.revisionNotes ?? "NN-4 labelled results framework (no fabricated data)",
          createdAt: now,
        });

        await deps.db
          .update(chapters)
          .set({ status: "ready", finishedAt: now, updatedAt: now })
          .where(eq(chapters.id, context.chapterId));

        if (payload.reservationId) {
          try {
            await captureChapterReservation(deps.db, payload.reservationId, now);
          } catch {
            // Non-fatal if reservation already settled
          }
        }

        const allProjectChapters = await deps.db
          .select()
          .from(chapters)
          .where(eq(chapters.projectId, context.projectId));
        const contentChapters = allProjectChapters.filter((c) => !c.isAutoReferences);
        const allChaptersComplete =
          contentChapters.length > 0 &&
          contentChapters.every((c) => c.status === "ready" || c.status === "approved");

        if (allChaptersComplete) {
          await deps.db
            .update(projects)
            .set({ status: "completed", updatedAt: now })
            .where(eq(projects.id, context.projectId));
        }

        if (deps.onChapterReady) {
          await deps.onChapterReady({
            projectId: context.projectId,
            chapterId: context.chapterId,
            chapterNumber: context.chapterNumber,
            chapterTitle: context.chapterTitle,
            version: nextVersion,
            wordCount,
            pageCount,
            allChaptersComplete,
          });
        }

        return {
          chapterId: context.chapterId,
          versionId,
          version: nextVersion,
          contentR2Key,
          wordCount,
          pageCount,
          totalVerifiedClaims: 0,
          status: "ready",
        };
      });
    }

    for (let idx = 0; idx < context.sectionPlan.length; idx++) {
      const sec = context.sectionPlan[idx]!;
      await steps.draftSection(idx, async () => {
        const now = nowFn();
        if (isChapterTimedOut(new Date(context.startedAtIso), now)) {
          throw new Error("Chapter exceeded the 24-hour execution ceiling; progress preserved.");
        }

        const [checkpoint] = await deps.db
          .select()
          .from(sectionDrafts)
          .where(
            and(eq(sectionDrafts.sectionId, sec.sectionId), eq(sectionDrafts.runId, payload.runId))
          )
          .limit(1);

        if (checkpoint && checkpoint.status === "verified") {
          return {
            sectionId: sec.sectionId,
            reusedCheckpoint: true,
            wordCount: checkpoint.wordCount,
            verifiedClaimsCount: 0,
          };
        }

        await deps.db
          .update(sections)
          .set({ status: "drafting", updatedAt: now })
          .where(eq(sections.id, sec.sectionId));

        const passages = await retrieveEvidencePassages(deps.db, {
          projectId: context.projectId,
          queryText: `${context.topic} ${context.chapterTitle} ${sec.heading}`,
          topK: WRITING_CONFIG.limits.topPassagesPerSection,
          sourceTypeFilter:
            context.resultsMode === "public_dataset" ? ["dataset", "institutional"] : undefined,
          embedder: deps.embedder,
          vectorStore: deps.vectorStore,
        });

        const result = await draftAndVerifySection(
          {
            workflowId: payload.runId,
            projectId: context.projectId,
            topic: context.topic,
            chapterTitle: context.chapterTitle,
            sectionHeading: sec.heading,
            wordBudget: sec.wordBudget,
            level: context.level,
            spelling: context.spelling,
            priorSummaryText: context.priorSummaryText,
            glossaryText: context.glossaryText,
            revisionInstructions: payload.revisionNotes,
            extraDataContext: context.datasetMarkdown,
            passages,
            spendCapUsd: payload.spendCapUsd,
          },
          deps.llmCtx
        );

        await deps.db.delete(claims).where(eq(claims.sectionId, sec.sectionId));
        for (const clm of result.claims) {
          await deps.db.insert(claims).values({
            id: `clm_${crypto.randomUUID()}`,
            sectionId: sec.sectionId,
            chapterId: context.chapterId,
            text: clm.text,
            citationId: clm.citationId,
            passageId: clm.passageId,
            verdict: clm.verdict,
            verified: clm.verified,
            verifierNotes: clm.verifierNotes,
            createdAt: nowFn(),
          });
        }

        await deps.db
          .insert(sectionDrafts)
          .values({
            id: `sdr_${crypto.randomUUID()}`,
            sectionId: sec.sectionId,
            chapterId: context.chapterId,
            runId: payload.runId,
            draftText: result.prose,
            wordCount: result.wordCount,
            status: "verified",
            updatedAt: nowFn(),
          })
          .onConflictDoUpdate({
            target: [sectionDrafts.sectionId, sectionDrafts.runId],
            set: {
              draftText: result.prose,
              wordCount: result.wordCount,
              status: "verified",
              updatedAt: nowFn(),
            },
          });

        await deps.db
          .update(sections)
          .set({ status: "verified", updatedAt: nowFn() })
          .where(eq(sections.id, sec.sectionId));

        return {
          sectionId: sec.sectionId,
          reusedCheckpoint: false,
          wordCount: result.wordCount,
          verifiedClaimsCount: result.claims.length,
        };
      });
    }

    return await steps.assembleAndFinalize(async () => {
      const now = nowFn();
      const draftRows = await deps.db
        .select()
        .from(sectionDrafts)
        .where(
          and(
            eq(sectionDrafts.chapterId, context.chapterId),
            eq(sectionDrafts.runId, payload.runId)
          )
        );
      const draftBySectionId = new Map(draftRows.map((d) => [d.sectionId, d.draftText]));

      const assembledSections = context.sectionPlan.map((sec) => {
        const body = draftBySectionId.get(sec.sectionId) ?? "";
        return `## ${context.chapterNumber}.${sec.orderIndex} ${sec.heading}\n\n${body}`;
      });

      const rawChapterMarkdown = [
        `# Chapter ${context.chapterNumber}: ${context.chapterTitle}`,
        ...(context.resultsMode === "user_dataset" && context.datasetMarkdown
          ? [context.datasetMarkdown]
          : []),
        ...assembledSections,
      ].join("\n\n");

      const allPassages: RetrievedEvidencePassage[] = await retrieveEvidencePassages(deps.db, {
        projectId: context.projectId,
        queryText: `${context.topic} ${context.chapterTitle}`,
        topK: 12,
        embedder: deps.embedder,
        vectorStore: deps.vectorStore,
      });

      const effectiveMeasurePagesFn: MeasurePagesFn = deps.measurePagesFn
        ? deps.measurePagesFn
        : deps.browser
          ? async (md, wpp) => {
              try {
                const measurer = createBrowserRunPageMeasurer(deps.browser!, context.formatting);
                return await measurer(md, wpp);
              } catch {
                return defaultMeasurePages(md, wpp);
              }
            }
          : defaultMeasurePages;

      const calibrated = await enforceChapterLengthBand(
        {
          workflowId: payload.runId,
          projectId: context.projectId,
          chapterTitle: context.chapterTitle,
          assembledMarkdown: rawChapterMarkdown,
          targetPages: context.targetPages,
          wordsPerPage: context.wordsPerPage,
          passages: allPassages,
          spendCapUsd: payload.spendCapUsd,
          measurePagesFn: effectiveMeasurePagesFn,
        },
        deps.llmCtx
      );

      const allProjectPassages = await deps.db
        .select()
        .from(sourcePassages)
        .where(eq(sourcePassages.projectId, context.projectId));

      const normalizedTopic = normalizeTitle(context.topic);
      const otherFingerprintsRaw = await deps.db
        .select()
        .from(chapterFingerprints)
        .where(
          and(
            eq(chapterFingerprints.topicNormalized, normalizedTopic),
            ne(chapterFingerprints.userId, context.userId)
          )
        )
        .limit(30);

      const otherUserFingerprints = otherFingerprintsRaw.map((fp) => {
        let hashes: string[];
        try {
          hashes = JSON.parse(fp.shingleHashesJson) as string[];
        } catch {
          hashes = [];
        }
        return { chapterVersionId: fp.chapterVersionId, shingleHashes: hashes };
      });

      const originalityOutcome = await runOriginalityGateWithRewrite({
        workflowId: payload.runId,
        projectId: context.projectId,
        chapterTitle: context.chapterTitle,
        draftMarkdown: calibrated.markdown,
        sourcePassages: allProjectPassages.map((p) => ({
          passageId: p.id,
          sourceId: p.sourceId,
          text: p.text,
        })),
        otherUserFingerprints,
        embedder: deps.embedder,
        externalProvider: deps.externalPlagiarismProvider,
        llmCtx: deps.llmCtx,
        spendCapUsd: payload.spendCapUsd,
        waiveGate: deps.waiveOriginalityGate,
      });

      const finalMarkdown = originalityOutcome.markdown;
      const finalWordCount = countWords(finalMarkdown);
      const finalPageCount = await effectiveMeasurePagesFn(finalMarkdown, context.wordsPerPage);
      const finalStatus: "ready" | "needs_attention" = originalityOutcome.evaluation.passed
        ? "ready"
        : "needs_attention";

      const existingVersions = await deps.db
        .select()
        .from(chapterVersions)
        .where(eq(chapterVersions.chapterId, context.chapterId))
        .orderBy(desc(chapterVersions.version))
        .limit(1);

      const nextVersion = (existingVersions[0]?.version ?? 0) + 1;
      const versionId = `ver_${crypto.randomUUID()}`;
      const contentR2Key = `chapters/${context.projectId}/${context.chapterId}/v${nextVersion}.md`;

      await deps.bucket.put(contentR2Key, finalMarkdown, {
        httpMetadata: { contentType: "text/markdown; charset=utf-8" },
        customMetadata: {
          projectId: context.projectId,
          chapterId: context.chapterId,
          version: String(nextVersion),
          promptVersion: WRITING_CONFIG.promptVersion,
        },
      });

      await deps.db.insert(chapterVersions).values({
        id: versionId,
        chapterId: context.chapterId,
        version: nextVersion,
        contentR2Key,
        wordCount: finalWordCount,
        pageCount: finalPageCount,
        promptVersion: WRITING_CONFIG.promptVersion,
        createdBy: payload.createdBy as ChapterVersionCreator,
        revisionNotes: payload.revisionNotes ?? null,
        createdAt: now,
      });

      const memUpdate = await summarizeChapterForMemory(
        {
          workflowId: payload.runId,
          projectId: context.projectId,
          chapterNumber: context.chapterNumber,
          chapterTitle: context.chapterTitle,
          chapterMarkdown: finalMarkdown,
          spendCapUsd: payload.spendCapUsd,
        },
        deps.llmCtx
      );

      const [memoryRow] = await deps.db
        .select()
        .from(projectMemory)
        .where(eq(projectMemory.projectId, context.projectId))
        .limit(1);

      let summaries: Array<{ chapterNumber: number; title: string; summary: string }> = [];
      let glossary: Array<{ term: string; definition: string }> = [];
      if (memoryRow) {
        try {
          summaries = JSON.parse(memoryRow.chapterSummariesJson) as typeof summaries;
        } catch {
          summaries = [];
        }
        try {
          glossary = JSON.parse(memoryRow.glossaryJson) as typeof glossary;
        } catch {
          glossary = [];
        }
      }

      const nextSummaries = [
        ...summaries.filter((s) => s.chapterNumber !== context.chapterNumber),
        {
          chapterNumber: context.chapterNumber,
          title: context.chapterTitle,
          summary: memUpdate.summary,
        },
      ].sort((a, b) => a.chapterNumber - b.chapterNumber);

      const seenTerms = new Set(glossary.map((g) => g.term.toLowerCase()));
      for (const term of memUpdate.glossaryTerms) {
        if (!seenTerms.has(term.term.toLowerCase())) {
          glossary.push(term);
          seenTerms.add(term.term.toLowerCase());
        }
      }

      await deps.db
        .update(projectMemory)
        .set({
          chapterSummariesJson: JSON.stringify(nextSummaries),
          glossaryJson: JSON.stringify(glossary),
          updatedAt: now,
        })
        .where(eq(projectMemory.projectId, context.projectId));

      await deps.db.insert(originalityReports).values({
        id: `org_${crypto.randomUUID()}`,
        chapterVersionId: versionId,
        chapterId: context.chapterId,
        projectId: context.projectId,
        overlapScore: originalityOutcome.evaluation.overlapScore,
        semanticScore: originalityOutcome.evaluation.semanticScore,
        quoteSharePct: originalityOutcome.evaluation.quoteSharePct,
        crossUserScore: originalityOutcome.evaluation.crossUserScore,
        flaggedSpansJson: JSON.stringify(originalityOutcome.evaluation.flaggedSpans),
        externalReportJson: originalityOutcome.evaluation.externalReport
          ? JSON.stringify(originalityOutcome.evaluation.externalReport)
          : null,
        passed: originalityOutcome.evaluation.passed,
        waived: originalityOutcome.evaluation.waived,
        createdAt: now,
      });

      await deps.db.insert(chapterFingerprints).values({
        id: `cfp_${crypto.randomUUID()}`,
        projectId: context.projectId,
        userId: context.userId,
        chapterVersionId: versionId,
        topicNormalized: normalizedTopic,
        shingleHashesJson: JSON.stringify(originalityOutcome.evaluation.shingleHashes),
        createdAt: now,
      });

      await deps.db
        .update(chapters)
        .set({
          status: finalStatus,
          finishedAt: finalStatus === "ready" ? now : null,
          updatedAt: now,
        })
        .where(eq(chapters.id, context.chapterId));

      const chapterClaims = await deps.db
        .select()
        .from(claims)
        .where(and(eq(claims.chapterId, context.chapterId), eq(claims.verified, true)));

      if (payload.reservationId) {
        try {
          if (finalStatus === "ready") {
            await captureChapterReservation(deps.db, payload.reservationId, now);
          } else {
            await refundChapterReservation(
              deps.db,
              payload.reservationId,
              "Chapter paused for originality review and needs attention",
              now
            );
          }
        } catch {
          // Non-fatal if reservation already settled
        }
      }

      const allProjectChapters = await deps.db
        .select()
        .from(chapters)
        .where(eq(chapters.projectId, context.projectId));
      const contentChapters = allProjectChapters.filter((c) => !c.isAutoReferences);
      const allChaptersComplete =
        finalStatus === "ready" &&
        contentChapters.length > 0 &&
        contentChapters.every((c) => c.status === "ready" || c.status === "approved");

      if (allChaptersComplete) {
        await deps.db
          .update(projects)
          .set({ status: "completed", updatedAt: now })
          .where(eq(projects.id, context.projectId));
      }

      if (finalStatus === "ready" && deps.onChapterReady) {
        await deps.onChapterReady({
          projectId: context.projectId,
          chapterId: context.chapterId,
          chapterNumber: context.chapterNumber,
          chapterTitle: context.chapterTitle,
          version: nextVersion,
          wordCount: finalWordCount,
          pageCount: finalPageCount,
          allChaptersComplete,
        });
      } else if (finalStatus === "needs_attention") {
        const originalityAttention = buildOriginalityAttention({
          overlapScore: originalityOutcome.evaluation.overlapScore,
          quoteSharePct: originalityOutcome.evaluation.quoteSharePct,
        });
        await recordChapterNeedsAttentionAudit(deps.db, {
          userId: context.userId,
          projectId: context.projectId,
          chapterId: context.chapterId,
          attention: originalityAttention,
          internalReason: `Originality gate flagged similarity (overlap ${originalityOutcome.evaluation.overlapScore}%, quotes ${originalityOutcome.evaluation.quoteSharePct}%)`,
          now,
        });

        if (deps.onNeedsAttention) {
          await deps.onNeedsAttention({
            projectId: context.projectId,
            chapterId: context.chapterId,
            chapterNumber: context.chapterNumber,
            chapterTitle: context.chapterTitle,
            reason: originalityAttention.userMessage,
            kind: originalityAttention.kind,
          });
        }
      }

      return {
        chapterId: context.chapterId,
        versionId,
        version: nextVersion,
        contentR2Key,
        wordCount: finalWordCount,
        pageCount: finalPageCount,
        totalVerifiedClaims: chapterClaims.length,
        status: finalStatus,
      };
    });
  } catch (err) {
    const failedAt = nowFn();
    const { attention, internalReason } = classifyChapterRuntimeError(err);

    await deps.db
      .update(chapters)
      .set({ status: "needs_attention", updatedAt: failedAt })
      .where(eq(chapters.id, payload.chapterId));

    const [projRow] = await deps.db
      .select({ userId: projects.userId })
      .from(projects)
      .where(eq(projects.id, payload.projectId))
      .limit(1);

    try {
      await recordChapterNeedsAttentionAudit(deps.db, {
        userId: projRow?.userId ?? null,
        projectId: payload.projectId,
        chapterId: payload.chapterId,
        attention,
        internalReason,
        now: failedAt,
      });
    } catch {
      // Preserve original workflow error
    }

    if (payload.reservationId) {
      try {
        await refundChapterReservation(
          deps.db,
          payload.reservationId,
          "Chapter drafting failed before completion",
          failedAt
        );
      } catch {
        // Preserve original workflow error
      }
    }

    if (deps.onNeedsAttention) {
      const dispatchNotification = async () => {
        const [chRow] = await deps.db
          .select()
          .from(chapters)
          .where(eq(chapters.id, payload.chapterId))
          .limit(1);
        await deps.onNeedsAttention!({
          projectId: payload.projectId,
          chapterId: payload.chapterId,
          chapterNumber: chRow?.number ?? 1,
          chapterTitle: chRow?.title ?? "Chapter",
          reason: attention.userMessage,
          kind: attention.kind,
        });
      };

      try {
        if (steps.notifyNeedsAttention) {
          await steps.notifyNeedsAttention(dispatchNotification);
        } else {
          await dispatchNotification();
        }
      } catch (notifyErr) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "needs_attention_notification_error",
            projectId: payload.projectId,
            chapterId: payload.chapterId,
            error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
          })
        );
      }
    }
    throw err;
  }
}

export interface LoadedAssignmentContext {
  userId: string;
  projectId: string;
  chapterId: string;
  topic: string;
  level: string | null;
  spelling: SpellingVariant;
  targetPages: number;
  wordsPerPage: number;
  formatting: ExportFormattingSettings;
  questionPlan: Array<{
    questionId: string;
    sectionId: string;
    orderIndex: number;
    text: string;
    wordBudget: number;
  }>;
}

export interface AssignmentQuestionStepOutput {
  sectionId: string;
  reusedCheckpoint: boolean;
}

export interface AssignmentDraftOutput extends FinalizeChapterOutput {
  questionCount: number;
}

export interface WriteAssignmentSteps {
  loadContext(fn: () => Promise<LoadedAssignmentContext>): Promise<LoadedAssignmentContext>;
  draftQuestion(
    questionIndex: number,
    fn: () => Promise<AssignmentQuestionStepOutput>
  ): Promise<AssignmentQuestionStepOutput>;
  assembleAndFinalize(fn: () => Promise<AssignmentDraftOutput>): Promise<AssignmentDraftOutput>;
  notifyNeedsAttention?(fn: () => Promise<void>): Promise<void>;
}

export async function runWriteAssignmentOrchestration(
  params: {
    runId: string;
    projectId: string;
    chapterId?: string;
    reservationId?: string | null;
    createdBy?: "ai" | "revision";
    revisionNotes?: string | null;
    spendCapUsd?: number;
  },
  deps: WriteChapterDeps,
  steps?: WriteAssignmentSteps
): Promise<AssignmentDraftOutput> {
  const nowFn = deps.nowFn ?? (() => new Date());
  const spendCapUsd = params.spendCapUsd ?? WRITING_CONFIG.limits.perChapterSpendCapUsd;
  const stepRunner: WriteAssignmentSteps = steps ?? {
    loadContext: (fn) => fn(),
    draftQuestion: (_idx, fn) => fn(),
    assembleAndFinalize: (fn) => fn(),
  };

  let trackedChapterId = params.chapterId ?? "";

  try {
    const context = await stepRunner.loadContext(async () => {
      const now = nowFn();
      const [project] = await deps.db
        .select()
        .from(projects)
        .where(eq(projects.id, params.projectId))
        .limit(1);
      if (!project) throw new Error(`Project ${params.projectId} not found`);

      const qRows = await deps.db
        .select()
        .from(questions)
        .where(eq(questions.projectId, project.id))
        .orderBy(asc(questions.orderIndex));
      if (qRows.length === 0) throw new Error("Assignment has no questions to answer.");

      const [settingsRow] = await deps.db
        .select()
        .from(projectSettings)
        .where(eq(projectSettings.projectId, project.id))
        .limit(1);

      const wordsPerPage = calculateWordsPerPage(
        settingsRow?.lineSpacing ?? "double",
        settingsRow?.fontSizePt ?? 12
      );
      const targetPages = Math.max(qRows.length * 2, project.targetPages ?? qRows.length * 4);
      const targetPagesPerQ = Math.max(2, Math.round(targetPages / qRows.length));

      let frontMatter = { ...DEFAULT_FRONT_MATTER };
      let cover = { ...DEFAULT_COVER_DETAILS };
      if (settingsRow?.frontMatterJson) {
        try {
          frontMatter = FrontMatterTogglesSchema.parse(JSON.parse(settingsRow.frontMatterJson));
        } catch {
          frontMatter = { ...DEFAULT_FRONT_MATTER };
        }
      }
      if (settingsRow?.coverJson) {
        try {
          cover = CoverDetailsSchema.parse(JSON.parse(settingsRow.coverJson));
        } catch {
          cover = { ...DEFAULT_COVER_DETAILS };
        }
      }

      const formatting: ExportFormattingSettings = {
        font: settingsRow?.font ?? "Times New Roman",
        fontSizePt: settingsRow?.fontSizePt ?? 12,
        lineSpacing: settingsRow?.lineSpacing ?? "double",
        marginsMm: settingsRow?.marginsMm ?? 25,
        pageNumbering: settingsRow?.pageNumbering ?? true,
        frontMatter,
        cover,
      };

      // Ensure a single combined assignment chapter record exists for versioning, reader, and PDF/DOCX exports
      let chapterId = params.chapterId;
      if (!chapterId) {
        const [existingCh] = await deps.db
          .select()
          .from(chapters)
          .where(and(eq(chapters.projectId, project.id), eq(chapters.number, 1)))
          .limit(1);
        chapterId = existingCh?.id;
      }

      if (!chapterId) {
        chapterId = `chp_${crypto.randomUUID()}`;
        await deps.db.insert(chapters).values({
          id: chapterId,
          projectId: project.id,
          number: 1,
          title: project.title,
          chapterType: "assignment",
          pageBudget: targetPages,
          wordBudget: targetPages * wordsPerPage,
          isAutoReferences: false,
          status: "writing",
          startedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await deps.db
          .update(chapters)
          .set({ status: "writing", startedAt: now, updatedAt: now })
          .where(eq(chapters.id, chapterId));
      }

      await deps.db
        .update(projects)
        .set({ status: "in_progress", updatedAt: now })
        .where(eq(projects.id, project.id));

      await deps.db
        .insert(projectMemory)
        .values({
          projectId: project.id,
          outlineJson: "{}",
          outlineLocked: true,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: projectMemory.projectId,
          set: { outlineLocked: true, updatedAt: now },
        });

      await syncCitationRegistryForProject(deps.db, project.id, now);
      if (deps.citationFetchFn) {
        // Scope citation checks to sources with extracted passages, trust scholarly API records,
        // and cap live external HTTP fetches so Cloudflare Free-plan (50 subrequest) budgets
        // remain intact for LLM drafting, verification, and email notifications.
        const passageSourceRows = await deps.db
          .select({ sourceId: sourcePassages.sourceId })
          .from(sourcePassages)
          .where(eq(sourcePassages.projectId, project.id));
        const passageSourceIds = new Set(passageSourceRows.map((p) => p.sourceId));

        await verifyProjectCitations(deps.db, project.id, {
          onlyUnverified: true,
          sourceIds: passageSourceIds.size > 0 ? passageSourceIds : undefined,
          autoVerifyTrustedConnectors: true,
          maxExternalChecks: 8,
          concurrency: 4,
          fetchFn: deps.citationFetchFn,
          contactEmail: deps.contactEmail,
          now,
        });
      }

      const existingSections = await deps.db
        .select()
        .from(sections)
        .where(eq(sections.chapterId, chapterId))
        .orderBy(asc(sections.orderIndex));
      const existingByOrder = new Map(existingSections.map((s) => [s.orderIndex, s]));

      const questionPlan: Array<{
        questionId: string;
        sectionId: string;
        orderIndex: number;
        text: string;
        wordBudget: number;
      }> = [];

      for (const q of qRows) {
        const wordBudget = targetPagesPerQ * wordsPerPage;
        const existingSec = existingByOrder.get(q.orderIndex);
        let sectionId = existingSec?.id;
        if (!sectionId) {
          sectionId = `sec_${crypto.randomUUID()}`;
          await deps.db.insert(sections).values({
            id: sectionId,
            chapterId,
            orderIndex: q.orderIndex,
            heading: `Question ${q.orderIndex}: ${q.text}`.slice(0, 180),
            wordBudget,
            status: "not_started",
            createdAt: now,
            updatedAt: now,
          });
        }
        questionPlan.push({
          questionId: q.id,
          sectionId,
          orderIndex: q.orderIndex,
          text: q.text,
          wordBudget,
        });
      }

      return {
        userId: project.userId,
        projectId: project.id,
        chapterId,
        topic: project.title,
        level: project.level,
        spelling: settingsRow?.spelling ?? "uk",
        targetPages,
        wordsPerPage,
        formatting,
        questionPlan,
      };
    });

    trackedChapterId = context.chapterId;

    for (let idx = 0; idx < context.questionPlan.length; idx++) {
      const q = context.questionPlan[idx]!;
      await stepRunner.draftQuestion(idx, async () => {
        const now = nowFn();
        const [checkpoint] = await deps.db
          .select()
          .from(sectionDrafts)
          .where(
            and(eq(sectionDrafts.sectionId, q.sectionId), eq(sectionDrafts.runId, params.runId))
          )
          .limit(1);

        if (checkpoint && checkpoint.status === "verified") {
          return { sectionId: q.sectionId, reusedCheckpoint: true };
        }

        const passages = await retrieveEvidencePassages(deps.db, {
          projectId: context.projectId,
          queryText: q.text,
          questionId: q.questionId,
          topK: WRITING_CONFIG.limits.topPassagesPerSection,
          embedder: deps.embedder,
          vectorStore: deps.vectorStore,
        });

        const ans = await draftAndVerifySection(
          {
            workflowId: params.runId,
            projectId: context.projectId,
            topic: context.topic,
            chapterTitle: `Question ${q.orderIndex}`,
            sectionHeading: q.text,
            wordBudget: q.wordBudget,
            level: context.level,
            spelling: context.spelling,
            priorSummaryText: "",
            glossaryText: "",
            revisionInstructions: params.revisionNotes,
            passages,
            spendCapUsd,
          },
          deps.llmCtx
        );

        await deps.db.delete(claims).where(eq(claims.sectionId, q.sectionId));
        for (const clm of ans.claims) {
          await deps.db.insert(claims).values({
            id: `clm_${crypto.randomUUID()}`,
            sectionId: q.sectionId,
            chapterId: context.chapterId,
            text: clm.text,
            citationId: clm.citationId,
            passageId: clm.passageId,
            verdict: clm.verdict,
            verified: clm.verified,
            verifierNotes: clm.verifierNotes,
            createdAt: now,
          });
        }

        await deps.db
          .insert(sectionDrafts)
          .values({
            id: `sdr_${crypto.randomUUID()}`,
            sectionId: q.sectionId,
            chapterId: context.chapterId,
            runId: params.runId,
            draftText: ans.prose,
            wordCount: ans.wordCount,
            status: "verified",
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [sectionDrafts.sectionId, sectionDrafts.runId],
            set: {
              draftText: ans.prose,
              wordCount: ans.wordCount,
              status: "verified",
              updatedAt: now,
            },
          });

        await deps.db
          .update(sections)
          .set({ status: "verified", updatedAt: now })
          .where(eq(sections.id, q.sectionId));

        return { sectionId: q.sectionId, reusedCheckpoint: false };
      });
    }

    return await stepRunner.assembleAndFinalize(async () => {
      const now = nowFn();
      const draftRows = await deps.db
        .select()
        .from(sectionDrafts)
        .where(
          and(eq(sectionDrafts.chapterId, context.chapterId), eq(sectionDrafts.runId, params.runId))
        );
      const draftBySectionId = new Map(draftRows.map((d) => [d.sectionId, d.draftText]));

      const blocks = [
        `# ${context.topic}`,
        ...context.questionPlan.map((q) => {
          const body = draftBySectionId.get(q.sectionId) ?? "";
          return `## Question ${q.orderIndex}: ${q.text}\n\n${body}`;
        }),
      ];
      const assembledMarkdown = blocks.join("\n\n");

      const allProjectPassages = await deps.db
        .select()
        .from(sourcePassages)
        .where(eq(sourcePassages.projectId, context.projectId));

      const normalizedTopic = normalizeTitle(context.topic);
      const otherFingerprintsRaw = await deps.db
        .select()
        .from(chapterFingerprints)
        .where(
          and(
            eq(chapterFingerprints.topicNormalized, normalizedTopic),
            ne(chapterFingerprints.userId, context.userId)
          )
        )
        .limit(30);

      const otherUserFingerprints = otherFingerprintsRaw.map((fp) => {
        let hashes: string[];
        try {
          hashes = JSON.parse(fp.shingleHashesJson) as string[];
        } catch {
          hashes = [];
        }
        return { chapterVersionId: fp.chapterVersionId, shingleHashes: hashes };
      });

      const originalityOutcome = await runOriginalityGateWithRewrite({
        workflowId: params.runId,
        projectId: context.projectId,
        chapterTitle: context.topic,
        draftMarkdown: assembledMarkdown,
        sourcePassages: allProjectPassages.map((p) => ({
          passageId: p.id,
          sourceId: p.sourceId,
          text: p.text,
        })),
        otherUserFingerprints,
        embedder: deps.embedder,
        externalProvider: deps.externalPlagiarismProvider,
        llmCtx: deps.llmCtx,
        spendCapUsd,
        waiveGate: deps.waiveOriginalityGate,
      });

      const effectiveMeasurePagesFn: MeasurePagesFn = deps.measurePagesFn
        ? deps.measurePagesFn
        : deps.browser
          ? async (md, wpp) => {
              try {
                const measurer = createBrowserRunPageMeasurer(deps.browser!, context.formatting);
                return await measurer(md, wpp);
              } catch {
                return defaultMeasurePages(md, wpp);
              }
            }
          : defaultMeasurePages;

      const finalMarkdown = originalityOutcome.markdown;
      const finalWordCount = countWords(finalMarkdown);
      const finalPageCount = await effectiveMeasurePagesFn(finalMarkdown, context.wordsPerPage);
      const finalStatus: "ready" | "needs_attention" = originalityOutcome.evaluation.passed
        ? "ready"
        : "needs_attention";

      const [latestVer] = await deps.db
        .select()
        .from(chapterVersions)
        .where(eq(chapterVersions.chapterId, context.chapterId))
        .orderBy(desc(chapterVersions.version))
        .limit(1);

      const nextVersion = (latestVer?.version ?? 0) + 1;
      const versionId = `ver_${crypto.randomUUID()}`;
      const contentR2Key = `chapters/${context.projectId}/${context.chapterId}/v${nextVersion}.md`;

      await deps.bucket.put(contentR2Key, finalMarkdown, {
        httpMetadata: { contentType: "text/markdown; charset=utf-8" },
      });

      await deps.db.insert(chapterVersions).values({
        id: versionId,
        chapterId: context.chapterId,
        version: nextVersion,
        contentR2Key,
        wordCount: finalWordCount,
        pageCount: finalPageCount,
        promptVersion: WRITING_CONFIG.promptVersion,
        createdBy: (params.createdBy ?? "ai") as ChapterVersionCreator,
        revisionNotes: params.revisionNotes ?? null,
        createdAt: now,
      });

      await deps.db.insert(originalityReports).values({
        id: `org_${crypto.randomUUID()}`,
        chapterVersionId: versionId,
        chapterId: context.chapterId,
        projectId: context.projectId,
        overlapScore: originalityOutcome.evaluation.overlapScore,
        semanticScore: originalityOutcome.evaluation.semanticScore,
        quoteSharePct: originalityOutcome.evaluation.quoteSharePct,
        crossUserScore: originalityOutcome.evaluation.crossUserScore,
        flaggedSpansJson: JSON.stringify(originalityOutcome.evaluation.flaggedSpans),
        externalReportJson: originalityOutcome.evaluation.externalReport
          ? JSON.stringify(originalityOutcome.evaluation.externalReport)
          : null,
        passed: originalityOutcome.evaluation.passed,
        waived: originalityOutcome.evaluation.waived,
        createdAt: now,
      });

      await deps.db.insert(chapterFingerprints).values({
        id: `cfp_${crypto.randomUUID()}`,
        projectId: context.projectId,
        userId: context.userId,
        chapterVersionId: versionId,
        topicNormalized: normalizedTopic,
        shingleHashesJson: JSON.stringify(originalityOutcome.evaluation.shingleHashes),
        createdAt: now,
      });

      await deps.db
        .update(chapters)
        .set({
          status: finalStatus,
          finishedAt: finalStatus === "ready" ? now : null,
          updatedAt: now,
        })
        .where(eq(chapters.id, context.chapterId));

      if (finalStatus === "ready") {
        await deps.db
          .update(projects)
          .set({ status: "completed", updatedAt: now })
          .where(eq(projects.id, context.projectId));
      }

      if (params.reservationId) {
        try {
          if (finalStatus === "ready") {
            await captureChapterReservation(deps.db, params.reservationId, now);
          } else {
            await refundChapterReservation(
              deps.db,
              params.reservationId,
              "Assignment paused for originality review and needs attention",
              now
            );
          }
        } catch {
          // Non-fatal if reservation already settled
        }
      }

      const verifiedClaims = await deps.db
        .select()
        .from(claims)
        .where(and(eq(claims.chapterId, context.chapterId), eq(claims.verified, true)));

      if (finalStatus === "ready" && deps.onChapterReady) {
        await deps.onChapterReady({
          projectId: context.projectId,
          chapterId: context.chapterId,
          chapterNumber: 1,
          chapterTitle: context.topic,
          version: nextVersion,
          wordCount: finalWordCount,
          pageCount: finalPageCount,
          allChaptersComplete: true,
        });
      } else if (finalStatus === "needs_attention") {
        const originalityAttention = buildOriginalityAttention({
          overlapScore: originalityOutcome.evaluation.overlapScore,
          quoteSharePct: originalityOutcome.evaluation.quoteSharePct,
        });
        await recordChapterNeedsAttentionAudit(deps.db, {
          userId: context.userId,
          projectId: context.projectId,
          chapterId: context.chapterId,
          attention: originalityAttention,
          internalReason: `Assignment originality gate flagged similarity (overlap ${originalityOutcome.evaluation.overlapScore}%)`,
          now,
        });
        if (deps.onNeedsAttention) {
          await deps.onNeedsAttention({
            projectId: context.projectId,
            chapterId: context.chapterId,
            chapterNumber: 1,
            chapterTitle: context.topic,
            reason: originalityAttention.userMessage,
            kind: originalityAttention.kind,
          });
        }
      }

      return {
        chapterId: context.chapterId,
        versionId,
        version: nextVersion,
        contentR2Key,
        wordCount: finalWordCount,
        pageCount: finalPageCount,
        totalVerifiedClaims: verifiedClaims.length,
        status: finalStatus,
        questionCount: context.questionPlan.length,
      };
    });
  } catch (err) {
    const failedAt = nowFn();
    const { attention, internalReason } = classifyChapterRuntimeError(err);

    if (trackedChapterId) {
      await deps.db
        .update(chapters)
        .set({ status: "needs_attention", updatedAt: failedAt })
        .where(eq(chapters.id, trackedChapterId));

      try {
        const [projRow] = await deps.db
          .select({ userId: projects.userId })
          .from(projects)
          .where(eq(projects.id, params.projectId))
          .limit(1);
        await recordChapterNeedsAttentionAudit(deps.db, {
          userId: projRow?.userId ?? null,
          projectId: params.projectId,
          chapterId: trackedChapterId,
          attention,
          internalReason,
          now: failedAt,
        });
      } catch {
        // Preserve original error
      }
    }
    if (params.reservationId) {
      try {
        await refundChapterReservation(
          deps.db,
          params.reservationId,
          "Assignment drafting failed before completion",
          failedAt
        );
      } catch {
        // Preserve original error
      }
    }
    if (deps.onNeedsAttention && trackedChapterId) {
      const dispatchNotification = async () => {
        await deps.onNeedsAttention!({
          projectId: params.projectId,
          chapterId: trackedChapterId,
          chapterNumber: 1,
          chapterTitle: "Assignment answers",
          reason: attention.userMessage,
          kind: attention.kind,
        });
      };
      try {
        if (stepRunner.notifyNeedsAttention) {
          await stepRunner.notifyNeedsAttention(dispatchNotification);
        } else {
          await dispatchNotification();
        }
      } catch (notifyErr) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "needs_attention_notification_error",
            projectId: params.projectId,
            chapterId: trackedChapterId,
            error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
          })
        );
      }
    }
    throw err;
  }
}
