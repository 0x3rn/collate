import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth/password";
import { consumeAuthRateLimit } from "@/lib/auth/rate-limit";
import {
  exchangeResetCodeForToken,
  getSessionFromToken,
  requestPasswordReset,
  resetPasswordWithToken,
  signInUser,
  signOutByToken,
  signUpUser,
  verifyEmailToken,
  type AuthServiceContext,
} from "@/lib/auth/service";
import { sanitizeRedirectPath } from "@/lib/auth/tokens";
import type { EmailMessage, EmailSender } from "@/lib/email/mailer";
import { applySecurityHeaders, sanitizeIncomingRequest } from "@/lib/security/headers";
import { verifyTurnstileToken } from "@/lib/security/turnstile";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

function createTestMailer() {
  const sent: EmailMessage[] = [];
  const mailer: EmailSender = {
    async send(message) {
      sent.push(message);
      return { ok: true, provider: "console", messageId: `test_${sent.length}` };
    },
  };
  return { sent, mailer };
}

function extractCodeFromEmail(text: string): string {
  const match = text.match(/\b(\d{6})\b/);
  if (!match?.[1]) {
    throw new Error(`No code found in email text: ${text}`);
  }
  return match[1];
}

function extractTokenFromEmail(text: string): string {
  const match = text.match(/token=([^\s&]+)/);
  if (!match?.[1]) {
    throw new Error(`No token found in email text: ${text}`);
  }
  return decodeURIComponent(match[1]);
}

