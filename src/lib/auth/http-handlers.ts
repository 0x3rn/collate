import { z } from "zod";
import type { AppDb } from "@/db/client";
import { getProjectForUser, listProjectsForUser } from "@/db/queries/projects";
import type { ProjectRecord } from "@/db/schema";
import type { EmailSender } from "@/lib/email/mailer";
import { logEvent } from "@/lib/observability/logger";
import {
  buildClearSessionCookieHeader,
  buildSessionCookieHeader,
  extractClientIp,
  isAllowedOrigin,
  jsonNoStore,
  readSessionTokenFromRequest,
} from "./cookies";
import {
  AuthError,
  getSessionFromToken,
  requestPasswordReset,
  resendVerificationEmail,
  resetPasswordWithToken,
  SESSION_TTL_MS,
  signInUser,
  signOutByToken,
  signUpUser,
  verifyEmailToken,
  type AuthServiceContext,
  type PublicUser,
} from "./service";

export interface HttpAuthDeps {
  db: AppDb;
  mailer: EmailSender;
  appUrl: string;
  appEnv: string;
  turnstileSecretKey?: string;
  nowFn?: () => Date;
  fetchFn?: typeof fetch;
}

function serializeUser(user: PublicUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    creditsBalance: user.creditsBalance,
    createdAt: user.createdAt.toISOString(),
  };
}

function serializeProject(project: ProjectRecord) {
  return {
    id: project.id,
    type: project.type,
    title: project.title,
    level: project.level,
    field: project.field,
    institution: project.institution,
    status: project.status,
    targetPages: project.targetPages,
    idealPages: project.idealPages,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function buildServiceCtx(request: Request, deps: HttpAuthDeps): AuthServiceContext {
  return {
    db: deps.db,
    mailer: deps.mailer,
    appUrl: deps.appUrl,
    clientIp: extractClientIp(request),
    userAgent: request.headers.get("user-agent") ?? undefined,
    turnstileSecretKey: deps.turnstileSecretKey,
    appEnv: deps.appEnv,
    nowFn: deps.nowFn,
    fetchFn: deps.fetchFn,
  };
}

async function readJsonBody(
  request: Request
): Promise<{ ok: true; data: unknown } | { ok: false }> {
  try {
    const data: unknown = await request.json();
    return { ok: true, data };
  } catch {
    return { ok: false };
  }
}

function handleRouteError(err: unknown, routeName: string): Response {
  if (err instanceof AuthError) {
    const headers: Record<string, string> = {};
    if (err.retryAfterSeconds) {
      headers["retry-after"] = String(err.retryAfterSeconds);
    }
    return jsonNoStore({ ok: false, code: err.code, error: err.message }, err.status, headers);
  }

  logEvent("error", `api_${routeName}_unhandled`, {
    data: { message: err instanceof Error ? err.message : String(err) },
  });
  return jsonNoStore({ ok: false, error: "An unexpected error occurred. Please try again." }, 500);
}

function checkCsrfOrigin(request: Request, deps: HttpAuthDeps): Response | null {
  if (!isAllowedOrigin(request, deps.appUrl)) {
    return jsonNoStore({ ok: false, error: "Forbidden cross-origin request." }, 403);
  }
  return null;
}

export async function handleSignUp(request: Request, deps: HttpAuthDeps): Promise<Response> {
  const csrfErr = checkCsrfOrigin(request, deps);
  if (csrfErr) return csrfErr;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
  }

  try {
    const result = await signUpUser(parsed.data, buildServiceCtx(request, deps));
    return jsonNoStore({ ok: true, message: result.message }, 201);
  } catch (err) {
    return handleRouteError(err, "signup");
  }
}

const VerifyTokenBodySchema = z.object({
  token: z.string().trim().min(1, "Verification token is required."),
});

export async function handleVerifyEmail(request: Request, deps: HttpAuthDeps): Promise<Response> {
  const csrfErr = checkCsrfOrigin(request, deps);
  if (csrfErr) return csrfErr;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
  }

  const body = VerifyTokenBodySchema.safeParse(parsed.data);
  if (!body.success) {
    return jsonNoStore(
      { ok: false, error: body.error.issues[0]?.message ?? "Verification token is required." },
      400
    );
  }

  try {
    await verifyEmailToken(body.data.token, { db: deps.db, nowFn: deps.nowFn });
    return jsonNoStore({ ok: true, message: "Your email is verified. You can sign in now." }, 200);
  } catch (err) {
    return handleRouteError(err, "verify_email");
  }
}

const EmailOnlyBodySchema = z.object({
  email: z.string().trim().min(1, "Enter your email address."),
});

export async function handleResendVerification(
  request: Request,
  deps: HttpAuthDeps
): Promise<Response> {
  const csrfErr = checkCsrfOrigin(request, deps);
  if (csrfErr) return csrfErr;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
  }

  const body = EmailOnlyBodySchema.safeParse(parsed.data);
  if (!body.success) {
    return jsonNoStore({ ok: false, error: "Enter a valid email address." }, 400);
  }

  try {
    const result = await resendVerificationEmail(body.data.email, buildServiceCtx(request, deps));
    return jsonNoStore({ ok: true, message: result.message }, 200);
  } catch (err) {
    return handleRouteError(err, "resend_verification");
  }
}

