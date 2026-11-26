import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { accounts, sessions, users } from "@/db/schema";
import { handleGoogleCallback, handleGoogleStart, type GoogleAuthDeps } from "@/lib/auth/google";
import type { EmailSender } from "@/lib/email/mailer";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

const APP = "https://collateresearch.app";

describe("Google sign-in", () => {
  let d1: InMemoryD1Context;
  let db: AppDb;
  let alerts: string[];
  let profile: Record<string, unknown>;
  let tokenRequests: URLSearchParams[];
  let deps: GoogleAuthDeps;

  beforeEach(() => {
    d1 = createInMemoryD1();
    d1.applyMigrations();
    db = createDb(d1.d1);
    alerts = [];
    tokenRequests = [];
    profile = { sub: "g-123", email: "Ada@Gmail.com", email_verified: true, name: "Ada Obi" };
    const mailer: EmailSender = { send: async () => ({ ok: true, provider: "console" }) };
    deps = {
      db,
      mailer,
      appUrl: APP,
      appEnv: "prod",
      google: { clientId: "cid.apps.googleusercontent.com", clientSecret: "secret" },
      adminNotifier: { send: async (t) => (alerts.push(t), true) },
      fetchFn: async (url, init) => {
        if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
          tokenRequests.push(new URLSearchParams(String(init?.body)));
          return Response.json({ access_token: "at" });
        }
        return Response.json(profile);
      },
    };
  });
  afterEach(() => d1.close());

  async function start(next = "/projects", termsAccepted = true) {
    const res = await handleGoogleStart(
      new Request(
        `${APP}/api/auth/google/start?next=${next}${termsAccepted ? "&terms=accepted" : ""}`
      ),
      deps
    );
    const location = new URL(res.headers.get("location")!);
    const flowCookie = res.headers.get("set-cookie")!.split(";")[0]!;
    return { res, location, flowCookie, state: location.searchParams.get("state")! };
  }

  function callback(state: string, cookie: string) {
    return handleGoogleCallback(
      new Request(`${APP}/api/auth/google/callback?code=abc&state=${state}`, {
        headers: { cookie, "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0" },
      }),
      deps
    );
  }

  it("sends the browser to Google with PKCE and a state cookie", async () => {
    const { res, location, flowCookie } = await start();
    expect(res.status).toBe(302);
    expect(location.origin + location.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    expect(location.searchParams.get("redirect_uri")).toBe(`${APP}/api/auth/google/callback`);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("scope")).toBe("openid email profile");
    expect(flowCookie).toMatch(/^collate_google_flow=[A-Za-z0-9_-]+$/);
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("creates a verified account, signs in, and returns to the requested page", async () => {
    const { state, flowCookie } = await start("/projects");
    const res = await callback(state, flowCookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/projects");
    expect(res.headers.get("set-cookie")).toContain("__Host-collate_session=");
    expect(tokenRequests[0]!.get("code_verifier")).toBeTruthy();
    const [user] = await db.select().from(users).where(eq(users.email, "ada@gmail.com"));
    expect(user).toMatchObject({ name: "Ada Obi", emailVerified: true });
    expect(await db.select().from(sessions)).toHaveLength(1);
    expect(alerts[0]).toContain("Signed up with Google.");
  });

  it("links Google to an existing account with the same email instead of making a second one", async () => {
    const now = new Date();
    await db.insert(users).values({
      id: "usr_old",
      email: "ada@gmail.com",
      emailVerified: false,
      name: "Ada",
      creditsBalance: 5,
      createdAt: now,
      updatedAt: now,
    });
    const { state, flowCookie } = await start();
    await callback(state, flowCookie);
    expect(await db.select().from(users)).toHaveLength(1);
    const [link] = await db.select().from(accounts).where(eq(accounts.providerId, "google"));
    expect(link).toMatchObject({ userId: "usr_old", accountId: "g-123" });
    expect(alerts).toHaveLength(0);
  });

  it("removes a password someone set on an unverified copy of the email before linking", async () => {
    const now = new Date();
    await db.insert(users).values({
      id: "usr_squat",
      email: "ada@gmail.com",
      emailVerified: false,
      name: "Squatter",
      creditsBalance: 0,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(accounts).values({
      id: "acc_squat",
      userId: "usr_squat",
      accountId: "usr_squat",
      providerId: "credential",
      password: "hash-set-by-someone-else",
      createdAt: now,
      updatedAt: now,
    });
    const { state, flowCookie } = await start();
    await callback(state, flowCookie);
    const rows = await db.select().from(accounts).where(eq(accounts.userId, "usr_squat"));
    expect(rows.map((r) => r.providerId)).toEqual(["google"]);
  });

  it("keeps the password of an already verified account when linking", async () => {
    const now = new Date();
    await db.insert(users).values({
      id: "usr_real",
      email: "ada@gmail.com",
      emailVerified: true,
      name: "Ada",
      creditsBalance: 0,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(accounts).values({
      id: "acc_real",
      userId: "usr_real",
      accountId: "usr_real",
      providerId: "credential",
      password: "hash",
      createdAt: now,
      updatedAt: now,
    });
    const { state, flowCookie } = await start();
    await callback(state, flowCookie);
    const rows = await db.select().from(accounts).where(eq(accounts.userId, "usr_real"));
    expect(rows.map((r) => r.providerId).sort()).toEqual(["credential", "google"]);
  });

  it("refuses a callback whose state does not match this browser's", async () => {
    const { flowCookie } = await start();
    const res = await callback("forged-state", flowCookie);
    expect(res.headers.get("location")).toBe("/sign-in?google=error");
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it("refuses an email Google has not verified", async () => {
    profile.email_verified = false;
    const { state, flowCookie } = await start();
    const res = await callback(state, flowCookie);
    expect(res.headers.get("location")).toBe("/sign-in?google=unverified");
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it("will not create a new account without the Terms agreement from the sign-up page", async () => {
    const { state, flowCookie } = await start("/projects", false);
    const res = await callback(state, flowCookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/sign-up?google=terms");
    expect(res.headers.get("set-cookie")).not.toContain("__Host-collate_session=");
    expect(await db.select().from(users).where(eq(users.email, "ada@gmail.com"))).toEqual([]);

    // Once the account exists, signing in with Google needs no tick box.
    const signup = await start("/projects", true);
    await callback(signup.state, signup.flowCookie);
    const again = await start("/projects", false);
    const res2 = await callback(again.state, again.flowCookie);
    expect(res2.headers.get("location")).toBe("/projects");
    expect(res2.headers.get("set-cookie")).toContain("__Host-collate_session=");
  });

  it("ignores unsafe return paths", async () => {
    const { state, flowCookie } = await start("//evil.example/steal");
    const res = await callback(state, flowCookie);
    expect(res.headers.get("location")).toBe("/dashboard");
  });
});
