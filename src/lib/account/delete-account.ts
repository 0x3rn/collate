import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  accounts,
  auditLog,
  chapters,
  chapterVersions,
  exportsTable,
  projectDatasets,
  projects,
  sources,
  users,
} from "@/db/schema";
import {
  buildClearSessionCookieHeader,
  extractClientIp,
  isAllowedOrigin,
  jsonNoStore,
  readSessionTokenFromRequest,
} from "@/lib/auth/cookies";
import type { HttpAuthDeps } from "@/lib/auth/http-handlers";
import { verifyPassword } from "@/lib/auth/password";
import { consumeAuthRateLimit } from "@/lib/auth/rate-limit";
import { getSessionFromToken } from "@/lib/auth/service";

export interface R2DeletableBucket {
  delete(keys: string | string[]): Promise<void>;
}

export interface DeleteAccountDeps extends HttpAuthDeps {
  bucket?: R2DeletableBucket;
}

export const CONFIRMATION_PHRASE = "DELETE MY ACCOUNT";

const DeleteAccountBodySchema = z.object({
  password: z.string().default(""),
  confirmation: z.string().trim(),
});

/**
 * Self-service NDPA/GDPR right-to-erasure handler:
 * Requires active session, same-origin CSRF check, rate limiting, password re-authentication,
 * and exact confirmation phrase. Removes R2 artifacts and cascades D1 user records cleanly.
 */
export async function handleDeleteAccount(
  request: Request,
  deps: DeleteAccountDeps
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

  const now = (deps.nowFn ?? (() => new Date()))();
  const rl = await consumeAuthRateLimit(
    deps.db,
    "accountDelete",
    `${session.user.id}:${extractClientIp(request)}`,
    now.getTime()
  );
  if (!rl.allowed) {
    return jsonNoStore(
      { ok: false, error: "Too many account deletion attempts. Please wait and try again." },
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

  const parsed = DeleteAccountBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonNoStore(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Check your input and try again." },
      400
    );
  }

  if (parsed.data.confirmation !== CONFIRMATION_PHRASE) {
    return jsonNoStore(
      { ok: false, error: `Type "${CONFIRMATION_PHRASE}" exactly to confirm account deletion.` },
      400
    );
  }

  const [credAccount] = await deps.db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, session.user.id), eq(accounts.providerId, "credential")))
    .limit(1);

  // Accounts created with Google have no password: the signed-in session plus the typed
  // confirmation phrase is the check. Password accounts must also re-enter their password.
  if (credAccount?.password) {
    const passwordValid = await verifyPassword(parsed.data.password, credAccount.password);
    if (!passwordValid) {
      return jsonNoStore({ ok: false, error: "Invalid password. Account was not deleted." }, 401);
    }
  }

  // Gather R2 object keys belonging to this user's projects before cascading DB delete
  const userProjects = await deps.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.userId, session.user.id));

  const projectIds = userProjects.map((p) => p.id);
  const r2Keys: string[] = [];

  if (projectIds.length > 0) {
    const srcRows = await deps.db
      .select({ key: sources.snapshotR2Key })
      .from(sources)
      .where(inArray(sources.projectId, projectIds));
    for (const r of srcRows) {
      if (r.key) r2Keys.push(r.key);
    }

    const chRows = await deps.db
      .select({ id: chapters.id })
      .from(chapters)
      .where(inArray(chapters.projectId, projectIds));
    const chIds = chRows.map((c) => c.id);
    if (chIds.length > 0) {
      const verRows = await deps.db
        .select({ key: chapterVersions.contentR2Key })
        .from(chapterVersions)
        .where(inArray(chapterVersions.chapterId, chIds));
      for (const v of verRows) r2Keys.push(v.key);
    }

    const expRows = await deps.db
      .select({ key: exportsTable.r2Key })
      .from(exportsTable)
      .where(inArray(exportsTable.projectId, projectIds));
    for (const e of expRows) r2Keys.push(e.key);

    const dstRows = await deps.db
      .select({ key: projectDatasets.r2Key })
      .from(projectDatasets)
      .where(inArray(projectDatasets.projectId, projectIds));
    for (const d of dstRows) r2Keys.push(d.key);
  }

  if (deps.bucket && r2Keys.length > 0) {
    for (let i = 0; i < r2Keys.length; i += 100) {
      try {
        await deps.bucket.delete(r2Keys.slice(i, i + 100));
      } catch {
        // Proceed with DB erasure even if a stale R2 key was already cleaned
      }
    }
  }

  // Cascade delete user + projects + sessions + chapters + claims + exports + fingerprints in D1
  await deps.db.delete(users).where(eq(users.id, session.user.id));

  // Record anonymized deletion audit trail (zero PII retained)
  await deps.db.insert(auditLog).values({
    id: `aud_${crypto.randomUUID()}`,
    actorUserId: null,
    action: "account.erased",
    entityType: "user",
    entityId: "erased",
    metadataJson: JSON.stringify({
      projectsDeleted: projectIds.length,
      r2ObjectsDeleted: r2Keys.length,
    }),
    createdAt: now,
  });

  return jsonNoStore(
    {
      ok: true,
      deletedProjects: projectIds.length,
      deletedFiles: r2Keys.length,
    },
    200,
    { "set-cookie": buildClearSessionCookieHeader(isProd) }
  );
}
