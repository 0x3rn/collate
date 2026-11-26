import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { accounts, auditLog, sessions, users } from "@/db/schema";
import {
  extractClientIp,
  isAllowedOrigin,
  jsonNoStore,
  readSessionTokenFromRequest,
} from "@/lib/auth/cookies";
import {
  checkCode,
  clearCodes,
  codeErrorMessage,
  grantMarker,
  hasMarker,
  issueCode,
} from "@/lib/auth/codes";
import type { HttpAuthDeps } from "@/lib/auth/http-handlers";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth/password";
import { consumeAuthRateLimit, type AuthRateLimitAction } from "@/lib/auth/rate-limit";
import { EmailSchema, getSessionFromToken, type PublicUser } from "@/lib/auth/service";
import { buildEmailChangeCodeEmail, buildSecurityNoticeEmail } from "@/lib/email/mailer";
import { logEvent } from "@/lib/observability/logger";
import { describeDevice, describeLocation } from "./device";

/**
 * Signed-in account security: name, password, email address and active sessions.
 * Every handler requires a valid session and a same-origin request, and is rate limited.
 */

type Authed = { sessionId: string; user: PublicUser; now: Date };

async function requireSession(
  request: Request,
  deps: HttpAuthDeps,
  limit: AuthRateLimitAction | null
): Promise<{ ok: true; auth: Authed } | { ok: false; response: Response }> {
  if (!isAllowedOrigin(request, deps.appUrl)) {
    return {
      ok: false,
      response: jsonNoStore({ ok: false, error: "Forbidden cross-origin request." }, 403),
    };
  }
  const session = await getSessionFromToken(
    deps.db,
    readSessionTokenFromRequest(request, deps.appEnv === "prod"),
    deps.nowFn
  );
  if (!session) {
    return {
      ok: false,
      response: jsonNoStore({ ok: false, error: "Authentication required." }, 401),
    };
  }
  const now = (deps.nowFn ?? (() => new Date()))();
  if (limit) {
    const rl = await consumeAuthRateLimit(
      deps.db,
      limit,
      `${session.user.id}:${extractClientIp(request)}`,
      now.getTime()
    );
    if (!rl.allowed) {
      return {
        ok: false,
        response: jsonNoStore(
          { ok: false, error: "Too many attempts. Please wait a few minutes and try again." },
          429,
          { "retry-after": String(rl.retryAfterSeconds) }
        ),
      };
    }
  }
  return { ok: true, auth: { ...session, now } };
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function badRequest(error: string): Response {
  return jsonNoStore({ ok: false, error }, 400);
}

async function audit(
  deps: HttpAuthDeps,
  auth: Authed,
  action: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await deps.db.insert(auditLog).values({
    id: `aud_${crypto.randomUUID()}`,
    actorUserId: auth.user.id,
    action,
    entityType: "user",
    entityId: auth.user.id,
    metadataJson: metadata ? JSON.stringify(metadata) : null,
    createdAt: auth.now,
  });
}

async function notify(
  deps: HttpAuthDeps,
  to: string,
  name: string,
  subject: string,
  message: string
) {
  const result = await deps.mailer.send({
    to,
    ...buildSecurityNoticeEmail({ name, subject, message }),
  });
  if (!result.ok) {
    logEvent("error", "account_security_email_failed", { data: { subject, error: result.error } });
  }
}

// ── Name ────────────────────────────────────────────────────────────────────

const NameSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name (at least 2 characters).").max(100),
});

export async function handleUpdateName(request: Request, deps: HttpAuthDeps): Promise<Response> {
  const gate = await requireSession(request, deps, "accountChange");
  if (!gate.ok) return gate.response;
  const parsed = NameSchema.safeParse(await readBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Enter your name.");
  await deps.db
    .update(users)
    .set({ name: parsed.data.name, updatedAt: gate.auth.now })
    .where(eq(users.id, gate.auth.user.id));
  await audit(deps, gate.auth, "account.name_changed");
  return jsonNoStore({ ok: true, name: parsed.data.name }, 200);
}

// ── Password ────────────────────────────────────────────────────────────────

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: z.string().min(1, "Enter a new password."),
});

