import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { createProjectForUser } from "@/db/queries/projects";
import {
  handleGetMe,
  handleGetProjectById,
  handleListProjects,
  handleSignIn,
  handleSignOut,
  handleSignUp,
  handleVerifyEmail,
  type HttpAuthDeps,
} from "@/lib/auth/http-handlers";
import type { EmailMessage, EmailSender } from "@/lib/email/mailer";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

function createTestMailer() {
  const sent: EmailMessage[] = [];
  const mailer: EmailSender = {
    async send(msg) {
      sent.push(msg);
      return { ok: true, provider: "console", messageId: `m_${sent.length}` };
    },
  };
  return { sent, mailer };
}

function extractToken(text: string): string {
  const match = text.match(/token=([^\s&]+)/);
  if (!match?.[1]) throw new Error("Token not found in test email");
  return decodeURIComponent(match[1]);
}

function cookiePairFromSetCookie(setCookie: string | null): string {
  if (!setCookie) throw new Error("Expected Set-Cookie header");
  return setCookie.split(";")[0] ?? "";
}

describe("Auth & Projects HTTP API (cookies, CSRF, rate limits, and IDOR isolation)", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  let sent: EmailMessage[];
  let deps: HttpAuthDeps;
  const now = new Date("2026-11-21T16:00:00.000Z");

  beforeEach(() => {
    d1Ctx = createInMemoryD1();
    d1Ctx.applyMigrations();
    db = createDb(d1Ctx.d1);
    const mail = createTestMailer();
    sent = mail.sent;
    deps = {
      db,
      mailer: mail.mailer,
      appUrl: "https://collate.app",
      appEnv: "prod",
      turnstileSecretKey: "test-secret",
      nowFn: () => now,
      fetchFn: async () => Response.json({ success: true }),
    };
  });

  afterEach(() => {
    d1Ctx.close();
  });

  async function registerAndSignIn(
    name: string,
    email: string,
    password: string
  ): Promise<{
    cookie: string;
    userId: string;
  }> {
    const signupRes = await handleSignUp(
      new Request("https://collate.app/api/auth/signup", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          "cf-connecting-ip": "203.0.113.5",
        },
        body: JSON.stringify({ name, email, password, turnstileToken: "ok-token" }),
      }),
      deps
    );
    expect(signupRes.status).toBe(201);

    const token = extractToken(sent[sent.length - 1]!.text);
    const verifyRes = await handleVerifyEmail(
      new Request("https://collate.app/api/auth/verify-email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://collate.app" },
        body: JSON.stringify({ token }),
      }),
      deps
    );
    expect(verifyRes.status).toBe(200);

    const signInRes = await handleSignIn(
      new Request("https://collate.app/api/auth/signin", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          "cf-connecting-ip": "203.0.113.5",
        },
        body: JSON.stringify({ email, password, turnstileToken: "ok-token" }),
      }),
      deps
    );
    expect(signInRes.status).toBe(200);

    const setCookie = signInRes.headers.get("set-cookie");
    expect(setCookie).toContain("__Host-collate_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(signInRes.headers.get("cache-control")).toBe("private, no-store");

    const json = (await signInRes.json()) as { ok: boolean; user: { id: string } };
    return { cookie: cookiePairFromSetCookie(setCookie), userId: json.user.id };
  }

  it("enforces two-user project isolation (prevents IDOR) and blocks unauthenticated access", async () => {
    const alice = await registerAndSignIn("Alice Obi", "alice@uni.edu", "quiet autumn cedar desk");
    const bob = await registerAndSignIn("Bob Musa", "bob@uni.edu", "steady coastal tide mark");

    await createProjectForUser(db, {
      id: "prj_alice_private",
      userId: alice.userId,
      type: "thesis",
      title: "Alice Private Thesis",
      now,
    });
    await createProjectForUser(db, {
      id: "prj_bob_private",
      userId: bob.userId,
      type: "research",
      title: "Bob Research Paper",
      now,
    });

    const unauthList = await handleListProjects(
      new Request("https://collate.app/api/projects"),
      deps
    );
    expect(unauthList.status).toBe(401);

    const unauthItem = await handleGetProjectById(
      new Request("https://collate.app/api/projects/prj_alice_private"),
      "prj_alice_private",
      deps
    );
    expect(unauthItem.status).toBe(401);

    const bobListRes = await handleListProjects(
      new Request("https://collate.app/api/projects", { headers: { cookie: bob.cookie } }),
      deps
    );
    expect(bobListRes.status).toBe(200);
    expect(bobListRes.headers.get("cache-control")).toBe("private, no-store");
    const bobList = (await bobListRes.json()) as { projects: Array<{ id: string }> };
    expect(bobList.projects.map((p) => p.id)).toEqual(["prj_bob_private"]);

    const bobStealRes = await handleGetProjectById(
      new Request("https://collate.app/api/projects/prj_alice_private", {
        headers: { cookie: bob.cookie },
      }),
      "prj_alice_private",
      deps
    );
    expect(bobStealRes.status).toBe(404);

    const aliceOwnRes = await handleGetProjectById(
      new Request("https://collate.app/api/projects/prj_alice_private", {
        headers: { cookie: alice.cookie },
      }),
      "prj_alice_private",
      deps
    );
    expect(aliceOwnRes.status).toBe(200);
    const aliceProject = (await aliceOwnRes.json()) as { project: { title: string } };
    expect(aliceProject.project.title).toBe("Alice Private Thesis");
  });

  it("clears session cookie and revokes server session on signout", async () => {
    const alice = await registerAndSignIn(
      "Alice Obi",
      "alice2@uni.edu",
      "bright northern cedar wood"
    );

    const meBefore = await handleGetMe(
      new Request("https://collate.app/api/auth/me", { headers: { cookie: alice.cookie } }),
      deps
    );
    expect(meBefore.status).toBe(200);

    const signOutRes = await handleSignOut(
      new Request("https://collate.app/api/auth/signout", {
        method: "POST",
        headers: { origin: "https://collate.app", cookie: alice.cookie },
      }),
      deps
    );
    expect(signOutRes.status).toBe(200);
    expect(signOutRes.headers.get("set-cookie")).toContain("Max-Age=0");

    const meAfter = await handleGetMe(
      new Request("https://collate.app/api/auth/me", { headers: { cookie: alice.cookie } }),
      deps
    );
    expect(meAfter.status).toBe(401);
  });

  it("rejects cross-origin POST requests with 403 and invalid JSON with 400", async () => {
    const csrfRes = await handleSignIn(
      new Request("https://collate.app/api/auth/signin", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({ email: "a@b.com", password: "test" }),
      }),
      deps
    );
    expect(csrfRes.status).toBe(403);

    const badJsonRes = await handleSignUp(
      new Request("https://collate.app/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://collate.app" },
        body: "{not-json",
      }),
      deps
    );
    expect(badJsonRes.status).toBe(400);
  });

  it("returns 429 with Retry-After header when sign-in rate limit is exceeded", async () => {
    let lastStatus = 200;
    let retryAfter: string | null = null;

    for (let i = 0; i < 11; i++) {
      const res = await handleSignIn(
        new Request("https://collate.app/api/auth/signin", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://collate.app",
            "cf-connecting-ip": "198.51.100.99",
          },
          body: JSON.stringify({
            email: "brute@example.com",
            password: "wrong password attempt",
            turnstileToken: "ok-token",
          }),
        }),
        deps
      );
      lastStatus = res.status;
      retryAfter = res.headers.get("retry-after");
    }

    expect(lastStatus).toBe(429);
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });
});
