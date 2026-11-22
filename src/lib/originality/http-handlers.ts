import { desc, eq } from "drizzle-orm";
import { getProjectForUser } from "@/db/queries/projects";
import { originalityReports, projectSettings } from "@/db/schema";
import { jsonNoStore, readSessionTokenFromRequest } from "@/lib/auth/cookies";
import type { HttpAuthDeps } from "@/lib/auth/http-handlers";
import { getSessionFromToken } from "@/lib/auth/service";
import { buildWritingProcessLog, generateAiDisclosureStatement } from "./integrity-exports";

export async function handleGetProjectIntegrity(
  request: Request,
  projectId: string,
  deps: HttpAuthDeps
): Promise<Response> {
  const isProd = deps.appEnv === "prod";
  const session = await getSessionFromToken(
    deps.db,
    readSessionTokenFromRequest(request, isProd),
    deps.nowFn
  );
  if (!session) {
    return jsonNoStore({ ok: false, error: "Authentication required." }, 401);
  }

  const project = await getProjectForUser(deps.db, session.user.id, projectId);
  if (!project) {
    return jsonNoStore({ ok: false, error: "Project not found." }, 404);
  }

  const now = (deps.nowFn ?? (() => new Date()))();
  const processLog = await buildWritingProcessLog(deps.db, project.id, now);
  if (!processLog) {
    return jsonNoStore({ ok: false, error: "Project not found." }, 404);
  }

  const [settings] = await dbSelectSettings(deps, project.id);

  let authorName: string | null = session.user.name;
  if (settings?.coverJson) {
    try {
      const parsed = JSON.parse(settings.coverJson) as { authorName?: string };
      if (parsed.authorName?.trim()) authorName = parsed.authorName.trim();
    } catch {
      // Keep user's account name
    }
  }

  const reports = await deps.db
    .select()
    .from(originalityReports)
    .where(eq(originalityReports.projectId, project.id))
    .orderBy(desc(originalityReports.createdAt));

  const disclosureStatement = generateAiDisclosureStatement({
    authorName,
    institution: project.institution,
    projectTitle: project.title,
    citationStyle: processLog.project.citationStyle,
    verifiedSourceCount: processLog.verifiedSourcesUsed.length,
  });

  return jsonNoStore(
    {
      ok: true,
      processLog,
      disclosureStatement,
      similarityReports: reports.map((r) => {
        let flaggedSpans: unknown[];
        try {
          flaggedSpans = JSON.parse(r.flaggedSpansJson) as unknown[];
        } catch {
          flaggedSpans = [];
        }
        return {
          id: r.id,
          chapterId: r.chapterId,
          chapterVersionId: r.chapterVersionId,
          overlapScore: r.overlapScore,
          semanticScore: r.semanticScore,
          quoteSharePct: r.quoteSharePct,
          crossUserScore: r.crossUserScore,
          flaggedCount: flaggedSpans.length,
          passed: r.passed,
          waived: r.waived,
          createdAt: r.createdAt.toISOString(),
        };
      }),
    },
    200
  );
}

async function dbSelectSettings(deps: HttpAuthDeps, projectId: string) {
  return deps.db
    .select()
    .from(projectSettings)
    .where(eq(projectSettings.projectId, projectId))
    .limit(1);
}
