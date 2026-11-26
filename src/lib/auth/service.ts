import { and, eq, sql } from "drizzle-orm";
import { evidenceFromValues, TERMS_VERSION } from "@/lib/billing/evidence";
import { z } from "zod";
import type { AppDb } from "@/db/client";
import { accounts, auditLog, sessions, users, verifications } from "@/db/schema";
import {
  buildPasswordResetEmail,
  buildVerificationEmail,
  type EmailSender,
} from "@/lib/email/mailer";
import { type AdminNotifier, buildSignupAlert } from "@/lib/notify/admin-alerts";
import { logEvent } from "@/lib/observability/logger";
import { verifyTurnstileToken } from "@/lib/security/turnstile";
import {
  hashPassword,
  runDummyPasswordCheck,
  validatePasswordStrength,
  verifyPassword,
} from "./password";
import { checkCode, clearCodes, codeErrorMessage, issueCode } from "./codes";
import { consumeAuthRateLimit } from "./rate-limit";
import { generateSecureToken, hashTokenSha256 } from "./tokens";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const PASSWORD_RESET_TTL_MS = 10 * 60 * 1000; // 10 minutes (issued after a reset code is confirmed)

export const EmailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.");

export const SignUpInputSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name (at least 2 characters).").max(100),
  email: EmailSchema,
  password: z.string().min(1, "Enter a password."),
  turnstileToken: z.string().optional(),
  /** The sign-up form's required tick box; no account is created without it. */
  acceptTerms: z.literal(true, {
    message: "Tick the box to agree to the Terms of Service before creating your account.",
  }),
});

export const SignInInputSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, "Enter your password."),
  turnstileToken: z.string().optional(),
});

export const ResetPasswordInputSchema = z.object({
  token: z.string().trim().min(10, "Reset token is missing or invalid."),
  newPassword: z.string().min(1, "Enter a new password."),
});

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  creditsBalance: number;
  createdAt: Date;
}

export interface AuthServiceContext {
  db: AppDb;
  mailer: EmailSender;
  appUrl: string;
  clientIp: string;
  userAgent?: string;
  turnstileSecretKey?: string;
  appEnv?: string;
  adminNotifier?: AdminNotifier | null;
  /** Approximate location of the request (from Cloudflare), stored on new sessions. */
  geo?: { city?: string | null; country?: string | null };
  nowFn?: () => Date;
  fetchFn?: typeof fetch;
}

export type AuthErrorCode =
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "BOT_CHECK_FAILED"
  | "INVALID_CREDENTIALS"
  | "EMAIL_NOT_VERIFIED"
  | "INVALID_TOKEN";

export class AuthError extends Error {
  public readonly code: AuthErrorCode;
  public readonly status: number;
  public readonly retryAfterSeconds?: number;

  constructor(code: AuthErrorCode, message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function toPublicUser(row: typeof users.$inferSelect): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    emailVerified: row.emailVerified,
    creditsBalance: row.creditsBalance,
    createdAt: row.createdAt,
  };
}

function ctxEvidence(ctx: AuthServiceContext) {
  return evidenceFromValues({
    ip: ctx.clientIp,
    userAgent: ctx.userAgent,
    country: ctx.geo?.country,
    city: ctx.geo?.city,
  });
}

async function writeAudit(
  db: AppDb,
  params: {
    actorUserId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Record<string, unknown>;
    now: Date;
  }
): Promise<void> {
  await db.insert(auditLog).values({
    id: `aud_${crypto.randomUUID()}`,
    actorUserId: params.actorUserId ?? null,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    metadataJson: params.metadata ? JSON.stringify(params.metadata) : null,
    createdAt: params.now,
  });
}

function normalizeBaseUrl(appUrl: string): string {
  let out = appUrl.trim();
  while (out.endsWith("/")) {
    out = out.slice(0, -1);
  }
  return out;
}

