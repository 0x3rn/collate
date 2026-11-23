import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { BILLING_POLICY } from "@/config/pricing";
import type { AppDb } from "@/db/client";
import {
  chapters,
  exportsTable,
  projects,
  projectSettings,
  sources,
  type ChapterStatus,
  type CitationStyle,
  type ExportFormat,
  type ExportScope,
  type ProjectStatus,
  type ProjectType,
} from "@/db/schema";
import { countUserNonFailedSweeps } from "@/lib/billing/ledger";
import { signExportDownloadParams } from "@/lib/export/signed-urls";

export const SETUP_PROJECT_STATUSES = new Set<ProjectStatus>([
  "draft",
  "researching",
  "feasible",
  "not_feasible",
  "needs_refinement",
]);

export type ProjectLifecycleTab = "active" | "completed" | "archived";

export interface ProjectNextAction {
  href: string;
  label: string;
}

export interface DashboardProjectSummary {
  id: string;
  type: ProjectType;
  title: string;
  level: string | null;
  field: string | null;
  institution: string | null;
  status: ProjectStatus;
  lifecycleTab: ProjectLifecycleTab;
  wizardStep: number;
  targetPages: number | null;
  idealPages: number | null;
  citationStyle: CitationStyle;
  chaptersTotal: number;
  chaptersReady: number;
  chaptersApproved: number;
  chaptersWriting: number;
  chaptersNeedsAttention: number;
  sourcesCount: number;
  exportsCount: number;
  nextAction: ProjectNextAction;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardAttentionItem {
  id: string;
  projectId: string;
  projectTitle: string;
  projectType: ProjectType;
  kind: "chapter_needs_attention" | "chapter_ready" | "topic_refinement" | "ready_to_plan";
  tone: "warning" | "info" | "error" | "success";
  title: string;
  detail: string;
  actionLabel: string;
  href: string;
  updatedAt: string;
}

export interface UserExportItem {
  id: string;
  projectId: string;
  projectTitle: string;
  projectType: ProjectType;
  chapterId: string | null;
  chapterNumber: number | null;
  chapterTitle: string | null;
  scope: ExportScope;
  format: ExportFormat;
  pageCount: number;
  sizeBytes: number;
  createdAt: string;
  downloadUrl: string | null;
}

export interface DashboardStats {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  archivedProjects: number;
  chaptersReadyForReview: number;
  chaptersCompleted: number;
  chaptersTotal: number;
  verifiedSourcesTotal: number;
  exportsTotal: number;
  freeSweepsUsed: number;
  freeSweepsRemaining: number;
}

export interface DashboardOverviewData {
  stats: DashboardStats;
  spotlightProject: DashboardProjectSummary | null;
  attentionItems: DashboardAttentionItem[];
  recentProjects: DashboardProjectSummary[];
  recentExports: UserExportItem[];
}

export function classifyProjectTab(status: ProjectStatus): ProjectLifecycleTab {
  if (status === "completed") return "completed";
  if (status === "archived") return "archived";
  return "active";
}

export function deriveProjectNextAction(params: {
  id: string;
  type: ProjectType;
  status: ProjectStatus;
  wizardStep: number;
  chapters: Array<{ id: string; number: number; status: ChapterStatus; isAutoReferences: boolean }>;
}): ProjectNextAction {
  const { id, type, status, wizardStep } = params;

  if (SETUP_PROJECT_STATUSES.has(status)) {
    if (status === "researching") {
      return { href: `/projects/${id}/setup`, label: "View source check" };
    }
    if (status === "needs_refinement" || status === "not_feasible") {
      return { href: `/projects/${id}/setup`, label: "Refine topic" };
    }
    if (status === "feasible") {
      return { href: `/projects/${id}/setup`, label: `Continue setup (Step ${wizardStep})` };
    }
    return { href: `/projects/${id}/setup`, label: `Resume setup (Step ${wizardStep})` };
  }

  const writableChapters = params.chapters.filter((ch) => !ch.isAutoReferences);
  const pausedChapter = writableChapters.find((ch) => ch.status === "needs_attention");
  if (pausedChapter) {
    return {
      href: `/projects/${id}/chapters/${pausedChapter.id}`,
      label:
        type === "assignment" ? "Review paused draft" : `Review Chapter ${pausedChapter.number}`,
    };
  }

  const readyChapter = writableChapters.find((ch) => ch.status === "ready");
  if (readyChapter) {
    return {
      href: `/projects/${id}/chapters/${readyChapter.id}`,
      label: type === "assignment" ? "Review assignment" : `Review Chapter ${readyChapter.number}`,
    };
  }

  if (status === "completed") {
    return { href: `/projects/${id}`, label: "Open & download" };
  }

  return { href: `/projects/${id}`, label: "Open project" };
}

export function resolveExportSigningSecret(params: {
  configuredSecret?: string;
  appEnv?: string;
}): string | null {
  const configured = params.configuredSecret?.trim();
  if (configured) return configured;
  if (params.appEnv?.trim() === "dev") {
    return "collate-local-dev-export-signing-secret";
  }
  return null;
}

/**
 * Lists all projects owned by `userId`, enriched with chapter progress,
 * verified source counts, export counts, and citation style using batched O(1) queries.
 */
export async function listEnrichedProjectsForUser(
  db: AppDb,
  userId: string
): Promise<{
  projects: DashboardProjectSummary[];
  attentionItems: DashboardAttentionItem[];
}> {
  if (!userId.trim()) {
    throw new Error("userId is required to load dashboard projects");
  }

  const projectRows = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt), desc(projects.createdAt));

  if (projectRows.length === 0) {
    return { projects: [], attentionItems: [] };
  }

  const projectIds = projectRows.map((p) => p.id);

  const [settingsRows, chapterRows, sourceCountRows, exportCountRows] = await Promise.all([
    db
      .select({
        projectId: projectSettings.projectId,
        citationStyle: projectSettings.citationStyle,
      })
      .from(projectSettings)
      .where(inArray(projectSettings.projectId, projectIds)),
    db
      .select({
        id: chapters.id,
        projectId: chapters.projectId,
        number: chapters.number,
        title: chapters.title,
        status: chapters.status,
        isAutoReferences: chapters.isAutoReferences,
        updatedAt: chapters.updatedAt,
      })
      .from(chapters)
      .where(inArray(chapters.projectId, projectIds))
      .orderBy(asc(chapters.number)),
    db
      .select({
        projectId: sources.projectId,
        count: sql<number>`count(*)`,
      })
      .from(sources)
      .where(inArray(sources.projectId, projectIds))
      .groupBy(sources.projectId),
    db
      .select({
        projectId: exportsTable.projectId,
        count: sql<number>`count(*)`,
      })
      .from(exportsTable)
      .where(inArray(exportsTable.projectId, projectIds))
      .groupBy(exportsTable.projectId),
  ]);

  const settingsByProject = new Map<string, CitationStyle>();
  for (const row of settingsRows) {
    settingsByProject.set(row.projectId, row.citationStyle);
  }

  const chaptersByProject = new Map<string, typeof chapterRows>();
  for (const row of chapterRows) {
    const existing = chaptersByProject.get(row.projectId);
    if (existing) {
      existing.push(row);
    } else {
      chaptersByProject.set(row.projectId, [row]);
    }
  }

  const sourceCountByProject = new Map<string, number>();
  for (const row of sourceCountRows) {
    sourceCountByProject.set(row.projectId, Number(row.count ?? 0));
  }

  const exportCountByProject = new Map<string, number>();
  for (const row of exportCountRows) {
    exportCountByProject.set(row.projectId, Number(row.count ?? 0));
  }

  const prioritizedAttention: Array<{
    priority: number;
    sortMs: number;
    item: DashboardAttentionItem;
  }> = [];

  const summaries: DashboardProjectSummary[] = projectRows.map((project) => {
    const projectChapters = chaptersByProject.get(project.id) ?? [];
    const writableChapters = projectChapters.filter((ch) => !ch.isAutoReferences);

    let chaptersReady = 0;
    let chaptersApproved = 0;
    let chaptersWriting = 0;
    let chaptersNeedsAttention = 0;

    for (const ch of writableChapters) {
      if (ch.status === "ready") chaptersReady += 1;
      else if (ch.status === "approved") chaptersApproved += 1;
      else if (ch.status === "queued" || ch.status === "writing") chaptersWriting += 1;
      else if (ch.status === "needs_attention") chaptersNeedsAttention += 1;

      if (project.status !== "archived") {
        if (ch.status === "needs_attention") {
          prioritizedAttention.push({
            priority: 1,
            sortMs: ch.updatedAt.getTime(),
            item: {
              id: `attn-ch-paused-${ch.id}`,
              projectId: project.id,
              projectTitle: project.title,
              projectType: project.type,
              kind: "chapter_needs_attention",
              tone: "warning",
              title:
                project.type === "assignment"
                  ? "Assignment draft paused"
                  : `Chapter ${ch.number} needs your review`,
              detail: ch.title,
              actionLabel: "Review draft",
              href: `/projects/${project.id}/chapters/${ch.id}`,
              updatedAt: ch.updatedAt.toISOString(),
            },
          });
        } else if (ch.status === "ready") {
          prioritizedAttention.push({
            priority: 2,
            sortMs: ch.updatedAt.getTime(),
            item: {
              id: `attn-ch-ready-${ch.id}`,
              projectId: project.id,
              projectTitle: project.title,
              projectType: project.type,
              kind: "chapter_ready",
              tone: "info",
              title:
                project.type === "assignment"
                  ? "Assignment ready to review"
                  : `Chapter ${ch.number} is ready for approval`,
              detail: ch.title,
              actionLabel: "Read & approve",
              href: `/projects/${project.id}/chapters/${ch.id}`,
              updatedAt: ch.updatedAt.toISOString(),
            },
          });
        }
      }
    }

    if (project.status === "needs_refinement" || project.status === "not_feasible") {
      prioritizedAttention.push({
        priority: 3,
        sortMs: project.updatedAt.getTime(),
        item: {
          id: `attn-proj-refine-${project.id}`,
          projectId: project.id,
          projectTitle: project.title,
          projectType: project.type,
          kind: "topic_refinement",
          tone: project.status === "not_feasible" ? "error" : "warning",
          title:
            project.status === "not_feasible"
              ? "Topic lacks enough credible sources"
              : "Topic needs refinement",
          detail: project.title,
          actionLabel: "Adjust topic",
          href: `/projects/${project.id}/setup`,
          updatedAt: project.updatedAt.toISOString(),
        },
      });
    } else if (project.status === "feasible") {
      prioritizedAttention.push({
        priority: 4,
        sortMs: project.updatedAt.getTime(),
        item: {
          id: `attn-proj-plan-${project.id}`,
          projectId: project.id,
          projectTitle: project.title,
          projectType: project.type,
          kind: "ready_to_plan",
          tone: "success",
          title: "Topic passed source check",
          detail: `Finish Step ${project.wizardStep} to lock your outline and start writing.`,
          actionLabel: "Continue setup",
          href: `/projects/${project.id}/setup`,
          updatedAt: project.updatedAt.toISOString(),
        },
      });
    }

    return {
      id: project.id,
      type: project.type,
      title: project.title,
      level: project.level,
      field: project.field,
      institution: project.institution,
      status: project.status,
      lifecycleTab: classifyProjectTab(project.status),
      wizardStep: project.wizardStep,
      targetPages: project.targetPages,
      idealPages: project.idealPages,
      citationStyle: settingsByProject.get(project.id) ?? "apa7",
      chaptersTotal: writableChapters.length,
      chaptersReady,
      chaptersApproved,
      chaptersWriting,
      chaptersNeedsAttention,
      sourcesCount: sourceCountByProject.get(project.id) ?? 0,
      exportsCount: exportCountByProject.get(project.id) ?? 0,
      nextAction: deriveProjectNextAction({
        id: project.id,
        type: project.type,
        status: project.status,
        wizardStep: project.wizardStep,
        chapters: projectChapters,
      }),
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  });

  prioritizedAttention.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.sortMs - a.sortMs;
  });

  return {
    projects: summaries,
    attentionItems: prioritizedAttention.slice(0, 6).map((entry) => entry.item),
  };
}

