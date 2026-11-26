import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { describeDevice, describeLocation } from "@/lib/account/device";
import {
  handleChangePassword,
  handleEmailChangeConfirm,
  handleEmailChangeSendNew,
  handleEmailChangeStart,
  handleEmailChangeVerifyCurrent,
  handleListSessions,
  handleRevokeSessions,
  handleUpdateName,
} from "@/lib/account/security";
import {
  handleSignIn,
  handleSignUp,
  handleVerifyCode,
  type HttpAuthDeps,
} from "@/lib/auth/http-handlers";
import type { EmailMessage, EmailSender } from "@/lib/email/mailer";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

const APP = "https://collateresearch.app";
const codeIn = (text: string) => text.match(/\b(\d{6})\b/)![1]!;

describe("account security endpoints", () => {
  let d1: InMemoryD1Context;
  let db: AppDb;
  let sent: EmailMessage[];
  let deps: HttpAuthDeps;

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
    deps = {
      db,
      mailer,
      appUrl: APP,
      appEnv: "prod",
      turnstileSecretKey: "test",
      fetchFn: async () => Response.json({ success: true }),
    };
  });
  afterEach(() => d1.close());

  function req(path: string, body?: unknown, cookie = "", extra: Record<string, string> = {}) {
    return new Request(`${APP}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", origin: APP, cookie, ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async function signIn(
    email: string,
    password: string,
    ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36"
  ) {
    const r = req("/api/auth/signin", { email, password, turnstileToken: "ok" }, "", {
      "user-agent": ua,
    });
    Object.defineProperty(r, "cf", { value: { city: "Lagos", country: "NG" } });
    const res = await handleSignIn(r, deps);
    expect(res.status).toBe(200);
    return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
  }

  async function createAccount(name: string, email: string, password: string) {
    await handleSignUp(
      req("/api/auth/signup", { name, email, password, turnstileToken: "ok", acceptTerms: true }),
      deps
    );
    const code = codeIn(sent[sent.length - 1]!.text);
    const verified = await handleVerifyCode(req("/api/auth/verify-code", { email, code }), deps);
    expect(verified.status).toBe(200);
    return signIn(email, password);
  }

  it("refuses signed-out and cross-site requests", async () => {
    expect((await handleUpdateName(req("/api/account/name", { name: "X Y" }), deps)).status).toBe(
      401
    );
    const cookie = await createAccount("Ada Obi", "ada@uni.edu.ng", "quiet library oak shelf");
    const crossSite = req("/api/account/name", { name: "Mallory" }, cookie, {
      origin: "https://evil.example",
    });
    expect((await handleUpdateName(crossSite, deps)).status).toBe(403);
  });

  it("changes the display name", async () => {
    const cookie = await createAccount("Ada Obi", "ada@uni.edu.ng", "quiet library oak shelf");
    const res = await handleUpdateName(
      req("/api/account/name", { name: "  Ada N. Obi " }, cookie),
      deps
    );
    expect(res.status).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.email, "ada@uni.edu.ng"));
    expect(row!.name).toBe("Ada N. Obi");
  });

  it("changes the password only with the current one and signs out other devices", async () => {
    const pw = "quiet library oak shelf";
    const laptop = await createAccount("Ada Obi", "ada@uni.edu.ng", pw);
    const phone = await signIn(
      "ada@uni.edu.ng",
      pw,
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Version/18.0 Mobile Safari/604.1"
    );

    const wrong = await handleChangePassword(
      req(
        "/api/account/password",
        { currentPassword: "not my password at all", newPassword: "fresh reading lamp tonight" },
        laptop
      ),
      deps
    );
    expect(wrong.status).toBe(401);

    const ok = await handleChangePassword(
      req(
        "/api/account/password",
        { currentPassword: pw, newPassword: "fresh reading lamp tonight" },
        laptop
      ),
      deps
    );
    expect(ok.status).toBe(200);
    expect(sent[sent.length - 1]!.subject).toBe("Your Collate password was changed");
    // The phone was signed out; the laptop is still signed in.
    expect(
      (await handleListSessions(req("/api/account/sessions", undefined, phone), deps)).status
    ).toBe(401);
    expect(
      (await handleListSessions(req("/api/account/sessions", undefined, laptop), deps)).status
    ).toBe(200);
    await signIn("ada@uni.edu.ng", "fresh reading lamp tonight");
  });

  it("changes the email only after confirming both the current and the new address", async () => {
    const cookie = await createAccount("Ada Obi", "ada@uni.edu.ng", "quiet library oak shelf");
    await createAccount("Bayo", "bayo@uni.edu.ng", "warm archival cedar wood");

    // Cannot skip straight to the new address.
    const early = await handleEmailChangeSendNew(
      req("/api/account/email/send-new", { newEmail: "new@uni.edu.ng" }, cookie),
      deps
    );
    expect(early.status).toBe(403);

    await handleEmailChangeStart(req("/api/account/email/start", {}, cookie), deps);
    expect(sent[sent.length - 1]!.to).toBe("ada@uni.edu.ng");
    const currentCode = codeIn(sent[sent.length - 1]!.text);
    expect(
      (
        await handleEmailChangeVerifyCurrent(
          req(
            "/api/account/email/verify-current",
            { code: "000000" === currentCode ? "111111" : "000000" },
            cookie
          ),
          deps
        )
      ).status
    ).toBe(400);
    expect(
      (
        await handleEmailChangeVerifyCurrent(
          req("/api/account/email/verify-current", { code: currentCode }, cookie),
          deps
        )
      ).status
    ).toBe(200);

    const taken = await handleEmailChangeSendNew(
      req("/api/account/email/send-new", { newEmail: "bayo@uni.edu.ng" }, cookie),
      deps
    );
    expect(taken.status).toBe(400);
    const sendNew = await handleEmailChangeSendNew(
      req("/api/account/email/send-new", { newEmail: "New@Uni.edu.ng" }, cookie),
      deps
    );
    expect(sendNew.status).toBe(200);
    expect(sent[sent.length - 1]!.to).toBe("new@uni.edu.ng");

    const confirm = await handleEmailChangeConfirm(
      req("/api/account/email/confirm", { code: codeIn(sent[sent.length - 1]!.text) }, cookie),
      deps
    );
    expect(confirm.status).toBe(200);
    expect(sent[sent.length - 1]!.to).toBe("ada@uni.edu.ng");
    expect(sent[sent.length - 1]!.subject).toBe("Your Collate email address was changed");
    await signIn("new@uni.edu.ng", "quiet library oak shelf");
    // The same code cannot be used twice.
    const replay = await handleEmailChangeConfirm(
      req("/api/account/email/confirm", { code: "123456" }, cookie),
      deps
    );
    expect(replay.status).toBe(403);
  });

  it("lists devices with location and signs out one, then all others, never another user's", async () => {
    const pw = "quiet library oak shelf";
    const laptop = await createAccount("Ada Obi", "ada@uni.edu.ng", pw);
    await signIn(
      "ada@uni.edu.ng",
      pw,
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Version/18.0 Mobile Safari/604.1"
    );
    await signIn(
      "ada@uni.edu.ng",
      pw,
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0 Mobile Safari/537.36"
    );
    const bayo = await createAccount("Bayo", "bayo@uni.edu.ng", "warm archival cedar wood");

    const list = (await (
      await handleListSessions(req("/api/account/sessions", undefined, laptop), deps)
    ).json()) as {
      sessions: Array<{ id: string; current: boolean; device: string; location: string | null }>;
    };
    expect(list.sessions).toHaveLength(3);
    expect(list.sessions[0]).toMatchObject({
      current: true,
      device: "Chrome on Windows",
      location: "Lagos, Nigeria",
    });
    expect(list.sessions.map((s) => s.device).sort()).toEqual([
      "Chrome on Android",
      "Chrome on Windows",
      "Safari on iPhone",
    ]);

    // Bayo cannot sign out Ada's phone.
    const phoneId = list.sessions.find((s) => s.device === "Safari on iPhone")!.id;
    expect(
      (
        await handleRevokeSessions(
          req("/api/account/sessions/revoke", { sessionId: phoneId }, bayo),
          deps
        )
      ).status
    ).toBe(404);
    expect(
      (
        await handleRevokeSessions(
          req("/api/account/sessions/revoke", { sessionId: phoneId }, laptop),
          deps
        )
      ).status
    ).toBe(200);

    const all = await handleRevokeSessions(
      req("/api/account/sessions/revoke", { allOthers: true }, laptop),
      deps
    );
    expect(await all.json()).toMatchObject({ ok: true, signedOut: 1 });
    const left = await db.select().from(sessions);
    // Ada's laptop and Bayo's session remain.
    expect(left).toHaveLength(2);
  });
});

describe("device and location labels", () => {
  it("names common browsers and systems", () => {
    expect(
      describeDevice(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15"
      ).label
    ).toBe("Safari on macOS");
    expect(
      describeDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36 Edg/130.0"
      ).label
    ).toBe("Edge on Windows");
    expect(
      describeDevice("Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0").label
    ).toBe("Firefox on Linux");
    expect(describeDevice(null).label).toBe("Unknown device");
    expect(describeLocation(null, null)).toBeNull();
    expect(describeLocation("Accra", "GH")).toBe("Accra, Ghana");
  });
});