export async function signUpUser(
  rawInput: unknown,
  ctx: AuthServiceContext
): Promise<{ message: string }> {
  const parsed = SignUpInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AuthError(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Check the form fields and try again.",
      400
    );
  }
  const { name, email, password, turnstileToken } = parsed.data;
  const now = (ctx.nowFn ?? (() => new Date()))();

  const pwCheck = validatePasswordStrength(password, email);
  if (!pwCheck.valid) {
    throw new AuthError("VALIDATION_ERROR", pwCheck.reason ?? "Password is too weak.", 400);
  }

  const rl = await consumeAuthRateLimit(
    ctx.db,
    "signup",
    `${ctx.clientIp}:${email}`,
    now.getTime()
  );
  if (!rl.allowed) {
    throw new AuthError(
      "RATE_LIMITED",
      "Too many sign-up attempts. Please wait a few minutes and try again.",
      429,
      rl.retryAfterSeconds
    );
  }

  const botCheck = await verifyTurnstileToken({
    token: turnstileToken,
    remoteIp: ctx.clientIp,
    secretKey: ctx.turnstileSecretKey,
    appEnv: ctx.appEnv,
    fetchFn: ctx.fetchFn,
  });
  if (!botCheck.passed) {
    throw new AuthError("BOT_CHECK_FAILED", botCheck.reason ?? "Verification failed.", 400);
  }

  const existing = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) {
    // Anti-enumeration: do not disclose whether an email is already registered.
    await writeAudit(ctx.db, {
      actorUserId: existing[0].id,
      action: "auth.signup_duplicate_email",
      entityType: "user",
      entityId: existing[0].id,
      now,
    });
    return {
      message: "We sent a 6-digit code to your email. Enter it below to activate your account.",
    };
  }

  const userId = `usr_${crypto.randomUUID()}`;
  const passwordHash = await hashPassword(password);
  const rawToken = generateSecureToken(32);
  const tokenHash = await hashTokenSha256(rawToken);

  await ctx.db.insert(users).values({
    id: userId,
    email,
    emailVerified: false,
    name,
    creditsBalance: 0,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.insert(accounts).values({
    id: `acc_${crypto.randomUUID()}`,
    userId,
    accountId: userId,
    providerId: "credential",
    password: passwordHash,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.insert(verifications).values({
    id: `ver_${crypto.randomUUID()}`,
    identifier: `verify:${userId}`,
    value: tokenHash,
    expiresAt: new Date(now.getTime() + EMAIL_VERIFY_TTL_MS),
    createdAt: now,
    updatedAt: now,
  });

  await writeAudit(ctx.db, {
    actorUserId: userId,
    action: "auth.signup",
    entityType: "user",
    entityId: userId,
    metadata: { ...ctxEvidence(ctx), termsVersion: TERMS_VERSION, termsAccepted: true },
    now,
  });

  if (ctx.adminNotifier) {
    const [countRow] = await ctx.db.select({ total: sql<number>`count(*)` }).from(users);
    await ctx.adminNotifier.send(
      buildSignupAlert({ name, email, totalUsers: Number(countRow?.total ?? 0) })
    );
  }

  const verifyUrl = `${normalizeBaseUrl(ctx.appUrl)}/verify-email?token=${encodeURIComponent(rawToken)}`;
  const code = await issueCode(ctx.db, { userId, purpose: "verify_email", now });
  const emailContent = buildVerificationEmail({ name, verifyUrl, code });
  const delivery = await ctx.mailer.send({ to: email, ...emailContent });
  if (!delivery.ok) {
    logEvent("error", "auth_email_delivery_failed", {
      data: { userId, flow: "signup", provider: delivery.provider, error: delivery.error },
    });
  }

  return {
    message: "We sent a 6-digit code to your email. Enter it below to activate your account.",
  };
}

export async function verifyEmailToken(
  rawToken: string,
  ctx: Pick<AuthServiceContext, "db" | "nowFn">
): Promise<{ verified: true; userId: string }> {
  const token = rawToken.trim();
  if (token.length < 10) {
    throw new AuthError("INVALID_TOKEN", "This verification link is invalid or expired.", 400);
  }

  const now = (ctx.nowFn ?? (() => new Date()))();
  const tokenHash = await hashTokenSha256(token);

  const rows = await ctx.db
    .select()
    .from(verifications)
    .where(eq(verifications.value, tokenHash))
    .limit(1);

  const record = rows[0];
  if (!record || !record.identifier.startsWith("verify:") || record.expiresAt <= now) {
    if (record) {
      await ctx.db.delete(verifications).where(eq(verifications.id, record.id));
    }
    throw new AuthError("INVALID_TOKEN", "This verification link is invalid or expired.", 400);
  }

  const userId = record.identifier.slice("verify:".length);

  await ctx.db
    .update(users)
    .set({ emailVerified: true, updatedAt: now })
    .where(eq(users.id, userId));

  // Single-use: remove all pending verification tokens for this user
  await ctx.db.delete(verifications).where(eq(verifications.identifier, record.identifier));
  await clearCodes(ctx.db, { userId, purposes: ["verify_email"] });

  await writeAudit(ctx.db, {
    actorUserId: userId,
    action: "auth.email_verified",
    entityType: "user",
    entityId: userId,
    now,
  });

  return { verified: true, userId };
}

export async function resendVerificationEmail(
  rawEmail: unknown,
  ctx: AuthServiceContext
): Promise<{ message: string }> {
  const parsed = EmailSchema.safeParse(rawEmail);
  if (!parsed.success) {
    throw new AuthError("VALIDATION_ERROR", "Enter a valid email address.", 400);
  }
  const email = parsed.data;
  const now = (ctx.nowFn ?? (() => new Date()))();

  const rl = await consumeAuthRateLimit(
    ctx.db,
    "resendVerification",
    `${ctx.clientIp}:${email}`,
    now.getTime()
  );
  if (!rl.allowed) {
    throw new AuthError(
      "RATE_LIMITED",
      "Too many verification requests. Please wait a few minutes and try again.",
      429,
      rl.retryAfterSeconds
    );
  }

  const [user] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
  if (user && !user.emailVerified) {
    const identifier = `verify:${user.id}`;
    await ctx.db.delete(verifications).where(eq(verifications.identifier, identifier));

    const rawToken = generateSecureToken(32);
    const tokenHash = await hashTokenSha256(rawToken);
    await ctx.db.insert(verifications).values({
      id: `ver_${crypto.randomUUID()}`,
      identifier,
      value: tokenHash,
      expiresAt: new Date(now.getTime() + EMAIL_VERIFY_TTL_MS),
      createdAt: now,
      updatedAt: now,
    });

    const verifyUrl = `${normalizeBaseUrl(ctx.appUrl)}/verify-email?token=${encodeURIComponent(rawToken)}`;
    const code = await issueCode(ctx.db, { userId: user.id, purpose: "verify_email", now });
    const emailContent = buildVerificationEmail({ name: user.name, verifyUrl, code });
    const delivery = await ctx.mailer.send({ to: user.email, ...emailContent });
    if (!delivery.ok) {
      logEvent("error", "auth_email_delivery_failed", {
        data: {
          userId: user.id,
          flow: "resend_verification",
          provider: delivery.provider,
          error: delivery.error,
        },
      });
    }
  }

  return {
    message: "We sent a new verification email.",
  };
}

export async function signInUser(
  rawInput: unknown,
  ctx: AuthServiceContext
): Promise<{ rawSessionToken: string; expiresAt: Date; user: PublicUser }> {
  const parsed = SignInInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AuthError(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Enter your email and password.",
      400
    );
  }
  const { email, password, turnstileToken } = parsed.data;
  const now = (ctx.nowFn ?? (() => new Date()))();

  const rl = await consumeAuthRateLimit(
    ctx.db,
    "signin",
    `${ctx.clientIp}:${email}`,
    now.getTime()
  );
  if (!rl.allowed) {
    throw new AuthError(
      "RATE_LIMITED",
      "Too many sign-in attempts. Please wait a few minutes and try again.",
      429,
      rl.retryAfterSeconds
    );
  }

  const botCheck = await verifyTurnstileToken({
    token: turnstileToken,
    remoteIp: ctx.clientIp,
    secretKey: ctx.turnstileSecretKey,
    appEnv: ctx.appEnv,
    fetchFn: ctx.fetchFn,
  });
  if (!botCheck.passed) {
    throw new AuthError("BOT_CHECK_FAILED", botCheck.reason ?? "Verification failed.", 400);
  }

  const [user] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    await runDummyPasswordCheck(password);
    throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password.", 401);
  }

  const [account] = await ctx.db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, user.id), eq(accounts.providerId, "credential")))
    .limit(1);

  if (!account?.password) {
    await runDummyPasswordCheck(password);
    throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password.", 401);
  }

  const valid = await verifyPassword(password, account.password);
  if (!valid) {
    await writeAudit(ctx.db, {
      actorUserId: user.id,
      action: "auth.signin_failed",
      entityType: "user",
      entityId: user.id,
      now,
    });
    throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password.", 401);
  }

  if (!user.emailVerified) {
    throw new AuthError(
      "EMAIL_NOT_VERIFIED",
      "Verify your email address before signing in. Check your inbox or request a new link.",
      403
    );
  }

  // Fresh random session token on every sign-in (prevents session fixation)
  const rawSessionToken = generateSecureToken(32);
  const tokenHash = await hashTokenSha256(rawSessionToken);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  await ctx.db.insert(sessions).values({
    id: `ses_${crypto.randomUUID()}`,
    userId: user.id,
    token: tokenHash,
    expiresAt,
    ipAddress: ctx.clientIp,
    userAgent: ctx.userAgent?.slice(0, 300) ?? null,
    city: ctx.geo?.city?.slice(0, 80) ?? null,
    country: ctx.geo?.country?.slice(0, 2) ?? null,
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await writeAudit(ctx.db, {
    actorUserId: user.id,
    action: "auth.signin",
    entityType: "user",
    entityId: user.id,
    metadata: { ...ctxEvidence(ctx) },
    now,
  });

  return {
    rawSessionToken,
    expiresAt,
    user: toPublicUser(user),
  };
}

export async function getSessionFromToken(
  db: AppDb,
  rawSessionToken: string | undefined,
  nowFn: () => Date = () => new Date()
): Promise<{ sessionId: string; user: PublicUser } | null> {
  const token = rawSessionToken?.trim();
  if (!token) return null;

  const tokenHash = await hashTokenSha256(token);
  const [session] = await db.select().from(sessions).where(eq(sessions.token, tokenHash)).limit(1);

  if (!session) return null;

  const now = nowFn();
  if (session.expiresAt <= now) {
    await db.delete(sessions).where(eq(sessions.id, session.id));
    return null;
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user || !user.emailVerified) {
    return null;
  }

  // "Last active" for the Active sessions list, written at most every 5 minutes.
  if (!session.lastSeenAt || now.getTime() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, session.id));
  }

  return {
    sessionId: session.id,
    user: toPublicUser(user),
  };
}