/** Changes the password with the current one; signs out every other device. */
export async function handleChangePassword(
  request: Request,
  deps: HttpAuthDeps
): Promise<Response> {
  const gate = await requireSession(request, deps, "accountChange");
  if (!gate.ok) return gate.response;
  const { auth } = gate;
  const parsed = ChangePasswordSchema.safeParse(await readBody(request));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Check your input.");

  const [account] = await deps.db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, auth.user.id), eq(accounts.providerId, "credential")))
    .limit(1);
  if (!account?.password) {
    return badRequest(
      "Your account uses Google sign-in and has no password yet. Use “Forgot password?” to set one."
    );
  }
  if (!(await verifyPassword(parsed.data.currentPassword, account.password))) {
    await audit(deps, auth, "account.password_change_failed");
    return jsonNoStore({ ok: false, error: "Your current password is not right." }, 401);
  }
  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return badRequest("Choose a password you have not used for this account.");
  }
  const strength = validatePasswordStrength(parsed.data.newPassword, auth.user.email);
  if (!strength.valid) return badRequest(strength.reason ?? "That password is too weak.");

  await deps.db
    .update(accounts)
    .set({ password: await hashPassword(parsed.data.newPassword), updatedAt: auth.now })
    .where(eq(accounts.id, account.id));
  await deps.db
    .delete(sessions)
    .where(and(eq(sessions.userId, auth.user.id), ne(sessions.id, auth.sessionId)));
  await clearCodes(deps.db, { userId: auth.user.id, purposes: ["reset_password"] });
  await audit(deps, auth, "account.password_changed");
  await notify(
    deps,
    auth.user.email,
    auth.user.name,
    "Your Collate password was changed",
    "The password for your Collate account was just changed, and every other device was signed out."
  );
  return jsonNoStore({ ok: true }, 200);
}

// ── Email address ───────────────────────────────────────────────────────────

const CodeSchema = z.object({ code: z.string().trim().min(1, "Enter the 6-digit code.") });
const NewEmailSchema = z.object({ newEmail: EmailSchema });

/** Step 1: send a code to the current address. */
export async function handleEmailChangeStart(
  request: Request,
  deps: HttpAuthDeps
): Promise<Response> {
  const gate = await requireSession(request, deps, "sendCode");
  if (!gate.ok) return gate.response;
  const { auth } = gate;
  await clearCodes(deps.db, {
    userId: auth.user.id,
    purposes: ["email_change_authorized", "email_change_new"],
  });
  const code = await issueCode(deps.db, {
    userId: auth.user.id,
    purpose: "email_change_current",
    now: auth.now,
  });
  const result = await deps.mailer.send({
    to: auth.user.email,
    ...buildEmailChangeCodeEmail({ name: auth.user.name, code, step: "confirm_current" }),
  });
  if (!result.ok) {
    return jsonNoStore({ ok: false, error: "We could not send the code. Try again shortly." }, 502);
  }
  return jsonNoStore({ ok: true, sentTo: auth.user.email }, 200);
}

/** Step 2: confirm the code from the current address. */
export async function handleEmailChangeVerifyCurrent(
  request: Request,
  deps: HttpAuthDeps
): Promise<Response> {
  const gate = await requireSession(request, deps, "verifyCode");
  if (!gate.ok) return gate.response;
  const { auth } = gate;
  const parsed = CodeSchema.safeParse(await readBody(request));
  if (!parsed.success) return badRequest("Enter the 6-digit code.");
  const result = await checkCode(deps.db, {
    userId: auth.user.id,
    purpose: "email_change_current",
    code: parsed.data.code,
    now: auth.now,
  });
  if (!result.ok) return badRequest(codeErrorMessage(result.reason));
  await grantMarker(deps.db, {
    userId: auth.user.id,
    purpose: "email_change_authorized",
    now: auth.now,
  });
  return jsonNoStore({ ok: true }, 200);
}

/** Step 3: send a code to the new address (only after step 2, within 15 minutes). */
export async function handleEmailChangeSendNew(
  request: Request,
  deps: HttpAuthDeps
): Promise<Response> {
  const gate = await requireSession(request, deps, "sendCode");
  if (!gate.ok) return gate.response;
  const { auth } = gate;
  if (
    !(await hasMarker(deps.db, {
      userId: auth.user.id,
      purpose: "email_change_authorized",
      now: auth.now,
    }))
  ) {
    return jsonNoStore(
      { ok: false, error: "Confirm the code from your current email first." },
      403
    );
  }
  const parsed = NewEmailSchema.safeParse(await readBody(request));
  if (!parsed.success) return badRequest("Enter a valid email address.");
  const newEmail = parsed.data.newEmail;
  if (newEmail === auth.user.email) return badRequest("That is already your email address.");
  const [taken] = await deps.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, newEmail))
    .limit(1);
  if (taken) return badRequest("Another account already uses that email address.");

  const code = await issueCode(deps.db, {
    userId: auth.user.id,
    purpose: "email_change_new",
    target: newEmail,
    now: auth.now,
  });
  const result = await deps.mailer.send({
    to: newEmail,
    ...buildEmailChangeCodeEmail({ name: auth.user.name, code, step: "confirm_new" }),
  });
  if (!result.ok) {
    return jsonNoStore({ ok: false, error: "We could not send the code. Try again shortly." }, 502);
  }
  return jsonNoStore({ ok: true, sentTo: newEmail }, 200);
}