export async function handleSignIn(request: Request, deps: HttpAuthDeps): Promise<Response> {
  const csrfErr = checkCsrfOrigin(request, deps);
  if (csrfErr) return csrfErr;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
  }

  try {
    const result = await signInUser(parsed.data, buildServiceCtx(request, deps));
    const isProd = deps.appEnv === "prod";
    const cookieHeader = buildSessionCookieHeader(
      result.rawSessionToken,
      Math.floor(SESSION_TTL_MS / 1000),
      isProd
    );

    return jsonNoStore({ ok: true, user: serializeUser(result.user) }, 200, {
      "set-cookie": cookieHeader,
    });
  } catch (err) {
    return handleRouteError(err, "signin");
  }
}

export async function handleSignOut(request: Request, deps: HttpAuthDeps): Promise<Response> {
  const csrfErr = checkCsrfOrigin(request, deps);
  if (csrfErr) return csrfErr;

  const isProd = deps.appEnv === "prod";
  const rawToken = readSessionTokenFromRequest(request, isProd);

  try {
    await signOutByToken(deps.db, rawToken, deps.nowFn);
    return jsonNoStore({ ok: true }, 200, { "set-cookie": buildClearSessionCookieHeader(isProd) });
  } catch (err) {
    return handleRouteError(err, "signout");
  }
}

export async function handleGetMe(request: Request, deps: HttpAuthDeps): Promise<Response> {
  const isProd = deps.appEnv === "prod";
  const rawToken = readSessionTokenFromRequest(request, isProd);

  try {
    const session = await getSessionFromToken(deps.db, rawToken, deps.nowFn);
    if (!session) {
      return jsonNoStore({ ok: false, error: "Authentication required." }, 401);
    }
    return jsonNoStore({ ok: true, user: serializeUser(session.user) }, 200);
  } catch (err) {
    return handleRouteError(err, "me");
  }
}

export async function handleForgotPassword(
  request: Request,
  deps: HttpAuthDeps
): Promise<Response> {
  const csrfErr = checkCsrfOrigin(request, deps);
  if (csrfErr) return csrfErr;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
  }

  const body = EmailOnlyBodySchema.safeParse(parsed.data);
  if (!body.success) {
    return jsonNoStore({ ok: false, error: "Enter a valid email address." }, 400);
  }

  try {
    const result = await requestPasswordReset(body.data.email, buildServiceCtx(request, deps));
    return jsonNoStore({ ok: true, message: result.message }, 200);
  } catch (err) {
    return handleRouteError(err, "forgot_password");
  }
}

export async function handleResetPassword(request: Request, deps: HttpAuthDeps): Promise<Response> {
  const csrfErr = checkCsrfOrigin(request, deps);
  if (csrfErr) return csrfErr;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return jsonNoStore({ ok: false, error: "Invalid JSON request body." }, 400);
  }

  try {
    await resetPasswordWithToken(parsed.data, { db: deps.db, nowFn: deps.nowFn });
    const isProd = deps.appEnv === "prod";
    return jsonNoStore(
      { ok: true, message: "Your password has been updated. Sign in with your new password." },
      200,
      { "set-cookie": buildClearSessionCookieHeader(isProd) }
    );
  } catch (err) {
    return handleRouteError(err, "reset_password");
  }
}

export async function handleListProjects(request: Request, deps: HttpAuthDeps): Promise<Response> {
  const isProd = deps.appEnv === "prod";
  const rawToken = readSessionTokenFromRequest(request, isProd);

  try {
    const session = await getSessionFromToken(deps.db, rawToken, deps.nowFn);
    if (!session) {
      return jsonNoStore({ ok: false, error: "Authentication required." }, 401);
    }

    const items = await listProjectsForUser(deps.db, session.user.id);
    return jsonNoStore({ ok: true, projects: items.map(serializeProject) }, 200);
  } catch (err) {
    return handleRouteError(err, "list_projects");
  }
}

const ProjectIdSchema = z.string().trim().min(1).max(120);

export async function handleGetProjectById(
  request: Request,
  rawProjectId: string,
  deps: HttpAuthDeps
): Promise<Response> {
  const isProd = deps.appEnv === "prod";
  const rawToken = readSessionTokenFromRequest(request, isProd);

  const parsedId = ProjectIdSchema.safeParse(rawProjectId);
  if (!parsedId.success) {
    return jsonNoStore({ ok: false, error: "Invalid project ID." }, 400);
  }

  try {
    const session = await getSessionFromToken(deps.db, rawToken, deps.nowFn);
    if (!session) {
      return jsonNoStore({ ok: false, error: "Authentication required." }, 401);
    }

    // Object-level authorization: returns 404 both when missing and when owned by another user.
    const project = await getProjectForUser(deps.db, session.user.id, parsedId.data);
    if (!project) {
      return jsonNoStore({ ok: false, error: "Project not found." }, 404);
    }

    return jsonNoStore({ ok: true, project: serializeProject(project) }, 200);
  } catch (err) {
    return handleRouteError(err, "get_project");
  }
}
