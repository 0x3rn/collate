import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getWizardStateForUser } from "@/db/queries/wizard";
import { projectFigures } from "@/db/schema";
import {
  extractClientIp,
  isAllowedOrigin,
  jsonNoStore,
  readSessionTokenFromRequest,
} from "@/lib/auth/cookies";
import type { HttpAuthDeps } from "@/lib/auth/http-handlers";
import { consumeAuthRateLimit } from "@/lib/auth/rate-limit";
import { getSessionFromToken } from "@/lib/auth/service";
import { formatFigureAttributionForDisplay } from "@/lib/export/figure-layout";
import { searchWikimediaAcademicImages } from "@/lib/research/connectors/wikimedia-images";

const FigureSearchSchema = z.object({
  query: z.string().trim().min(2, "Enter at least 2 characters to search images.").max(160),
  limit: z.number().int().min(1).max(10).default(6),
});

export async function handleListProjectFigures(
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

  const wizard = await getWizardStateForUser(deps.db, session.user.id, projectId);
  if (!wizard) {
    return jsonNoStore({ ok: false, error: "Project not found." }, 404);
  }

  const rows = await deps.db
    .select()
    .from(projectFigures)
    .where(eq(projectFigures.projectId, projectId))
    .orderBy(desc(projectFigures.createdAt))
    .limit(24);

  return jsonNoStore(
    {
      ok: true,
      figures: rows.map((f) => ({
        id: f.id,
        url: f.url,
        sourcePageUrl: f.sourcePageUrl,
        title: f.title,
        alt: f.alt,
        caption: f.caption,
        attribution: formatFigureAttributionForDisplay(f.attribution, f.sourcePageUrl).displayText,
        license: f.license,
        mimeType: f.mimeType,
        naturalWidth: f.naturalWidth,
        naturalHeight: f.naturalHeight,
      })),
    },
    200
  );
}

export async function handleSearchProjectFigures(
  request: Request,
  projectId: string,
  deps: HttpAuthDeps
): Promise<Response> {
  if (!isAllowedOrigin(request, deps.appUrl)) {
    return jsonNoStore({ ok: false, error: "Forbidden cross-origin request." }, 403);
  }

  const isProd = deps.appEnv === "prod";
  const session = await getSessionFromToken(
    deps.db,
    readSessionTokenFromRequest(request, isProd),
    deps.nowFn
  );
  if (!session) {
    return jsonNoStore({ ok: false, error: "Authentication required." }, 401);
  }

  const wizard = await getWizardStateForUser(deps.db, session.user.id, projectId);
  if (!wizard) {
    return jsonNoStore({ ok: false, error: "Project not found." }, 404);
  }

  const now = (deps.nowFn ?? (() => new Date()))();
  const rl = await consumeAuthRateLimit(
    deps.db,
    "figureSearch",
    `${session.user.id}:${extractClientIp(request)}`,
    now.getTime()
  );
  if (!rl.allowed) {
    return jsonNoStore(
      { ok: false, error: "Too many image searches right now. Please try again shortly." },
      429,
      { "retry-after": String(rl.retryAfterSeconds) }
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
  }

  const parsed = FigureSearchSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonNoStore(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Enter an image search term." },
      400
    );
  }

  const found = await searchWikimediaAcademicImages({
    query: parsed.data.query,
    limit: parsed.data.limit,
    fetchFn: deps.fetchFn,
  });

  const persisted = [];
  for (const img of found) {
    const id = `fig_${crypto.randomUUID()}`;
    await deps.db
      .insert(projectFigures)
      .values({
        id,
        projectId,
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

    persisted.push({ id, ...img });
  }

  return jsonNoStore({ ok: true, figures: persisted }, 200);
}