/** Step 4: confirm the code from the new address and switch the account over. */
export async function handleEmailChangeConfirm(
  request: Request,
  deps: HttpAuthDeps
): Promise<Response> {
  const gate = await requireSession(request, deps, "verifyCode");
  if (!gate.ok) return gate.response;
  const { auth } = gate;
  if (
    !(await hasMarker(deps.db, {
      userId: auth.user.id,
      purpose: "email_change_authorized",
      now: auth.now,
    }))
  ) {
    return jsonNoStore({ ok: false, error: "This change expired. Start again." }, 403);
  }
  const parsed = CodeSchema.safeParse(await readBody(request));
  if (!parsed.success) return badRequest("Enter the 6-digit code.");
  const result = await checkCode(deps.db, {
    userId: auth.user.id,
    purpose: "email_change_new",
    code: parsed.data.code,
    now: auth.now,
  });
  if (!result.ok) return badRequest(codeErrorMessage(result.reason));
  const newEmail = result.target;
  if (!newEmail) return badRequest("This change expired. Start again.");

  const [taken] = await deps.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, newEmail))
    .limit(1);
  if (taken) return badRequest("Another account already uses that email address.");

  const oldEmail = auth.user.email;
  await deps.db
    .update(users)
    .set({ email: newEmail, emailVerified: true, updatedAt: auth.now })
    .where(eq(users.id, auth.user.id));
  await clearCodes(deps.db, {
    userId: auth.user.id,
    purposes: ["email_change_authorized", "email_change_current", "email_change_new"],
  });
  await audit(deps, auth, "account.email_changed", { from: oldEmail, to: newEmail });
  await notify(
    deps,
    oldEmail,
    auth.user.name,
    "Your Collate email address was changed",
    `The email address on your Collate account was changed to ${newEmail}. You will no longer get account emails at this address.`
  );
  return jsonNoStore({ ok: true, email: newEmail }, 200);
}

// ── Active sessions ─────────────────────────────────────────────────────────

export async function listActiveSessions(
  deps: HttpAuthDeps,
  userId: string,
  currentSessionId: string,
  now: Date
) {
  const rows = await deps.db
    .select()
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.lastSeenAt), desc(sessions.createdAt));
  return rows
    .filter((row) => row.expiresAt > now)
    .map((row) => {
      const device = describeDevice(row.userAgent);
      return {
        id: row.id,
        current: row.id === currentSessionId,
        device: device.label,
        kind: device.kind,
        location: describeLocation(row.city, row.country),
        lastActiveAt: (row.lastSeenAt ?? row.createdAt).toISOString(),
        signedInAt: row.createdAt.toISOString(),
      };
    })
    .sort((a, b) => Number(b.current) - Number(a.current));
}

export async function handleListSessions(request: Request, deps: HttpAuthDeps): Promise<Response> {
  const gate = await requireSession(request, deps, null);
  if (!gate.ok) return gate.response;
  const { auth } = gate;
  return jsonNoStore(
    { ok: true, sessions: await listActiveSessions(deps, auth.user.id, auth.sessionId, auth.now) },
    200
  );
}

const RevokeSchema = z.union([
  z.object({ sessionId: z.string().min(1).max(100) }),
  z.object({ allOthers: z.literal(true) }),
]);

/** Signs out one other device, or every device except this one. */
export async function handleRevokeSessions(
  request: Request,
  deps: HttpAuthDeps
): Promise<Response> {
  const gate = await requireSession(request, deps, "accountChange");
  if (!gate.ok) return gate.response;
  const { auth } = gate;
  const parsed = RevokeSchema.safeParse(await readBody(request));
  if (!parsed.success) return badRequest("Choose a device to sign out.");

  if ("allOthers" in parsed.data) {
    const removed = await deps.db
      .delete(sessions)
      .where(and(eq(sessions.userId, auth.user.id), ne(sessions.id, auth.sessionId)))
      .returning({ id: sessions.id });
    await audit(deps, auth, "account.sessions_revoked", { count: removed.length });
    return jsonNoStore({ ok: true, signedOut: removed.length }, 200);
  }

  if (parsed.data.sessionId === auth.sessionId) {
    return badRequest("Use Sign out to end this session.");
  }
  // Scoped to the signed-in user: another user's session id simply matches nothing.
  const removed = await deps.db
    .delete(sessions)
    .where(and(eq(sessions.id, parsed.data.sessionId), eq(sessions.userId, auth.user.id)))
    .returning({ id: sessions.id });
  if (removed.length === 0) {
    return jsonNoStore({ ok: false, error: "That device is already signed out." }, 404);
  }
  await audit(deps, auth, "account.session_revoked", { sessionId: parsed.data.sessionId });
  return jsonNoStore({ ok: true, signedOut: 1 }, 200);
}
