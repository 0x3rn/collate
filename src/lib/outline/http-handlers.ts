import { z } from "zod";
import {
  getProjectOutlineForUser,
  OutlineError,
  saveConfirmedOutlineForUser,
  setOutlineLockForUser,
  suggestAndPersistOutlineForUser,
} from "@/db/queries/outline";
import type { CallLLMContext } from "@/lib/ai/call-llm";
import { isAllowedOrigin, jsonNoStore, readSessionTokenFromRequest } from "@/lib/auth/cookies";
import type { HttpAuthDeps } from "@/lib/auth/http-handlers";
import { getSessionFromToken } from "@/lib/auth/service";
import { logEvent } from "@/lib/observability/logger";
import { serializeWizardState } from "@/lib/wizard/http-handlers";

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

const SuggestOutlineBodySchema = z
  .object({
    resetToDefault: z.boolean().optional(),
    desiredUnitCount: z.number().int().min(3).max(8).optional(),
  })
  .optional();

export interface OutlineSuggestHttpDeps extends HttpAuthDeps {
  llmCtx?: CallLLMContext;
}

export async function handleSuggestOutline(
  request: Request,
  projectId: string,
  deps: OutlineSuggestHttpDeps
): Promise<Response> {
  if (!isAllowedOrigin(request, deps.appUrl)) {
    return jsonNoStore({ ok: false, error: "Forbidden cross-origin request." }, 403);
  }

  const session = await requireSession(request, deps);
  if (!session) {
    return jsonNoStore({ ok: false, error: "Authentication required." }, 401);
  }

  let body: z.infer<typeof SuggestOutlineBodySchema> = undefined;
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const rawText = await request.text();
      if (rawText.trim()) {
        const parsed = SuggestOutlineBodySchema.safeParse(JSON.parse(rawText));
        if (!parsed.success) {
          return jsonNoStore(
            { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request body." },
            400
          );
        }
        body = parsed.data;
      }
    } catch {
      return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
    }
  }

  try {
    const now = (deps.nowFn ?? (() => new Date()))();
    const result = await suggestAndPersistOutlineForUser(deps.db, session.user.id, projectId, {
      resetToDefault: body?.resetToDefault,
      desiredUnitCount: body?.desiredUnitCount,
      llmCtx: deps.llmCtx,
      now,
    });
    return jsonNoStore(
      {
        ok: true,
        usedAi: result.usedAi,
        outline: result.outline,
        wizard: serializeWizardState(result.wizard),
      },
      200
    );
  } catch (err) {
    return handleOutlineError(err, "suggest_outline");
  }
}
