import { and, eq, inArray } from "drizzle-orm";
import {
  auditLog,
  chapters,
  chapterVersions,
  exportsTable,
  projectDatasets,
  projects,
  researchRuns,
  sources,
} from "@/db/schema";
import {
  extractClientIp,
  isAllowedOrigin,
  jsonNoStore,
  readSessionTokenFromRequest,
} from "@/lib/auth/cookies";
import type { HttpAuthDeps } from "@/lib/auth/http-handlers";
import { consumeAuthRateLimit } from "@/lib/auth/rate-limit";
import { getSessionFromToken } from "@/lib/auth/service";
import type { R2DeletableBucket } from "./delete-account";

export interface DeleteProjectDeps extends HttpAuthDeps {
  bucket?: R2DeletableBucket;
}

const BUSY_CHAPTER_STATUSES = new Set(["queued", "writing"]);
const BUSY_RESEARCH_STATUSES = new Set(["queued", "planning", "searching", "fetching", "scoring"]);

/**
 * DELETE /api/projects/:id: permanently deletes one of the signed-in user's projects, its
 * chapters, sources, datasets and exports, and their stored files. Credit history and payments
 * are kept (they only lose the link to the project). Refused while a chapter is being written or
 * a source check is running, so a background job never writes into a deleted project.
 */
export async function handleDeleteProject(
  request: Request,
  projectId: string,
  deps: DeleteProjectDeps
): Promise<Response> {
  if (!isAllowedOrigin(request, deps.appUrl)) {
    return jsonNoStore({ ok: false, error: "Forbidden cross-origin request." }, 403);
  }
  const session = await getSessionFromToken(
    deps.db,
    readSessionTokenFromRequest(request, deps.appEnv === "prod"),
    deps.nowFn
  );
  if (!session) return jsonNoStore({ ok: false, error: "Authentication required." }, 401);

  const now = (deps.nowFn ?? (() => new Date()))();
  const rl = await consumeAuthRateLimit(
    deps.db,
    "projectDelete",
    `${session.user.id}:${extractClientIp(request)}`,
    now.getTime()
  );
  if (!rl.allowed) {
    return jsonNoStore(
      { ok: false, error: "Too many deletions. Please wait and try again." },
      429,
      {
        "retry-after": String(rl.retryAfterSeconds),
      }
    );
  }

  // Ownership: a project id belonging to someone else looks exactly like a missing one.
  const [project] = await deps.db
    .select({ id: projects.id, title: projects.title })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, session.user.id)))
    .limit(1);
  if (!project) return jsonNoStore({ ok: false, error: "Project not found." }, 404);

  const chapterRows = await deps.db
    .select({ id: chapters.id, status: chapters.status })
    .from(chapters)
    .where(eq(chapters.projectId, project.id));
  const runRows = await deps.db
    .select({ status: researchRuns.status })
    .from(researchRuns)
    .where(eq(researchRuns.projectId, project.id));
  if (
    chapterRows.some((c) => BUSY_CHAPTER_STATUSES.has(c.status)) ||
    runRows.some((r) => BUSY_RESEARCH_STATUSES.has(r.status))
  ) {
    return jsonNoStore(
      {
        ok: false,
        error: "This project is still being worked on. Wait for it to finish, then delete it.",
      },
      409
    );
  }

  const r2Keys: string[] = [];
  for (const r of await deps.db
    .select({ key: sources.snapshotR2Key })
    .from(sources)
    .where(eq(sources.projectId, project.id))) {
    if (r.key) r2Keys.push(r.key);
  }
  const chapterIds = chapterRows.map((c) => c.id);
  if (chapterIds.length > 0) {
    for (const v of await deps.db
      .select({ key: chapterVersions.contentR2Key })
      .from(chapterVersions)
      .where(inArray(chapterVersions.chapterId, chapterIds))) {
      r2Keys.push(v.key);
    }
  }
  for (const e of await deps.db
    .select({ key: exportsTable.r2Key })
    .from(exportsTable)
    .where(eq(exportsTable.projectId, project.id))) {
    r2Keys.push(e.key);
  }
  for (const d of await deps.db
    .select({ key: projectDatasets.r2Key })
    .from(projectDatasets)
    .where(eq(projectDatasets.projectId, project.id))) {
    r2Keys.push(d.key);
  }

  // Database first: if a stored file fails to delete it is only an orphaned file, never a
  // project that half exists.
  await deps.db
    .delete(projects)
    .where(and(eq(projects.id, project.id), eq(projects.userId, session.user.id)));

  let filesDeleted = 0;
  if (deps.bucket) {
    for (let i = 0; i < r2Keys.length; i += 100) {
      const batch = r2Keys.slice(i, i + 100);
      try {
        await deps.bucket.delete(batch);
        filesDeleted += batch.length;
      } catch {
        // Stale keys are harmless; the database rows are already gone.
      }
    }
  }

  await deps.db.insert(auditLog).values({
    id: `aud_${crypto.randomUUID()}`,
    actorUserId: session.user.id,
    action: "project.deleted",
    entityType: "project",
    entityId: project.id,
    metadataJson: JSON.stringify({ chapters: chapterIds.length, files: filesDeleted }),
    createdAt: now,
  });

  return jsonNoStore({ ok: true, deleted: project.id }, 200);
}
