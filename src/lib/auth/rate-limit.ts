import { eq } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { authRateLimits } from "@/db/schema";

export interface RateLimitPolicy {
  maxAttempts: number;
  windowMs: number;
}

export const AUTH_RATE_LIMITS = {
  signup: { maxAttempts: 5, windowMs: 15 * 60 * 1000 },
  signin: { maxAttempts: 10, windowMs: 15 * 60 * 1000 },
  forgotPassword: { maxAttempts: 5, windowMs: 15 * 60 * 1000 },
  resendVerification: { maxAttempts: 5, windowMs: 15 * 60 * 1000 },
  researchSweep: { maxAttempts: 10, windowMs: 60 * 60 * 1000 },
  chapterStart: { maxAttempts: 20, windowMs: 60 * 60 * 1000 },
  exportGenerate: { maxAttempts: 30, windowMs: 60 * 60 * 1000 },
  figureSearch: { maxAttempts: 40, windowMs: 60 * 60 * 1000 },
  accountDelete: { maxAttempts: 5, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, RateLimitPolicy>;

export type AuthRateLimitAction = keyof typeof AUTH_RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function consumeAuthRateLimit(
  db: AppDb,
  action: AuthRateLimitAction,
  subjectKey: string,
  nowMs: number = Date.now(),
  policy: RateLimitPolicy = AUTH_RATE_LIMITS[action]
): Promise<RateLimitResult> {
  const key = `${action}:${subjectKey.trim().toLowerCase()}`;
  const existingRows = await db
    .select()
    .from(authRateLimits)
    .where(eq(authRateLimits.key, key))
    .limit(1);

  const existing = existingRows[0];
  const nowDate = new Date(nowMs);

  if (!existing || nowMs - existing.windowStartMs >= policy.windowMs) {
    await db
      .insert(authRateLimits)
      .values({
        key,
        count: 1,
        windowStartMs: nowMs,
        updatedAt: nowDate,
      })
      .onConflictDoUpdate({
        target: authRateLimits.key,
        set: {
          count: 1,
          windowStartMs: nowMs,
          updatedAt: nowDate,
        },
      });

    return {
      allowed: true,
      remaining: Math.max(0, policy.maxAttempts - 1),
      retryAfterSeconds: 0,
    };
  }

  if (existing.count >= policy.maxAttempts) {
    const retryMs = Math.max(0, existing.windowStartMs + policy.windowMs - nowMs);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1000)),
    };
  }

  const nextCount = existing.count + 1;
  await db
    .update(authRateLimits)
    .set({
      count: nextCount,
      updatedAt: nowDate,
    })
    .where(eq(authRateLimits.key, key));

  return {
    allowed: true,
    remaining: Math.max(0, policy.maxAttempts - nextCount),
    retryAfterSeconds: 0,
  };
}
