import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { authCodes, users } from "@/db/schema";
import {
  checkCode,
  type CodePurpose,
  generateNumericCode,
  grantMarker,
  hasMarker,
  issueCode,
  MAX_CODE_ATTEMPTS,
} from "@/lib/auth/codes";
import {
  exchangeResetCodeForToken,
  requestPasswordReset,
  resendVerificationEmail,
  resetPasswordWithToken,
  signInUser,
  signUpUser,
  verifyEmailWithCode,
  type AuthServiceContext,
} from "@/lib/auth/service";
import type { EmailMessage, EmailSender } from "@/lib/email/mailer";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

const T0 = new Date("2026-11-26T10:00:00.000Z");
const minutes = (m: number) => new Date(T0.getTime() + m * 60_000);
const codeIn = (text: string) => text.match(/\b(\d{6})\b/)![1]!;

describe("one-time codes", () => {
  let d1: InMemoryD1Context;
  let db: AppDb;
  beforeEach(async () => {
    d1 = createInMemoryD1();
    d1.applyMigrations();
    db = createDb(d1.d1);
    await db.insert(users).values({
      id: "usr_1",
      email: "ada@uni.edu.ng",
      emailVerified: false,
      name: "Ada",
      creditsBalance: 0,
      createdAt: T0,
      updatedAt: T0,
    });
  });
  afterEach(() => d1.close());

  const check = (code: string, at = minutes(1), purpose: CodePurpose = "verify_email") =>
    checkCode(db, { userId: "usr_1", purpose, code, now: at });

  it("generates 6-digit codes", () => {
    for (let i = 0; i < 200; i++) expect(generateNumericCode()).toMatch(/^\d{6}$/);
  });

  it("stores only a hash and accepts the code once", async () => {
    const code = await issueCode(db, { userId: "usr_1", purpose: "verify_email", now: T0 });
    const [row] = await db.select().from(authCodes);
    expect(row!.codeHash).not.toContain(code);
    expect(await check(code)).toEqual({ ok: true, target: null });
    expect(await check(code)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a code after 10 minutes, even if it is right", async () => {
    const code = await issueCode(db, { userId: "usr_1", purpose: "verify_email", now: T0 });
    expect(await check(code, minutes(10))).toEqual({ ok: false, reason: "expired" });
    expect(await check(code, minutes(9))).toEqual({ ok: false, reason: "invalid" });
  });

  it("destroys the previous code when a new one is sent, even if unused", async () => {
    const first = await issueCode(db, { userId: "usr_1", purpose: "verify_email", now: T0 });
    let second = await issueCode(db, { userId: "usr_1", purpose: "verify_email", now: T0 });
    while (second === first) {
      second = await issueCode(db, { userId: "usr_1", purpose: "verify_email", now: T0 });
    }
    expect(await check(first)).toEqual({ ok: false, reason: "invalid" });
    expect(await check(second)).toEqual({ ok: true, target: null });
  });

  it("kills the code after 5 wrong guesses, so the right one stops working", async () => {
    const code = await issueCode(db, { userId: "usr_1", purpose: "verify_email", now: T0 });
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) {
      expect(await check(wrong)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(await check(wrong)).toEqual({ ok: false, reason: "too_many_attempts" });
    expect(await check(code)).toEqual({ ok: false, reason: "invalid" });
  });

  it("never accepts a code for a different purpose", async () => {
    const code = await issueCode(db, { userId: "usr_1", purpose: "reset_password", now: T0 });
    expect(await check(code, minutes(1), "verify_email")).toEqual({ ok: false, reason: "invalid" });
  });

  it("accepts spaces and dashes the user types, but not other lengths", async () => {
    const code = await issueCode(db, { userId: "usr_1", purpose: "verify_email", now: T0 });
    expect(await check(code.slice(0, 5))).toEqual({ ok: false, reason: "invalid" });
    expect(await check(`${code.slice(0, 3)} ${code.slice(3)}`)).toEqual({ ok: true, target: null });
  });

  it("keeps the target with the code and expires markers", async () => {
    const code = await issueCode(db, {
      userId: "usr_1",
      purpose: "email_change_new",
      target: "new@uni.edu.ng",
      now: T0,
    });
    expect(await check(code, minutes(1), "email_change_new")).toEqual({
      ok: true,
      target: "new@uni.edu.ng",
    });
    await grantMarker(db, { userId: "usr_1", purpose: "email_change_authorized", now: T0 });
    expect(
      await hasMarker(db, { userId: "usr_1", purpose: "email_change_authorized", now: minutes(14) })
    ).toBe(true);
    expect(
      await hasMarker(db, { userId: "usr_1", purpose: "email_change_authorized", now: minutes(15) })
    ).toBe(false);
  });
});

describe("sign-up and password reset with codes", () => {
  let d1: InMemoryD1Context;
  let db: AppDb;
  let sent: EmailMessage[];
  let ctx: AuthServiceContext;
  beforeEach(() => {
    d1 = createInMemoryD1();
    d1.applyMigrations();
    db = createDb(d1.d1);
    sent = [];
    const mailer: EmailSender = {
      async send(message) {
        sent.push(message);
        return { ok: true, provider: "console" };
      },
    };
    ctx = {
      db,
      mailer,
      appUrl: "https://collateresearch.app",
      clientIp: "203.0.113.9",
      appEnv: "dev",
      nowFn: () => T0,
    };
  });
  afterEach(() => d1.close());

  it("verifies a new account with the emailed code, and a resend replaces it", async () => {
    await signUpUser(
      {
        name: "Ada Obi",
        email: "ada@uni.edu.ng",
        password: "quiet library oak shelf",
        acceptTerms: true,
      },
      ctx
    );
    const firstCode = codeIn(sent[0]!.text);
    expect(sent[0]!.text).toContain("verify-email?token=");

    await resendVerificationEmail("ada@uni.edu.ng", ctx);
    const secondCode = codeIn(sent[1]!.text);
    if (secondCode !== firstCode) {
      await expect(
        verifyEmailWithCode({ email: "ada@uni.edu.ng", code: firstCode }, ctx)
      ).rejects.toThrow(/not right/);
    }
    await expect(
      verifyEmailWithCode({ email: "ada@uni.edu.ng", code: secondCode }, ctx)
    ).resolves.toMatchObject({
      verified: true,
    });
    await expect(
      signInUser({ email: "ada@uni.edu.ng", password: "quiet library oak shelf" }, ctx)
    ).resolves.toHaveProperty("rawSessionToken");
  });

  it("does not reveal whether an email has an account", async () => {
    await expect(
      verifyEmailWithCode({ email: "nobody@x.com", code: "123456" }, ctx)
    ).rejects.toThrow(/not right/);
    const reply = await requestPasswordReset("nobody@x.com", ctx);
    expect(reply.message).toBe(
      "If an account exists for that email, we sent a 6-digit reset code."
    );
    expect(sent).toHaveLength(0);
  });

  it("resets a password with code -> one-time token -> new password", async () => {
    await signUpUser(
      {
        name: "Ada Obi",
        email: "ada@uni.edu.ng",
        password: "quiet library oak shelf",
        acceptTerms: true,
      },
      ctx
    );
    await verifyEmailWithCode({ email: "ada@uni.edu.ng", code: codeIn(sent[0]!.text) }, ctx);
    await requestPasswordReset("ada@uni.edu.ng", ctx);
    const { resetToken } = await exchangeResetCodeForToken(
      { email: "ada@uni.edu.ng", code: codeIn(sent[1]!.text) },
      ctx
    );
    await resetPasswordWithToken({ token: resetToken, newPassword: "brand new reading lamp" }, ctx);
    await expect(
      resetPasswordWithToken({ token: resetToken, newPassword: "another fresh phrase here" }, ctx)
    ).rejects.toThrow(/invalid or expired/);
    await expect(
      signInUser({ email: "ada@uni.edu.ng", password: "brand new reading lamp" }, ctx)
    ).resolves.toHaveProperty("rawSessionToken");
  });

  it("rate-limits guessing a code by IP and email", async () => {
    await signUpUser(
      {
        name: "Ada Obi",
        email: "ada@uni.edu.ng",
        password: "quiet library oak shelf",
        acceptTerms: true,
      },
      ctx
    );
    let limited = false;
    for (let i = 0; i < 20 && !limited; i++) {
      try {
        await verifyEmailWithCode({ email: "ada@uni.edu.ng", code: "000001" }, ctx);
      } catch (err) {
        if ((err as { code?: string }).code === "RATE_LIMITED") limited = true;
      }
    }
    expect(limited).toBe(true);
  });
});