/**
 * Lists generated PDF and Word exports owned by `userId` across all projects,
 * enriched with fresh short-lived HMAC-signed download URLs when signing is configured.
 */
export async function listExportsForUser(
  db: AppDb,
  userId: string,
  options?: {
    signingSecret?: string | null;
    limit?: number;
    nowMs?: number;
  }
): Promise<UserExportItem[]> {
  if (!userId.trim()) {
    throw new Error("userId is required to list exports");
  }

  const limit = Math.max(1, Math.min(200, options?.limit ?? 100));
  const rows = await db
    .select({
      id: exportsTable.id,
      projectId: exportsTable.projectId,
      projectTitle: projects.title,
      projectType: projects.type,
      chapterId: exportsTable.chapterId,
      chapterNumber: chapters.number,
      chapterTitle: chapters.title,
      scope: exportsTable.scope,
      format: exportsTable.format,
      pageCount: exportsTable.pageCount,
      sizeBytes: exportsTable.sizeBytes,
      createdAt: exportsTable.createdAt,
    })
    .from(exportsTable)
    .innerJoin(projects, eq(exportsTable.projectId, projects.id))
    .leftJoin(chapters, eq(exportsTable.chapterId, chapters.id))
    .where(eq(projects.userId, userId))
    .orderBy(desc(exportsTable.createdAt))
    .limit(limit);

  const signingSecret = options?.signingSecret ?? null;
  const nowMs = options?.nowMs ?? Date.now();

  const items: UserExportItem[] = [];
  for (const row of rows) {
    let downloadUrl: string | null = null;
    if (signingSecret) {
      const signed = await signExportDownloadParams({
        exportId: row.id,
        projectId: row.projectId,
        userId,
        secret: signingSecret,
        nowMs,
      });
      downloadUrl = `/api/projects/${row.projectId}/exports/${row.id}/download?exp=${signed.exp}&sig=${signed.sig}`;
    }

    items.push({
      id: row.id,
      projectId: row.projectId,
      projectTitle: row.projectTitle,
      projectType: row.projectType,
      chapterId: row.chapterId,
      chapterNumber: row.chapterNumber,
      chapterTitle: row.chapterTitle,
      scope: row.scope,
      format: row.format,
      pageCount: row.pageCount,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString(),
      downloadUrl,
    });
  }

  return items;
}