describe("Password hashing, policy, redirects, and security headers", () => {
  it("hashes and verifies passwords with unique random salts and rejects tampered hashes", async () => {
    const pw = "correct-horse-battery-staple";
    const hash1 = await hashPassword(pw);
    const hash2 = await hashPassword(pw);

    expect(hash1).not.toBe(hash2);
    expect(await verifyPassword(pw, hash1)).toBe(true);
    expect(await verifyPassword("wrong-horse-battery-staple", hash1)).toBe(false);
    expect(await verifyPassword(pw, `${hash1.slice(0, -1)}x`)).toBe(false);
  });

  it("enforces >= 12 char passphrases and rejects common or email-containing passwords", () => {
    expect(validatePasswordStrength("short123").valid).toBe(false);
    expect(validatePasswordStrength("password1234").valid).toBe(false);
    expect(validatePasswordStrength("aaaaaaaaaaaa").valid).toBe(false);
    expect(validatePasswordStrength("my-amara-passphrase", "amara@uni.edu").valid).toBe(false);
    expect(validatePasswordStrength("quiet autumn library desk", "amara@uni.edu").valid).toBe(true);
  });

  it("blocks open redirects while preserving safe relative paths", () => {
    expect(sanitizeRedirectPath("/dashboard?tab=active")).toBe("/dashboard?tab=active");
    expect(sanitizeRedirectPath("https://evil.example/phish")).toBe("/dashboard");
    expect(sanitizeRedirectPath("//evil.example/phish")).toBe("/dashboard");
    expect(sanitizeRedirectPath("javascript:alert(1)")).toBe("/dashboard");
    expect(sanitizeRedirectPath("/\\evil.example")).toBe("/dashboard");
  });

  it("strips x-middleware-subrequest and attaches baseline security headers", () => {
    const hostile = new Request("https://collate.app/dashboard", {
      headers: { "x-middleware-subrequest": "middleware", accept: "text/html" },
    });
    const cleaned = sanitizeIncomingRequest(hostile);
    expect(cleaned.headers.has("x-middleware-subrequest")).toBe(false);
    expect(cleaned.headers.get("accept")).toBe("text/html");

    const rawRes = new Response("ok", { headers: { "x-powered-by": "Next.js" } });
    const secured = applySecurityHeaders(rawRes, true);
    expect(secured.headers.get("x-powered-by")).toBeNull();
    expect(secured.headers.get("x-frame-options")).toBe("DENY");
    expect(secured.headers.get("x-content-type-options")).toBe("nosniff");
    expect(secured.headers.get("strict-transport-security")).toContain("max-age=63072000");
    expect(secured.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});

describe("Turnstile verification", () => {
  it("skips cleanly in local dev when secret is unset, fails closed in prod, and verifies via API", async () => {
    expect(await verifyTurnstileToken({ token: undefined, appEnv: "dev" })).toEqual({
      passed: true,
      skipped: true,
    });
    expect((await verifyTurnstileToken({ token: undefined, appEnv: "prod" })).passed).toBe(false);

    const okFetch: typeof fetch = async () => Response.json({ success: true });
    expect(
      (
        await verifyTurnstileToken({
          token: "valid-token",
          secretKey: "secret-key",
          appEnv: "prod",
          fetchFn: okFetch,
        })
      ).passed
    ).toBe(true);

    const badFetch: typeof fetch = async () =>
      Response.json({ success: false, "error-codes": ["invalid-input-response"] });
    expect(
      (
        await verifyTurnstileToken({
          token: "bad-token",
          secretKey: "secret-key",
          appEnv: "prod",
          fetchFn: badFetch,
        })
      ).passed
    ).toBe(false);
  });
});

describe("End-to-end Auth Service + D1 Rate Limiting", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  let nowMs: number;

  beforeEach(() => {
    d1Ctx = createInMemoryD1();
    d1Ctx.applyMigrations();
    db = createDb(d1Ctx.d1);
    nowMs = Date.parse("2026-11-21T15:00:00.000Z");
  });

  afterEach(() => {
    d1Ctx.close();
  });

  function makeCtx(mailer: EmailSender, clientIp = "198.51.100.10"): AuthServiceContext {
    return {
      db,
      mailer,
      appUrl: "https://collate.app",
      clientIp,
      appEnv: "dev",
      nowFn: () => new Date(nowMs),
    };
  }

  it("enforces full lifecycle: signup -> blocked until verified -> verify -> signin -> session -> signout", async () => {
    const { sent, mailer } = createTestMailer();
    const ctx = makeCtx(mailer);
    const password = "warm archival library paper";

    const signupRes = await signUpUser(
      { name: "Chidi Okafor", email: "Chidi@Uni.edu.ng", password, acceptTerms: true },
      ctx
    );
    expect(signupRes.message).toContain("6-digit code");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("chidi@uni.edu.ng");

    // Cannot sign in before email verification
    await expect(signInUser({ email: "chidi@uni.edu.ng", password }, ctx)).rejects.toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
      status: 403,
    });

    // Verify email using single-use token
    const verifyToken = extractTokenFromEmail(sent[0]!.text);
    const verified = await verifyEmailToken(verifyToken, ctx);
    expect(verified.verified).toBe(true);

    // Reusing the same verification token must fail
    await expect(verifyEmailToken(verifyToken, ctx)).rejects.toMatchObject({
      code: "INVALID_TOKEN",
    });

    // Sign in succeeds after verification
    const signedIn = await signInUser({ email: "chidi@uni.edu.ng", password }, ctx);
    expect(signedIn.user.email).toBe("chidi@uni.edu.ng");
    expect(signedIn.user.emailVerified).toBe(true);

    // Session resolves validly
    const session = await getSessionFromToken(db, signedIn.rawSessionToken, () => new Date(nowMs));
    expect(session?.user.id).toBe(signedIn.user.id);

    // Sign out invalidates the session immediately
    await signOutByToken(db, signedIn.rawSessionToken, () => new Date(nowMs));
    const afterSignOut = await getSessionFromToken(
      db,
      signedIn.rawSessionToken,
      () => new Date(nowMs)
    );
    expect(afterSignOut).toBeNull();
  });

  it("prevents email enumeration on duplicate signup and password reset", async () => {
    const { sent, mailer } = createTestMailer();
    const ctx = makeCtx(mailer);

    const first = await signUpUser(
      {
        name: "Ngozi Ade",
        email: "ngozi@example.com",
        password: "solid timber reading bench",
        acceptTerms: true,
      },
      ctx
    );
    const second = await signUpUser(
      {
        name: "Attacker",
        email: "ngozi@example.com",
        password: "another long passphrase here",
        acceptTerms: true,
      },
      ctx
    );
    expect(second.message).toBe(first.message);
    expect(sent).toHaveLength(1); // Did not overwrite or spam on duplicate

    const resetKnown = await requestPasswordReset("ngozi@example.com", ctx);
    const resetUnknown = await requestPasswordReset("nobody@example.com", ctx);
    expect(resetKnown.message).toBe(resetUnknown.message);
    expect(sent).toHaveLength(2); // Only sent for the real account
  });

  it("resets password with single-use token and revokes all existing sessions", async () => {
    const { sent, mailer } = createTestMailer();
    const ctx = makeCtx(mailer);

    await signUpUser(
      {
        name: "Tunde Bello",
        email: "tunde@example.com",
        password: "first long research phrase",
        acceptTerms: true,
      },
      ctx
    );
    await verifyEmailToken(extractTokenFromEmail(sent[0]!.text), ctx);
    const oldSession = await signInUser(
      { email: "tunde@example.com", password: "first long research phrase" },
      ctx
    );

    await requestPasswordReset("tunde@example.com", ctx);
    const { resetToken } = await exchangeResetCodeForToken(
      { email: "tunde@example.com", code: extractCodeFromEmail(sent[1]!.text) },
      ctx
    );

    await resetPasswordWithToken(
      { token: resetToken, newPassword: "second stronger archive phrase" },
      ctx
    );

    // Old session must be revoked after password reset
    expect(
      await getSessionFromToken(db, oldSession.rawSessionToken, () => new Date(nowMs))
    ).toBeNull();

    // Old password rejected, new password accepted
    await expect(
      signInUser({ email: "tunde@example.com", password: "first long research phrase" }, ctx)
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    const newSession = await signInUser(
      { email: "tunde@example.com", password: "second stronger archive phrase" },
      ctx
    );
    expect(newSession.user.email).toBe("tunde@example.com");

    // Reset token is single-use
    await expect(
      resetPasswordWithToken(
        { token: resetToken, newPassword: "third attempt should fail now" },
        ctx
      )
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("enforces D1-backed rate limiting and resets after the time window expires", async () => {
    const policy = { maxAttempts: 2, windowMs: 60_000 };
    const r1 = await consumeAuthRateLimit(db, "signin", "ip1:a@b.com", nowMs, policy);
    const r2 = await consumeAuthRateLimit(db, "signin", "ip1:a@b.com", nowMs + 1000, policy);
    const r3 = await consumeAuthRateLimit(db, "signin", "ip1:a@b.com", nowMs + 2000, policy);

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(false);
    expect(r3.retryAfterSeconds).toBeGreaterThan(0);

    // After window passes, requests are allowed again
    const r4 = await consumeAuthRateLimit(db, "signin", "ip1:a@b.com", nowMs + 61_000, policy);
    expect(r4.allowed).toBe(true);
  });
});
