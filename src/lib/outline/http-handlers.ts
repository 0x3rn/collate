import {
  getProjectOutlineForUser,
  OutlineError,
  saveConfirmedOutlineForUser,
  setOutlineLockForUser,
} from "@/db/queries/outline";
import { isAllowedOrigin, jsonNoStore, readSessionTokenFromRequest } from "@/lib/auth/cookies";
import type { HttpAuthDeps } from "@/lib/auth/http-handlers";
import { getSessionFromToken } from "@/lib/auth/service";
import { logEvent } from "@/lib/observability/logger";

async function requireSession(request: Request, deps: HttpAuthDeps) {
  const isProd = deps.appEnv === "prod";
  return getSessionFromToken(deps.db, readSessionTokenFromRequest(request, isProd), deps.nowFn);
}

function handleOutlineError(err: unknown, routeName: string): Response {
  if (err instanceof OutlineError) {
    return jsonNoStore({ ok: false, code: err.code, error: err.message }, err.status);
  }
  logEvent("error", `api_${routeName}_unhandled`, {
    data: { message: err instanceof Error ? err.message : String(err) },
  });
  return jsonNoStore({ ok: false, error: "An unexpected error occurred. Please try again." }, 500);
}

export async function handleGetOutline(
  request: Request,
  projectId: string,
  deps: HttpAuthDeps
): Promise<Response> {
  const session = await requireSession(request, deps);
  if (!session) {
    return jsonNoStore({ ok: false, error: "Authentication required." }, 401);
  }

  try {
    const result = await getProjectOutlineForUser(deps.db, session.user.id, projectId);
    if (!result) {
      return jsonNoStore({ ok: false, error: "Project not found." }, 404);
    }
    return jsonNoStore({ ok: true, ...result }, 200);
  } catch (err) {
    return handleOutlineError(err, "get_outline");
  }
}

export async function handleSaveOutline(
  request: Request,
  projectId: string,
  deps: HttpAuthDeps
): Promise<Response> {
  if (!isAllowedOrigin(request, deps.appUrl)) {
    return jsonNoStore({ ok: false, error: "Forbidden cross-origin request." }, 403);
  }

  const session = await requireSession(request, deps);
  if (!session) {
    return jsonNoStore({ ok: false, error: "Authentication required." }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
  }

  try {
    const now = (deps.nowFn ?? (() => new Date()))();
    const saved = await saveConfirmedOutlineForUser(deps.db, session.user.id, projectId, body, now);
    return jsonNoStore({ ok: true, ...saved }, 200);
  } catch (err) {
    return handleOutlineError(err, "save_outline");
  }
}

export async function handleUnlockOutline(
  request: Request,
  projectId: string,
  deps: HttpAuthDeps
): Promise<Response> {
  if (!isAllowedOrigin(request, deps.appUrl)) {
    return jsonNoStore({ ok: false, error: "Forbidden cross-origin request." }, 403);
  }

  const session = await requireSession(request, deps);
  if (!session) {
    return jsonNoStore({ ok: false, error: "Authentication required." }, 401);
  }

  try {
    const now = (deps.nowFn ?? (() => new Date()))();
    const res = await setOutlineLockForUser(deps.db, session.user.id, projectId, false, now);
    return jsonNoStore({ ok: true, ...res }, 200);
  } catch (err) {
    return handleOutlineError(err, "unlock_outline");
  }
}