export async function signOutByToken(
  db: AppDb,
  rawSessionToken: string | undefined,
  nowFn: () => Date = () => new Date()
): Promise<void> {
  const token = rawSessionToken?.trim();
  if (!token) return;

  const tokenHash = await hashTokenSha256(token);
  const [session] = await db.select().from(sessions).where(eq(sessions.token, tokenHash)).limit(1);

  if (session) {
    await db.delete(sessions).where(eq(sessions.id, session.id));
    await writeAudit(db, {
      actorUserId: session.userId,
      action: "auth.signout",
      entityType: "session",
      entityId: session.id,
      now: nowFn(),
    });
  }
}

export async function requestPasswordReset(
  rawEmail: unknown,
  ctx: AuthServiceContext
): Promise<{ message: string }> {
  const parsed = EmailSchema.safeParse(rawEmail);
  if (!parsed.success) {
    throw new AuthError("VALIDATION_ERROR", "Enter a valid email address.", 400);
  }
  const email = parsed.data;
  const now = (ctx.nowFn ?? (() => new Date()))();

  const rl = await consumeAuthRateLimit(
    ctx.db,
    "forgotPassword",
    `${ctx.clientIp}:${email}`,
    now.getTime()
  );
  if (!rl.allowed) {
    throw new AuthError(
      "RATE_LIMITED",
      "Too many password reset requests. Please wait a few minutes and try again.",
      429,
      rl.retryAfterSeconds
    );
  }

  const [user] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
  if (user) {
    // A new code replaces any earlier code or reset link.
    await ctx.db.delete(verifications).where(eq(verifications.identifier, `reset:${user.id}`));
    const code = await issueCode(ctx.db, { userId: user.id, purpose: "reset_password", now });

    await writeAudit(ctx.db, {
      actorUserId: user.id,
      action: "auth.password_reset_requested",
      entityType: "user",
      entityId: user.id,
      now,
    });

    const emailContent = buildPasswordResetEmail({ name: user.name, code });
    const delivery = await ctx.mailer.send({ to: user.email, ...emailContent });
    if (!delivery.ok) {
      logEvent("error", "auth_email_delivery_failed", {
        data: {
          userId: user.id,
          flow: "password_reset",
          provider: delivery.provider,
          error: delivery.error,
        },
      });
    }
  }

  // Anti-enumeration: always return the same neutral message
  return {
    message: "If an account exists for that email, we sent a 6-digit reset code.",
  };
}