/**
 * Loads the complete Overview dashboard payload for `userId`.
 */
export async function getDashboardOverviewForUser(
  db: AppDb,
  userId: string,
  options?: {
    signingSecret?: string | null;
    nowMs?: number;
  }
): Promise<DashboardOverviewData> {
  if (!userId.trim()) {
    throw new Error("userId is required to load dashboard overview");
  }

  const [{ projects: enrichedProjects, attentionItems }, recentExports, freeSweepsUsed] =
    await Promise.all([
      listEnrichedProjectsForUser(db, userId),
      listExportsForUser(db, userId, {
        signingSecret: options?.signingSecret ?? null,
        limit: 4,
        nowMs: options?.nowMs,
      }),
      countUserNonFailedSweeps(db, userId),
    ]);

  let activeProjects = 0;
  let completedProjects = 0;
  let archivedProjects = 0;
  let chaptersReadyForReview = 0;
  let chaptersCompleted = 0;
  let chaptersTotal = 0;
  let verifiedSourcesTotal = 0;
  let exportsTotal = 0;

  for (const project of enrichedProjects) {
    if (project.lifecycleTab === "completed") completedProjects += 1;
    else if (project.lifecycleTab === "archived") archivedProjects += 1;
    else activeProjects += 1;

    chaptersReadyForReview += project.chaptersReady + project.chaptersNeedsAttention;
    chaptersCompleted += project.chaptersReady + project.chaptersApproved;
    chaptersTotal += project.chaptersTotal;
    verifiedSourcesTotal += project.sourcesCount;
    exportsTotal += project.exportsCount;
  }

  const spotlightProject =
    enrichedProjects.find((p) => p.lifecycleTab === "active") ??
    enrichedProjects.find((p) => p.lifecycleTab === "completed") ??
    null;

  const freeSweepsRemaining = Math.max(
    0,
    BILLING_POLICY.freeFeasibilitySweepsPerUser - freeSweepsUsed
  );

  return {
    stats: {
      totalProjects: enrichedProjects.length,
      activeProjects,
      completedProjects,
      archivedProjects,
      chaptersReadyForReview,
      chaptersCompleted,
      chaptersTotal,
      verifiedSourcesTotal,
      exportsTotal,
      freeSweepsUsed,
      freeSweepsRemaining,
    },
    spotlightProject,
    attentionItems,
    recentProjects: enrichedProjects.slice(0, 4),
    recentExports,
  };
}
