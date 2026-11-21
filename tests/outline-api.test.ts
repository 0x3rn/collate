import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { setOutlineLockForUser } from "@/db/queries/outline";
import { createWizardDraftProject, saveWizardStepForUser } from "@/db/queries/wizard";
import {
  handleSignIn,
  handleSignUp,
  handleVerifyEmail,
  type HttpAuthDeps,
} from "@/lib/auth/http-handlers";
import type { EmailMessage, EmailSender } from "@/lib/email/mailer";
import {
  handleGetOutline,
  handleSaveOutline,
  handleUnlockOutline,
} from "@/lib/outline/http-handlers";
import type { ProjectOutlinePlan } from "@/lib/outline/planner";
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
  if (!match?.[1]) throw new Error("Token not found");
  return decodeURIComponent(match[1]);
}

describe("Phase 5 — Outline HTTP API (confirmation, locking, CSRF & IDOR isolation)", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  let sent: EmailMessage[];
  let deps: HttpAuthDeps;
  const now = new Date("2026-11-21T22:30:00.000Z");

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

  async function signUpCookie(name: string, email: string, password: string) {
    await handleSignUp(
      new Request("https://collate.app/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://collate.app" },
        body: JSON.stringify({ name, email, password, turnstileToken: "ok" }),
      }),
      deps
    );
    const token = extractToken(sent[sent.length - 1]!.text);
    await handleVerifyEmail(
      new Request("https://collate.app/api/auth/verify-email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://collate.app" },
        body: JSON.stringify({ token }),
      }),
      deps
    );
    const res = await handleSignIn(
      new Request("https://collate.app/api/auth/signin", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://collate.app" },
        body: JSON.stringify({ email, password, turnstileToken: "ok" }),
      }),
      deps
    );
    const json = (await res.json()) as { user: { id: string } };
    return {
      cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
      userId: json.user.id,
    };
  }

  it("enforces custom-chapter confirmation, lock 409, explicit unlock, and two-user isolation", async () => {
    const alice = await signUpCookie("Alice", "alice.out@uni.edu", "steady archival cedar desk");
    const bob = await signUpCookie("Bob", "bob.out@uni.edu", "quiet southern timber shelf");

    const draft = await createWizardDraftProject(db, alice.userId, "thesis", now);
    await saveWizardStepForUser(
      db,
      alice.userId,
      draft.project.id,
      { step: 4, targetPages: 60 },
      now
    );
    await saveWizardStepForUser(
      db,
      alice.userId,
      draft.project.id,
      {
        step: 5,
        chapters: [
          { number: 1, title: "Introduction" },
          { number: 2, title: "West African Policy Context" },
          { number: 3, title: "Conclusion" },
        ],
        frontMatter: draft.settings.frontMatter,
      },
      now
    );

    const bobGet = await handleGetOutline(
      new Request(`https://collate.app/api/projects/${draft.project.id}/outline`, {
        headers: { cookie: bob.cookie },
      }),
      draft.project.id,
      deps
    );
    expect(bobGet.status).toBe(404);

    const getRes = await handleGetOutline(
      new Request(`https://collate.app/api/projects/${draft.project.id}/outline`, {
        headers: { cookie: alice.cookie },
      }),
      draft.project.id,
      deps
    );
    expect(getRes.status).toBe(200);
    const loaded = (await getRes.json()) as { outline: ProjectOutlinePlan };
    expect(loaded.outline.chapters[1]?.needsConfirmation).toBe(true);
    expect(loaded.outline.chapters[1]?.purposeConfirmed).toBe(false);

    const unconfirmedSave = await handleSaveOutline(
      new Request(`https://collate.app/api/projects/${draft.project.id}/outline`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: alice.cookie,
        },
        body: JSON.stringify(loaded.outline),
      }),
      draft.project.id,
      deps
    );
    expect(unconfirmedSave.status).toBe(400);

    loaded.outline.chapters[1]!.purposeConfirmed = true;
    const confirmedSave = await handleSaveOutline(
      new Request(`https://collate.app/api/projects/${draft.project.id}/outline`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: alice.cookie,
        },
        body: JSON.stringify(loaded.outline),
      }),
      draft.project.id,
      deps
    );
    expect(confirmedSave.status).toBe(200);

    await setOutlineLockForUser(db, alice.userId, draft.project.id, true, now);
    const lockedPut = await handleSaveOutline(
      new Request(`https://collate.app/api/projects/${draft.project.id}/outline`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: alice.cookie,
        },
        body: JSON.stringify(loaded.outline),
      }),
      draft.project.id,
      deps
    );
    expect(lockedPut.status).toBe(409);

    const unlockRes = await handleUnlockOutline(
      new Request(`https://collate.app/api/projects/${draft.project.id}/outline/unlock`, {
        method: "POST",
        headers: { origin: "https://collate.app", cookie: alice.cookie },
      }),
      draft.project.id,
      deps
    );
    expect(unlockRes.status).toBe(200);

    const afterUnlockPut = await handleSaveOutline(
      new Request(`https://collate.app/api/projects/${draft.project.id}/outline`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: alice.cookie,
        },
        body: JSON.stringify(loaded.outline),
      }),
      draft.project.id,
      deps
    );
    expect(afterUnlockPut.status).toBe(200);
  });
});
