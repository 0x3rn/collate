import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { createProjectForUser } from "@/db/queries/projects";
import { chapters, chapterVersions, exportsTable, projects } from "@/db/schema";
import { handleDeleteProject } from "@/lib/account/delete-project";
import {
  handleGetProjectById,
  handleSignIn,
  handleSignUp,
  handleVerifyCode,
  type HttpAuthDeps,
} from "@/lib/auth/http-handlers";
import type { EmailMessage, EmailSender } from "@/lib/email/mailer";
import { handleCreateExport, handleDownloadExport } from "@/lib/export/http-handlers";
import { handleGetProjectIntegrity } from "@/lib/originality/http-handlers";
import {
  handleGetOutline,
  handleSaveOutline,
  handleUnlockOutline,
} from "@/lib/outline/http-handlers";
import { handleListProjectFigures, handleSearchProjectFigures } from "@/lib/research/figures-http";
import { handleGetResearchStatus, handleStartResearchSweep } from "@/lib/research/http-handlers";
import {
  handleGetWizardState,
  handleSaveWizardStep,
  handleUpdateProjectSettings,
} from "@/lib/wizard/http-handlers";
import {
  handleGetChapterReader,
  handleSaveChapterLightEdit,
} from "@/lib/writing/chapter-reader-handlers";
import {
  handleApproveChapter,
  handleRequestChapterChanges,
  handleSaveChapterInstructions,
  handleStartAssignment,
  handleStartChapter,
  handleUploadProjectDataset,
} from "@/lib/writing/http-handlers";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

/**
 * One sweep over every project API: a second signed-in user who knows (or guesses) the first
 * user's project, chapter and export ids must get nothing back and change nothing.
 */

const APP = "https://collateresearch.app";
const SECRET_TITLE = "Victim private thesis title";

