import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, type AppDb } from "@/db/client";
import { auditLog, users } from "@/db/schema";
import { createEmailSender } from "@/lib/email/mailer";
import { signInUser, signUpUser, verifyEmailToken } from "@/lib/auth/service";
import {
  isValidGaMeasurementId,
  resolveGaMeasurementId,
  resolveSignedInConsent,
  resolveVisitorConsent,
  shouldLoadAnalytics,
  SIGNED_IN_CONSENT_TTL_MS,
} from "@/lib/privacy/cookie-consent";
import { handleGetCookieConsent, handleSaveCookieConsent } from "@/lib/privacy/http-handlers";
import { BASE_SECURITY_HEADERS } from "@/lib/security/headers";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

describe("Cookie consent domain rules and Google Analytics guardrails", () => {
  it("validates GA4 measurement IDs strictly and blocks analytics until explicitly accepted", () => {
    expect(isValidGaMeasurementId("G-G788RL6915")).toBe("G-G788RL6915");
    expect(isValidGaMeasurementId("  g-abc12345  ")).toBe("G-ABC12345");
    expect(isValidGaMeasurementId("")).toBeNull();
    expect(isValidGaMeasurementId("UA-12345-1")).toBeNull();
    expect(isValidGaMeasurementId("G-12345<script>")).toBeNull();

    expect(resolveGaMeasurementId({ NEXT_PUBLIC_GA_MEASUREMENT_ID: "G-G788RL6915" }, {})).toBe(
      "G-G788RL6915"
    );
    expect(resolveGaMeasurementId({}, { NEXT_PUBLIC_GA_MEASUREMENT_ID: "G-FALLBACK1" })).toBe(
      "G-FALLBACK1"
    );

    expect(shouldLoadAnalytics("prompt", "G-G788RL6915")).toBe(false);
    expect(shouldLoadAnalytics("declined", "G-G788RL6915")).toBe(false);
    expect(shouldLoadAnalytics("accepted", null)).toBe(false);
    expect(shouldLoadAnalytics("accepted", "invalid")).toBe(false);
    expect(shouldLoadAnalytics("accepted", "G-G788RL6915")).toBe(true);
  });

  it("keeps signed-in acceptance permanently, expires signed-in declines at 7 days, and keeps visitor decline per-visit", () => {
    const start = new Date("2026-11-26T12:00:00.000Z");

    // Signed-in: missing -> prompt
    expect(resolveSignedInConsent({ choice: null, recordedAt: null }, start)).toEqual({
      status: "prompt",
      expired: false,
      expiresAt: null,
    });

    // Signed-in: accepted -> NEVER expires (even 1 year later)
    const oneYearLater = new Date(start.getTime() + 365 * 24 * 60 * 60 * 1000);
    expect(resolveSignedInConsent({ choice: "accepted", recordedAt: start }, oneYearLater)).toEqual(
      {
        status: "accepted",
        expired: false,
        expiresAt: null,
      }
    );

    // Signed-in: declined -> active before 7 days, expired & re-prompted at 7 days
    const justBefore7Days = new Date(start.getTime() + SIGNED_IN_CONSENT_TTL_MS - 60_000);
    expect(
      resolveSignedInConsent({ choice: "declined", recordedAt: start }, justBefore7Days)
    ).toEqual({
      status: "declined",
      expired: false,
      expiresAt: new Date(start.getTime() + SIGNED_IN_CONSENT_TTL_MS),
    });

    const at7Days = new Date(start.getTime() + SIGNED_IN_CONSENT_TTL_MS);
    expect(resolveSignedInConsent({ choice: "declined", recordedAt: start }, at7Days)).toEqual({
      status: "prompt",
      expired: true,
      expiresAt: null,
    });

    // Random visitors:
    expect(resolveVisitorConsent({ persistedAccepted: false, declinedThisVisit: false })).toBe(
      "prompt"
    );
    expect(resolveVisitorConsent({ persistedAccepted: false, declinedThisVisit: true })).toBe(
      "declined"
    );
    expect(resolveVisitorConsent({ persistedAccepted: true, declinedThisVisit: false })).toBe(
      "accepted"
    );
  });

  it("permits Google Analytics hosts in Content-Security-Policy without weakening other directives", () => {
    const csp = BASE_SECURITY_HEADERS.find(([k]) => k === "Content-Security-Policy")?.[1] ?? "";
    expect(csp).toContain("https://www.googletagmanager.com");
    expect(csp).toContain("https://www.google-analytics.com");
    expect(csp).toContain("https://*.google-analytics.com");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe("Cookie consent HTTP API (permanent signed-in accept, 7-day signed-in decline, CSRF & auth)", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  let sessionCookie: string;
  let userId: string;
  let currentNow = new Date("2026-11-26T12:00:00.000Z");

  const makeDeps = () => ({
    db,
    mailer: createEmailSender({ EMAIL_PROVIDER: "console" }),
    appUrl: "http://localhost:5173",
    appEnv: "dev",
    nowFn: () => currentNow,
  });

  beforeEach(async () => {
    currentNow = new Date("2026-11-26T12:00:00.000Z");
    d1Ctx = createInMemoryD1();
    d1Ctx.applyMigrations();
    db = createDb(d1Ctx.d1);

    let capturedVerifyToken = "";
    const mailer = {
      async send(msg: { text: string }) {
        const match = msg.text.match(/token=([^\s]+)/);
        if (match?.[1]) capturedVerifyToken = decodeURIComponent(match[1]);
        return { ok: true, provider: "console" as const, messageId: "dev_1" };
      },
    };

    await signUpUser(
      {
        name: "Cookie Tester",
        email: "cookie.tester@uni.edu",
        password: "StrongPassword!2026",
        acceptTerms: true,
      },
      {
        db,
        mailer,
        appUrl: "http://localhost:5173",
        clientIp: "127.0.0.1",
        appEnv: "dev",
        nowFn: () => currentNow,
      }
    );
    const verified = await verifyEmailToken(capturedVerifyToken, {
      db,
      nowFn: () => currentNow,
    });
    userId = verified.userId;

    const signedIn = await signInUser(
      { email: "cookie.tester@uni.edu", password: "StrongPassword!2026" },
      {
        db,
        mailer,
        appUrl: "http://localhost:5173",
        clientIp: "127.0.0.1",
        appEnv: "dev",
        nowFn: () => currentNow,
      }
    );
    sessionCookie = `collate_session=${signedIn.rawSessionToken}`;
  });

  afterEach(() => {
    d1Ctx.close();
  });

  async function signInFreshCookie(): Promise<string> {
    const refreshed = await signInUser(
      { email: "cookie.tester@uni.edu", password: "StrongPassword!2026" },
      {
        db,
        mailer: createEmailSender({ EMAIL_PROVIDER: "console" }),
        appUrl: "http://localhost:5173",
        clientIp: "127.0.0.1",
        appEnv: "dev",
        nowFn: () => currentNow,
      }
    );
    return `collate_session=${refreshed.rawSessionToken}`;
  }

  it("returns signedIn: false for visitors and blocks unauthenticated or cross-origin POSTs", async () => {
    const anonGet = await handleGetCookieConsent(
      new Request("http://localhost:5173/api/account/cookie-consent"),
      makeDeps()
    );
    expect(anonGet.status).toBe(200);
    expect(await anonGet.json()).toEqual({
      ok: true,
      signedIn: false,
      status: "prompt",
      expiresAt: null,
    });

    const anonPost = await handleSaveCookieConsent(
      new Request("http://localhost:5173/api/account/cookie-consent", {
        method: "POST",
        headers: {
          origin: "http://localhost:5173",
          "content-type": "application/json",
        },
        body: JSON.stringify({ choice: "accepted" }),
      }),
      makeDeps()
    );
    expect(anonPost.status).toBe(401);

    const csrfPost = await handleSaveCookieConsent(
      new Request("http://localhost:5173/api/account/cookie-consent", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          cookie: sessionCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ choice: "accepted" }),
      }),
      makeDeps()
    );
    expect(csrfPost.status).toBe(403);
  });

  it("persists signed-in acceptance permanently across months while expiring signed-in declines after 7 days", async () => {
    const initialGet = await handleGetCookieConsent(
      new Request("http://localhost:5173/api/account/cookie-consent", {
        headers: { cookie: sessionCookie },
      }),
      makeDeps()
    );
    expect(await initialGet.json()).toEqual({
      ok: true,
      signedIn: true,
      status: "prompt",
      expiresAt: null,
    });

    // Reject invalid payload
    const badPost = await handleSaveCookieConsent(
      new Request("http://localhost:5173/api/account/cookie-consent", {
        method: "POST",
        headers: {
          origin: "http://localhost:5173",
          cookie: sessionCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ choice: "maybe" }),
      }),
      makeDeps()
    );
    expect(badPost.status).toBe(400);

    // 1. Save "accepted" -> permanent (expiresAt: null)
    const acceptRes = await handleSaveCookieConsent(
      new Request("http://localhost:5173/api/account/cookie-consent", {
        method: "POST",
        headers: {
          origin: "http://localhost:5173",
          cookie: sessionCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ choice: "accepted" }),
      }),
      makeDeps()
    );
    expect(acceptRes.status).toBe(200);
    expect(await acceptRes.json()).toEqual({
      ok: true,
      choice: "accepted",
      expiresAt: null,
    });

    const audits = await db.select().from(auditLog).where(eq(auditLog.actorUserId, userId));
    expect(audits.some((a) => a.action === "privacy.cookie_consent_updated")).toBe(true);

    // Advance 90 days -> signed-in acceptance MUST still be active and NOT discarded
    currentNow = new Date(currentNow.getTime() + 90 * 24 * 60 * 60 * 1000);
    const cookieDay90 = await signInFreshCookie();
    const day90Get = await handleGetCookieConsent(
      new Request("http://localhost:5173/api/account/cookie-consent", {
        headers: { cookie: cookieDay90 },
      }),
      makeDeps()
    );
    expect(await day90Get.json()).toEqual({
      ok: true,
      signedIn: true,
      status: "accepted",
      expiresAt: null,
    });

    // 2. Now switch to "declined" -> has a 7-day expiry
    const declineStart = new Date(currentNow.getTime());
    const declineRes = await handleSaveCookieConsent(
      new Request("http://localhost:5173/api/account/cookie-consent", {
        method: "POST",
        headers: {
          origin: "http://localhost:5173",
          cookie: cookieDay90,
          "content-type": "application/json",
        },
        body: JSON.stringify({ choice: "declined" }),
      }),
      makeDeps()
    );
    expect(declineRes.status).toBe(200);
    const declineJson = (await declineRes.json()) as {
      ok: boolean;
      choice: string;
      expiresAt: string | null;
    };
    expect(declineJson.choice).toBe("declined");
    expect(declineJson.expiresAt).toBe(
      new Date(declineStart.getTime() + SIGNED_IN_CONSENT_TTL_MS).toISOString()
    );

    // Day 6 after declining -> still declined
    currentNow = new Date(declineStart.getTime() + 6 * 24 * 60 * 60 * 1000);
    const cookieDay6 = await signInFreshCookie();
    const day6Get = await handleGetCookieConsent(
      new Request("http://localhost:5173/api/account/cookie-consent", {
        headers: { cookie: cookieDay6 },
      }),
      makeDeps()
    );
    const day6Json = (await day6Get.json()) as { status: string; signedIn: boolean };
    expect(day6Json.signedIn).toBe(true);
    expect(day6Json.status).toBe("declined");

    // Day 7 + 1 minute -> decline MUST be discarded in D1 and return status: "prompt"
    currentNow = new Date(declineStart.getTime() + SIGNED_IN_CONSENT_TTL_MS + 60_000);
    const day7Get = await handleGetCookieConsent(
      new Request("http://localhost:5173/api/account/cookie-consent", {
        headers: { cookie: cookieDay6 },
      }),
      makeDeps()
    );
    expect(await day7Get.json()).toEqual({
      ok: true,
      signedIn: true,
      status: "prompt",
      expiresAt: null,
    });

    const [afterDiscard] = await db
      .select({
        analyticsConsent: users.analyticsConsent,
        analyticsConsentAt: users.analyticsConsentAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    expect(afterDiscard?.analyticsConsent).toBeNull();
    expect(afterDiscard?.analyticsConsentAt).toBeNull();
  });
});
