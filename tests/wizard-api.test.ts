import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import {
  handleSignIn,
  handleSignUp,
  handleVerifyEmail,
  type HttpAuthDeps,
} from "@/lib/auth/http-handlers";
import type { EmailMessage, EmailSender } from "@/lib/email/mailer";
import {
  handleCreateProjectDraft,
  handleGetWizardState,
  handleSaveWizardStep,
  handleUpdateProjectSettings,
  type SerializedWizardState,
} from "@/lib/wizard/http-handlers";
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

describe("Phase 2 Setup Wizard HTTP API", () => {
  let d1Ctx: InMemoryD1Context;
  let db: AppDb;
  let sent: EmailMessage[];
  let deps: HttpAuthDeps;
  const now = new Date("2026-11-21T18:00:00.000Z");

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

  async function signUpAndGetCookie(
    name: string,
    email: string,
    password: string
  ): Promise<string> {
    const signup = await handleSignUp(
      new Request("https://collate.app/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://collate.app" },
        body: JSON.stringify({ name, email, password, turnstileToken: "ok", acceptTerms: true }),
      }),
      deps
    );
    expect(signup.status).toBe(201);

    const token = extractToken(sent[sent.length - 1]!.text);
    await handleVerifyEmail(
      new Request("https://collate.app/api/auth/verify-email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://collate.app" },
        body: JSON.stringify({ token }),
      }),
      deps
    );

    const signin = await handleSignIn(
      new Request("https://collate.app/api/auth/signin", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://collate.app" },
        body: JSON.stringify({ email, password, turnstileToken: "ok" }),
      }),
      deps
    );
    expect(signin.status).toBe(200);
    return (signin.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  }

  it("blocks unauthenticated callers (401) and cross-origin mutations (403)", async () => {
    const unauthCreate = await handleCreateProjectDraft(
      new Request("https://collate.app/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://collate.app" },
        body: JSON.stringify({ type: "thesis" }),
      }),
      deps
    );
    expect(unauthCreate.status).toBe(401);

    const csrfCreate = await handleCreateProjectDraft(
      new Request("https://collate.app/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({ type: "thesis" }),
      }),
      deps
    );
    expect(csrfCreate.status).toBe(403);
  });

  it("runs a full resumable Thesis wizard over HTTP and isolates it from other users", async () => {
    const aliceCookie = await signUpAndGetCookie(
      "Alice Obi",
      "alice.wiz@uni.edu",
      "calm cedar reading room"
    );
    const bobCookie = await signUpAndGetCookie(
      "Bob Musa",
      "bob.wiz@uni.edu",
      "warm linen folio press"
    );

    const createRes = await handleCreateProjectDraft(
      new Request("https://collate.app/api/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: aliceCookie,
        },
        body: JSON.stringify({ type: "thesis" }),
      }),
      deps
    );
    expect(createRes.status).toBe(201);
    expect(createRes.headers.get("cache-control")).toBe("private, no-store");
    const created = (await createRes.json()) as { ok: true; wizard: SerializedWizardState };
    const projectId = created.wizard.project.id;

    const bobGet = await handleGetWizardState(
      new Request(`https://collate.app/api/projects/${projectId}/wizard`, {
        headers: { cookie: bobCookie },
      }),
      projectId,
      deps
    );
    expect(bobGet.status).toBe(404);

    const bobPatch = await handleSaveWizardStep(
      new Request(`https://collate.app/api/projects/${projectId}/wizard`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: bobCookie,
        },
        body: JSON.stringify({ step: 2, title: "Bob Tampering Attempt" }),
      }),
      projectId,
      deps
    );
    expect(bobPatch.status).toBe(404);

    const patch = (payload: Record<string, unknown>, overrideDeps: HttpAuthDeps = deps) =>
      handleSaveWizardStep(
        new Request(`https://collate.app/api/projects/${projectId}/wizard`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            origin: "https://collate.app",
            cookie: aliceCookie,
          },
          body: JSON.stringify(payload),
        }),
        projectId,
        overrideDeps
      );

    const step2Res = await patch({
      step: 2,
      title: "Urban Flood Resilience in Lagos",
      level: "Masters",
      isExperimental: true,
      experimentalDataMode: "published_benchmarks",
    });
    expect(step2Res.status).toBe(200);
    const step2Body = (await step2Res.json()) as { ok: true; wizard: SerializedWizardState };
    expect(step2Body.wizard.settings.isExperimental).toBe(true);
    expect(step2Body.wizard.settings.experimentalDataMode).toBe("published_benchmarks");

    // Document-wide page size endpoint: Alice switches to US Letter, Bob is blocked (404)
    const bobPageSizeRes = await handleUpdateProjectSettings(
      new Request(`https://collate.app/api/projects/${projectId}/settings`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: bobCookie,
        },
        body: JSON.stringify({ pageSize: "letter" }),
      }),
      projectId,
      deps
    );
    expect(bobPageSizeRes.status).toBe(404);

    const alicePageSizeRes = await handleUpdateProjectSettings(
      new Request(`https://collate.app/api/projects/${projectId}/settings`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          origin: "https://collate.app",
          cookie: aliceCookie,
        },
        body: JSON.stringify({ pageSize: "letter" }),
      }),
      projectId,
      deps
    );
    expect(alicePageSizeRes.status).toBe(200);
    expect(await alicePageSizeRes.json()).toEqual({ ok: true, pageSize: "letter" });

    const reloadedRes = await handleGetWizardState(
      new Request(`https://collate.app/api/projects/${projectId}/wizard`, {
        headers: { cookie: aliceCookie },
      }),
      projectId,
      deps
    );
    const reloadedJson = (await reloadedRes.json()) as { wizard: SerializedWizardState };
    expect(reloadedJson.wizard.settings.pageSize).toBe("letter");

    // NN-1 production guard: simulated verdicts are strictly forbidden in prod (403)
    const prodMockBlocked = await patch({ step: 3, simulateVerdict: "feasible" });
    expect(prodMockBlocked.status).toBe(403);

    // Local dev preview works only when appEnv === "dev"
    expect(
      (await patch({ step: 3, simulateVerdict: "feasible" }, { ...deps, appEnv: "dev" })).status
    ).toBe(200);
    expect((await patch({ step: 4, targetPages: 75 })).status).toBe(200);

    const dupRes = await patch({
      step: 5,
      chapters: [
        { number: 1, title: "Introduction" },
        { number: 1, title: "Also One" },
      ],
      frontMatter: created.wizard.settings.frontMatter,
    });
    expect(dupRes.status).toBe(400);

    expect(
      (
        await patch({
          step: 5,
          chapters: [
            { number: 1, title: "Introduction" },
            { number: 2, title: "Literature Review" },
            { number: 3, title: "Methodology" },
            { number: 4, title: "Findings" },
            { number: 5, title: "Conclusion" },
          ],
          frontMatter: { ...created.wizard.settings.frontMatter, preface: true },
        })
      ).status
    ).toBe(200);

    expect(
      (await patch({ step: 6, citationStyle: "ieee", inlineMode: "inline_and_list" })).status
    ).toBe(200);
    expect(
      (
        await patch({
          step: 7,
          font: "Times New Roman",
          fontSizePt: 12,
          lineSpacing: "double",
          marginsMm: 25,
          pageNumbering: true,
          spelling: "uk",
          cover: {
            authorName: "Alice Obi",
            institution: "UNILAG",
            department: "Civil Engineering",
            supervisor: "Dr. B. Balogun",
            submissionDate: "November 2026",
          },
        })
      ).status
    ).toBe(200);

    const confirmRes = await patch({ step: 8, confirmed: true });
    expect(confirmRes.status).toBe(200);

    const reloadRes = await handleGetWizardState(
      new Request(`https://collate.app/api/projects/${projectId}/wizard`, {
        headers: { cookie: aliceCookie },
      }),
      projectId,
      deps
    );
    expect(reloadRes.status).toBe(200);
    const reloaded = (await reloadRes.json()) as { ok: true; wizard: SerializedWizardState };
    expect(reloaded.wizard.project.status).toBe("outline_pending");
    expect(reloaded.wizard.project.targetPages).toBe(75);
    expect(reloaded.wizard.chapters).toHaveLength(6);
    expect(reloaded.wizard.chapters[5]?.isAutoReferences).toBe(true);
    expect(reloaded.wizard.settings.citationStyle).toBe("ieee");
  });

  it("handles a 5-question Assignment path cleanly over HTTP", async () => {
    const cookie = await signUpAndGetCookie(
      "Chidi Eze",
      "chidi.assign@uni.edu",
      "quiet archival leather spine"
    );

    const createRes = await handleCreateProjectDraft(
      new Request("https://collate.app/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://collate.app", cookie },
        body: JSON.stringify({ type: "assignment" }),
      }),
      deps
    );
    const created = (await createRes.json()) as { wizard: SerializedWizardState };
    const projectId = created.wizard.project.id;

    const patch = (payload: Record<string, unknown>) =>
      handleSaveWizardStep(
        new Request(`https://collate.app/api/projects/${projectId}/wizard`, {
          method: "PATCH",
          headers: { "content-type": "application/json", origin: "https://collate.app", cookie },
          body: JSON.stringify(payload),
        }),
        projectId,
        deps
      );

    const step2 = await patch({
      step: 2,
      title: "Public Economics Problem Set",
      questions: [
        "Explain Pigouvian taxation with one empirical example.",
        "Evaluate deadweight loss in monopolistic competition.",
        "Compare progressive and regressive consumption taxes.",
        "Discuss fiscal federalism in emerging economies.",
        "Analyze public debt sustainability ratios.",
      ],
    });
    expect(step2.status).toBe(200);

    const step3ProdBlocked = await patch({ step: 3, simulateVerdict: "feasible" });
    expect(step3ProdBlocked.status).toBe(403);

    const step3 = await handleSaveWizardStep(
      new Request(`https://collate.app/api/projects/${projectId}/wizard`, {
        method: "PATCH",
        headers: { "content-type": "application/json", origin: "https://collate.app", cookie },
        body: JSON.stringify({ step: 3, simulateVerdict: "feasible" }),
      }),
      projectId,
      { ...deps, appEnv: "dev" }
    );
    expect(step3.status).toBe(200);
    const s3Json = (await step3.json()) as { wizard: SerializedWizardState };
    expect(s3Json.wizard.questions).toHaveLength(5);
    expect(s3Json.wizard.feasibilityReports).toHaveLength(5);
    expect(s3Json.wizard.project.idealPages).toBe(20);
  });
});