describe("cross-user access sweep", () => {
  let d1: InMemoryD1Context;
  let db: AppDb;
  let sent: EmailMessage[];
  let launched: number;
  let deps: HttpAuthDeps & Record<string, unknown>;

  beforeEach(() => {
    d1 = createInMemoryD1();
    d1.applyMigrations();
    db = createDb(d1.d1);
    sent = [];
    launched = 0;
    const mailer: EmailSender = {
      async send(m) {
        sent.push(m);
        return { ok: true, provider: "console" };
      },
    };
    const bucket = {
      async get() {
        return {
          text: async () => "secret chapter text",
          arrayBuffer: async () => new ArrayBuffer(8),
        };
      },
      async put() {
        return null;
      },
      async delete() {},
      async head() {
        return null;
      },
    };
    deps = {
      db,
      mailer,
      appUrl: APP,
      appEnv: "prod",
      turnstileSecretKey: "t",
      fetchFn: async () => Response.json({ success: true }),
      bucket,
      browser: {},
      workflowLauncher: {
        async create() {
          launched++;
          return {};
        },
      },
      signingSecret: "export-secret-for-tests-0123456789",
    };
  });
  afterEach(() => d1.close());

  const req = (method: string, path: string, cookie: string, body?: unknown) =>
    new Request(`${APP}${path}`, {
      method,
      headers: { "content-type": "application/json", origin: APP, cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  async function account(email: string): Promise<{ cookie: string; userId: string }> {
    const password = "quiet library oak shelf";
    await handleSignUp(
      req("POST", "/api/auth/signup", "", {
        name: "Tester",
        email,
        password,
        turnstileToken: "x",
        acceptTerms: true,
      }),
      deps
    );
    const code = sent[sent.length - 1]!.text.match(/\b(\d{6})\b/)![1]!;
    await handleVerifyCode(req("POST", "/api/auth/verify-code", "", { email, code }), deps);
    const res = await handleSignIn(
      req("POST", "/api/auth/signin", "", { email, password, turnstileToken: "x" }),
      deps
    );
    const body = (await res.json()) as { user: { id: string } };
    return { cookie: (res.headers.get("set-cookie") ?? "").split(";")[0]!, userId: body.user.id };
  }

  it("gives another user nothing from someone else's project", async () => {
    const victim = await account("victim@uni.edu.ng");
    const attacker = await account("attacker@uni.edu.ng");
    const now = new Date();
    const P = "prj_victim";
    const C = "chp_victim";
    const E = "exp_victim";
    await createProjectForUser(db, {
      id: P,
      userId: victim.userId,
      type: "project",
      title: SECRET_TITLE,
      now,
    });
    await db.insert(chapters).values({
      id: C,
      projectId: P,
      number: 1,
      title: "Introduction",
      chapterType: "introduction",
      status: "ready",
      createdAt: now,
      updatedAt: now,
    } as typeof chapters.$inferInsert);
    await db.insert(chapterVersions).values({
      id: "ver_victim",
      chapterId: C,
      version: 1,
      contentR2Key: `chapters/${P}/v1.md`,
      createdAt: now,
    } as typeof chapterVersions.$inferInsert);
    await db.insert(exportsTable).values({
      id: E,
      projectId: P,
      chapterId: C,
      scope: "chapter",
      format: "pdf",
      r2Key: `exports/${P}/a.pdf`,
      pageCount: 3,
      sizeBytes: 10,
      sha256: "x",
      createdAt: now,
    } as typeof exportsTable.$inferInsert);
    const [before] = await db.select().from(projects).where(eq(projects.id, P));
    const [chapterBefore] = await db.select().from(chapters).where(eq(chapters.id, C));

    const c = attacker.cookie;
    const d = deps as never;
    const dataset = new FormData();
    dataset.set("file", new File(["a,b\n1,2"], "data.csv", { type: "text/csv" }));
    const calls: Array<[string, () => Promise<Response>]> = [
      ["GET project", () => handleGetProjectById(req("GET", `/api/projects/${P}`, c), P, d)],
      ["DELETE project", () => handleDeleteProject(req("DELETE", `/api/projects/${P}`, c), P, d)],
      ["GET wizard", () => handleGetWizardState(req("GET", `/api/projects/${P}/wizard`, c), P, d)],
      [
        "PATCH wizard",
        () =>
          handleSaveWizardStep(
            req("PATCH", `/api/projects/${P}/wizard`, c, { step: 1, data: { title: "pwned" } }),
            P,
            d
          ),
      ],
      [
        "PATCH settings",
        () =>
          handleUpdateProjectSettings(
            req("PATCH", `/api/projects/${P}/settings`, c, { pageSize: "letter" }),
            P,
            d
          ),
      ],
      ["GET outline", () => handleGetOutline(req("GET", `/api/projects/${P}/outline`, c), P, d)],
      [
        "PUT outline",
        () =>
          handleSaveOutline(req("PUT", `/api/projects/${P}/outline`, c, { chapters: [] }), P, d),
      ],
      [
        "POST outline unlock",
        () => handleUnlockOutline(req("POST", `/api/projects/${P}/outline/unlock`, c, {}), P, d),
      ],
      [
        "GET research",
        () => handleGetResearchStatus(req("GET", `/api/projects/${P}/research`, c), P, d),
      ],
      [
        "POST research",
        () => handleStartResearchSweep(req("POST", `/api/projects/${P}/research`, c, {}), P, d),
      ],
      [
        "GET figures",
        () => handleListProjectFigures(req("GET", `/api/projects/${P}/figures/search`, c), P, d),
      ],
      [
        "POST figures",
        () =>
          handleSearchProjectFigures(
            req("POST", `/api/projects/${P}/figures/search`, c, { query: "maize" }),
            P,
            d
          ),
      ],
      [
        "GET integrity",
        () => handleGetProjectIntegrity(req("GET", `/api/projects/${P}/integrity`, c), P, d),
      ],
      [
        "POST assignment",
        () =>
          handleStartAssignment(req("POST", `/api/projects/${P}/assignment/start`, c, {}), P, d),
      ],
      [
        "POST dataset",
        () =>
          handleUploadProjectDataset(
            new Request(`${APP}/api/projects/${P}/datasets`, {
              method: "POST",
              headers: { origin: APP, cookie: c },
              body: dataset,
            }),
            P,
            d
          ),
      ],
      [
        "GET chapter",
        () => handleGetChapterReader(req("GET", `/api/projects/${P}/chapters/${C}`, c), P, C, d),
      ],
      [
        "PUT chapter",
        () =>
          handleSaveChapterLightEdit(
            req("PUT", `/api/projects/${P}/chapters/${C}`, c, { markdown: "pwned" }),
            P,
            C,
            d
          ),
      ],
      [
        "POST chapter start",
        () =>
          handleStartChapter(req("POST", `/api/projects/${P}/chapters/${C}/start`, c, {}), P, C, d),
      ],
      [
        "POST chapter approve",
        () =>
          handleApproveChapter(
            req("POST", `/api/projects/${P}/chapters/${C}/approve`, c, {}),
            P,
            C,
            d
          ),
      ],
      [
        "POST chapter revise",
        () =>
          handleRequestChapterChanges(
            req("POST", `/api/projects/${P}/chapters/${C}/revise`, c, { feedback: "pwned please" }),
            P,
            C,
            d
          ),
      ],
      [
        "PUT chapter instructions",
        () =>
          handleSaveChapterInstructions(
            req("PUT", `/api/projects/${P}/chapters/${C}/instructions`, c, {
              instructions: "pwned",
            }),
            P,
            C,
            d
          ),
      ],
      [
        "POST export",
        () =>
          handleCreateExport(
            req("POST", `/api/projects/${P}/exports`, c, {
              scope: "chapter",
              chapterId: C,
              format: "pdf",
            }),
            P,
            d
          ),
      ],
      [
        "GET export download",
        () =>
          handleDownloadExport(req("GET", `/api/projects/${P}/exports/${E}/download`, c), P, E, d),
      ],
    ];

    const leaks: string[] = [];
    for (const [name, call] of calls) {
      const res = await call();
      const text = await res.text();
      if (res.status < 400 || text.includes(SECRET_TITLE) || text.includes("secret chapter text")) {
        leaks.push(`${name} -> ${res.status} ${text.slice(0, 120)}`);
      }
    }
    expect(leaks).toEqual([]);
    expect(launched).toBe(0);
    const [after] = await db.select().from(projects).where(eq(projects.id, P));
    expect(after).toEqual(before);
    const [chapterAfter] = await db.select().from(chapters).where(eq(chapters.id, C));
    expect(chapterAfter).toEqual(chapterBefore);
    expect(await db.select().from(exportsTable).where(eq(exportsTable.projectId, P))).toHaveLength(
      1
    );
  });
});
