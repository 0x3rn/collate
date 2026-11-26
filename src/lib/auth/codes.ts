import { and, eq, lt, sql } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { authCodes } from "@/db/schema";
import { hashTokenSha256 } from "./tokens";

/**
 * Six-digit one-time codes sent by email.
 *
 * - One live code per user and purpose: issuing a new code deletes the previous one, used or not.
 * - Codes expire after 10 minutes and work once: a correct code is deleted as it is accepted.
 * - Five wrong guesses delete the code; the user must ask for a new one.
 * - Only a hash is stored, bound to the user and purpose, so a code for one purpose can never
 *   be replayed for another.
 */

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;

export type CodePurpose =
  | "verify_email"
  | "reset_password"
  | "email_change_current"
  | "email_change_authorized"
  | "email_change_new";

export type CodeCheckResult =
  | { ok: true; target: string | null }
  | { ok: false; reason: "invalid" | "expired" | "too_many_attempts" };

/** A uniformly random 6-digit code (rejection sampling avoids modulo bias). */
export function generateNumericCode(): string {
  const limit = Math.floor(0x100000000 / 1_000_000) * 1_000_000;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const value = buf[0]!;
    if (value < limit) return String(value % 1_000_000).padStart(6, "0");
  }
}

async function hashCode(userId: string, purpose: CodePurpose, code: string): Promise<string> {
  return hashTokenSha256(`auth-code:${purpose}:${userId}:${code}`);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Normalises what the user typed: keeps digits only ("123 456" -> "123456"). */
export function normalizeCodeInput(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/\D/g, "") : "";
}

export async function issueCode(
  db: AppDb,
  params: {
    userId: string;
    purpose: CodePurpose;
    target?: string | null;
    now: Date;
    ttlMs?: number;
  }
): Promise<string> {
  const code = generateNumericCode();
  await db
    .delete(authCodes)
    .where(and(eq(authCodes.userId, params.userId), eq(authCodes.purpose, params.purpose)));
  await db.insert(authCodes).values({
    id: `code_${crypto.randomUUID()}`,
    userId: params.userId,
    purpose: params.purpose,
    codeHash: await hashCode(params.userId, params.purpose, code),
    target: params.target ?? null,
    attempts: 0,
    expiresAt: new Date(params.now.getTime() + (params.ttlMs ?? CODE_TTL_MS)),
    createdAt: params.now,
  });
  return code;
}

/** Checks a code and, if correct, consumes it. Wrong guesses count towards the limit. */
export async function checkCode(
  db: AppDb,
  params: { userId: string; purpose: CodePurpose; code: unknown; now: Date }
): Promise<CodeCheckResult> {
  const code = normalizeCodeInput(params.code);
  const [row] = await db
    .select()
    .from(authCodes)
    .where(and(eq(authCodes.userId, params.userId), eq(authCodes.purpose, params.purpose)))
    .limit(1);
  if (!row) return { ok: false, reason: "invalid" };

  if (row.expiresAt <= params.now) {
    await db.delete(authCodes).where(eq(authCodes.id, row.id));
    return { ok: false, reason: "expired" };
  }
  if (row.attempts >= MAX_CODE_ATTEMPTS) {
    await db.delete(authCodes).where(eq(authCodes.id, row.id));
    return { ok: false, reason: "too_many_attempts" };
  }

  const matches =
    code.length === 6 &&
    constantTimeEqual(await hashCode(params.userId, params.purpose, code), row.codeHash);

  if (!matches) {
    const [updated] = await db
      .update(authCodes)
      .set({ attempts: sql`${authCodes.attempts} + 1` })
      .where(eq(authCodes.id, row.id))
      .returning({ attempts: authCodes.attempts });
    if (!updated || updated.attempts >= MAX_CODE_ATTEMPTS) {
      await db.delete(authCodes).where(eq(authCodes.id, row.id));
      return { ok: false, reason: "too_many_attempts" };
    }
    return { ok: false, reason: "invalid" };
  }

  // Consume atomically: if two requests race with the right code, only one deletes the row.
  const consumed = await db
    .delete(authCodes)
    .where(eq(authCodes.id, row.id))
    .returning({ id: authCodes.id });
  if (consumed.length === 0) return { ok: false, reason: "invalid" };
  return { ok: true, target: row.target };
}

/** Grants a short-lived permission (no code to type), e.g. "current email confirmed". */
export async function grantMarker(
  db: AppDb,
  params: { userId: string; purpose: CodePurpose; now: Date; ttlMs?: number }
): Promise<void> {
  await db
    .delete(authCodes)
    .where(and(eq(authCodes.userId, params.userId), eq(authCodes.purpose, params.purpose)));
  await db.insert(authCodes).values({
    id: `code_${crypto.randomUUID()}`,
    userId: params.userId,
    purpose: params.purpose,
    codeHash: "marker",
    target: null,
    attempts: 0,
    expiresAt: new Date(params.now.getTime() + (params.ttlMs ?? 15 * 60 * 1000)),
    createdAt: params.now,
  });
}

export async function hasMarker(
  db: AppDb,
  params: { userId: string; purpose: CodePurpose; now: Date }
): Promise<boolean> {
  const [row] = await db
    .select({ expiresAt: authCodes.expiresAt })
    .from(authCodes)
    .where(and(eq(authCodes.userId, params.userId), eq(authCodes.purpose, params.purpose)))
    .limit(1);
  return Boolean(row && row.expiresAt > params.now);
}

export async function clearCodes(
  db: AppDb,
  params: { userId: string; purposes: CodePurpose[] }
): Promise<void> {
  for (const purpose of params.purposes) {
    await db
      .delete(authCodes)
      .where(and(eq(authCodes.userId, params.userId), eq(authCodes.purpose, purpose)));
  }
}

/** Housekeeping: removes expired codes. */
export async function deleteExpiredCodes(db: AppDb, now: Date): Promise<void> {
  await db.delete(authCodes).where(lt(authCodes.expiresAt, now));
}

export function codeErrorMessage(reason: "invalid" | "expired" | "too_many_attempts"): string {
  if (reason === "expired") return "That code has expired. Request a new one.";
  if (reason === "too_many_attempts")
    return "Too many wrong attempts. Request a new code and try again.";
  return "That code is not right. Check the latest email and try again.";
}