export async function resetPasswordWithToken(
  rawInput: unknown,
  ctx: Pick<AuthServiceContext, "db" | "nowFn">
): Promise<{ reset: true }> {
  const parsed = ResetPasswordInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new AuthError(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Check your input and try again.",
      400
    );
  }

  const now = (ctx.nowFn ?? (() => new Date()))();
  const tokenHash = await hashTokenSha256(parsed.data.token);

  const [record] = await ctx.db
    .select()
    .from(verifications)
    .where(eq(verifications.value, tokenHash))
    .limit(1);

  if (!record || !record.identifier.startsWith("reset:") || record.expiresAt <= now) {
    if (record) {
      await ctx.db.delete(verifications).where(eq(verifications.id, record.id));
    }
    throw new AuthError("INVALID_TOKEN", "This password reset link is invalid or expired.", 400);
  }

  const userId = record.identifier.slice("reset:".length);
  const [user] = await ctx.db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    throw new AuthError("INVALID_TOKEN", "This password reset link is invalid or expired.", 400);
  }

  const pwCheck = validatePasswordStrength(parsed.data.newPassword, user.email);
  if (!pwCheck.valid) {
    throw new AuthError("VALIDATION_ERROR", pwCheck.reason ?? "Password is too weak.", 400);
  }

  const newHash = await hashPassword(parsed.data.newPassword);

  const updated = await ctx.db
    .update(accounts)
    .set({ password: newHash, updatedAt: now })
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")))
    .returning({ id: accounts.id });
  if (updated.length === 0) {
    // Accounts created with Google have no password yet: this sets one.
    await ctx.db.insert(accounts).values({
      id: `acc_${crypto.randomUUID()}`,
      userId,
      accountId: userId,
      providerId: "credential",
      password: newHash,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Single-use token cleanup + revoke all existing sessions on password change
  await ctx.db.delete(verifications).where(eq(verifications.identifier, record.identifier));
  await clearCodes(ctx.db, { userId, purposes: ["reset_password"] });
  await ctx.db.delete(sessions).where(eq(sessions.userId, userId));

  await writeAudit(ctx.db, {
    actorUserId: userId,
    action: "auth.password_reset_completed",
    entityType: "user",
    entityId: userId,
    now,
  });

  return { reset: true };
}

/** Confirms a new account with the 6-digit code from the sign-up email. */
export async function verifyEmailWithCode(
  rawInput: { email?: unknown; code?: unknown },
  ctx: Pick<AuthServiceContext, "db" | "nowFn" | "clientIp">
): Promise<{ verified: true; userId: string }> {
  const parsed = EmailSchema.safeParse(rawInput.email);
  if (!parsed.success) {
    throw new AuthError("VALIDATION_ERROR", "Enter a valid email address.", 400);
  }
  const email = parsed.data;
  const now = (ctx.nowFn ?? (() => new Date()))();
  const rl = await consumeAuthRateLimit(
    ctx.db,
    "verifyCode",
    `${ctx.clientIp}:${email}`,
    now.getTime()
  );
  if (!rl.allowed) {
    throw new AuthError(
      "RATE_LIMITED",
      "Too many attempts. Please wait a few minutes and try again.",
      429,
      rl.retryAfterSeconds
    );
  }

  const [user] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || user.emailVerified) {
    throw new AuthError("INVALID_TOKEN", codeErrorMessage("invalid"), 400);
  }
  const result = await checkCode(ctx.db, {
    userId: user.id,
    purpose: "verify_email",
    code: rawInput.code,
    now,
  });
  if (!result.ok) {
    throw new AuthError("INVALID_TOKEN", codeErrorMessage(result.reason), 400);
  }

  await ctx.db
    .update(users)
    .set({ emailVerified: true, updatedAt: now })
    .where(eq(users.id, user.id));
  await ctx.db.delete(verifications).where(eq(verifications.identifier, `verify:${user.id}`));
  await writeAudit(ctx.db, {
    actorUserId: user.id,
    action: "auth.email_verified",
    entityType: "user",
    entityId: user.id,
    metadata: { method: "code" },
    now,
  });
  return { verified: true, userId: user.id };
}

/**
 * Step 2 of "forgot password": swaps a correct reset code for a short-lived, single-use reset
 * token, which the final step (choose a new password) sends with the new password.
 */
export async function exchangeResetCodeForToken(
  rawInput: { email?: unknown; code?: unknown },
  ctx: Pick<AuthServiceContext, "db" | "nowFn" | "clientIp">
): Promise<{ resetToken: string }> {
  const parsed = EmailSchema.safeParse(rawInput.email);
  if (!parsed.success) {
    throw new AuthError("VALIDATION_ERROR", "Enter a valid email address.", 400);
  }
  const email = parsed.data;
  const now = (ctx.nowFn ?? (() => new Date()))();
  const rl = await consumeAuthRateLimit(
    ctx.db,
    "verifyCode",
    `${ctx.clientIp}:${email}`,
    now.getTime()
  );
  if (!rl.allowed) {
    throw new AuthError(
      "RATE_LIMITED",
      "Too many attempts. Please wait a few minutes and try again.",
      429,
      rl.retryAfterSeconds
    );
  }

  const [user] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    throw new AuthError("INVALID_TOKEN", codeErrorMessage("invalid"), 400);
  }
  const result = await checkCode(ctx.db, {
    userId: user.id,
    purpose: "reset_password",
    code: rawInput.code,
    now,
  });
  if (!result.ok) {
    throw new AuthError("INVALID_TOKEN", codeErrorMessage(result.reason), 400);
  }

  const identifier = `reset:${user.id}`;
  await ctx.db.delete(verifications).where(eq(verifications.identifier, identifier));
  const resetToken = generateSecureToken(32);
  await ctx.db.insert(verifications).values({
    id: `ver_${crypto.randomUUID()}`,
    identifier,
    value: await hashTokenSha256(resetToken),
    expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
    createdAt: now,
    updatedAt: now,
  });
  return { resetToken };
}
