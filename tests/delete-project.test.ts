import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { createProjectForUser } from "@/db/queries/projects";
import { auditLog, chapters, chapterVersions, exportsTable, projects } from "@/db/schema";
import { handleDeleteProject } from "@/lib/account/delete-project";
import {
  handleSignIn,
  handleSignUp,
  handleVerifyCode,
  type HttpAuthDeps,
} from "@/lib/auth/http-handlers";
import type { EmailMessage, EmailSender } from "@/lib/email/mailer";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

const APP = "https://collateresearch.app";

describe("DELETE /api/projects/:id", () => {
  let d1: InMemoryD1Context;
  let db: AppDb;
  let sent: EmailMessage[];
  let deleted: string[];
  let deps: HttpAuthDeps & { bucket: { delete(keys: string | string[]): Promise<void> } };

  beforeEach(() => {
    d1 = createInMemoryD1();
    d1.applyMigrations();
    db = createDb(d1.d1);
    sent = [];
    deleted = [];
    const mailer: EmailSender = {
      async send(m) {
        sent.push(m);
        return { ok: true, provider: "console" };
      },
    };
    deps = {
      db,
      mailer,
      appUrl: APP,
      appEnv: "prod",
      turnstileSecretKey: "t",
      fetchFn: async () => Response.json({ success: true }),
      bucket: {
        async delete(keys) {
          deleted.push(...(Array.isArray(keys) ? keys : [keys]));
        },
      },
    };
  });
  afterEach(() => d1.close());

  const post = (path: string, body: unknown, cookie = "") =>
    new Request(`${APP}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP, cookie },
      body: JSON.stringify(body),
    });
  const del = (id: string, cookie: string, origin = APP) =>
    new Request(`${APP}/api/projects/${id}`, { method: "DELETE", headers: { origin, cookie } });

  async function account(email: string): Promise<{ cookie: string; userId: string }> {
    const password = "quiet library oak shelf";
    await handleSignUp(
      post("/api/auth/signup", {
        name: "Tester",
        email,
        password,
        turnstileToken: "x",
        acceptTerms: true,
      }),
      deps
    );
    const code = sent[sent.length - 1]!.text.match(/\b(\d{6})\b/)![1]!;
    await handleVerifyCode(post("/api/auth/verify-code", { email, code }), deps);
    const res = await handleSignIn(
      post("/api/auth/signin", { email, password, turnstileToken: "x" }),
      deps
    );
    const body = (await res.json()) as { user: { id: string } };
    return { cookie: (res.headers.get("set-cookie") ?? "").split(";")[0]!, userId: body.user.id };
  }

  async function projectWithFiles(userId: string, id: string) {
    const now = new Date();
    await createProjectForUser(db, {
      id,
      userId,
      type: "project",
      title: "Kola nut caffeine",
      now,
    });
    await db.insert(chapters).values({
      id: `${id}_ch1`,
      projectId: id,
      number: 1,
      title: "Introduction",
      chapterType: "introduction",
      status: "ready",
      createdAt: now,
      updatedAt: now,
    } as typeof chapters.$inferInsert);
    await db.insert(chapterVersions).values({
      id: `${id}_v1`,
      chapterId: `${id}_ch1`,
      version: 1,
      contentR2Key: `chapters/${id}/v1.md`,
      createdAt: now,
    } as typeof chapterVersions.$inferInsert);
    await db.insert(exportsTable).values({
      id: `${id}_exp`,
      projectId: id,
      chapterId: `${id}_ch1`,
      scope: "chapter",
      format: "pdf",
      r2Key: `exports/${id}/a.pdf`,
      pageCount: 3,
      sizeBytes: 10,
      sha256: "x",
      createdAt: now,
    } as typeof exportsTable.$inferInsert);
  }

  it("deletes the owner's project, its rows and stored files", async () => {
    const ada = await account("ada@uni.edu.ng");
    await projectWithFiles(ada.userId, "prj_a");
    const res = await handleDeleteProject(del("prj_a", ada.cookie), "prj_a", deps);
    expect(res.status).toBe(200);
    expect(await db.select().from(projects).where(eq(projects.id, "prj_a"))).toEqual([]);
    expect(await db.select().from(chapters).where(eq(chapters.projectId, "prj_a"))).toEqual([]);
    expect(deleted.sort()).toEqual(["chapters/prj_a/v1.md", "exports/prj_a/a.pdf"]);
    const [logged] = await db.select().from(auditLog).where(eq(auditLog.action, "project.deleted"));
    expect(logged?.entityId).toBe("prj_a");
  });

  it("never deletes another user's project, and answers as if it does not exist", async () => {
    const ada = await account("ada@uni.edu.ng");
    const bayo = await account("bayo@uni.edu.ng");
    await projectWithFiles(ada.userId, "prj_a");
    const res = await handleDeleteProject(del("prj_a", bayo.cookie), "prj_a", deps);
    expect(res.status).toBe(404);
    expect(await db.select().from(projects).where(eq(projects.id, "prj_a"))).toHaveLength(1);
    expect(deleted).toEqual([]);
  });

  it("refuses while a chapter is being written", async () => {
    const ada = await account("ada@uni.edu.ng");
    await projectWithFiles(ada.userId, "prj_a");
    await db.update(chapters).set({ status: "writing" }).where(eq(chapters.id, "prj_a_ch1"));
    expect((await handleDeleteProject(del("prj_a", ada.cookie), "prj_a", deps)).status).toBe(409);
  });

  it("refuses signed-out and cross-site requests", async () => {
    const ada = await account("ada@uni.edu.ng");
    await projectWithFiles(ada.userId, "prj_a");
    expect((await handleDeleteProject(del("prj_a", ""), "prj_a", deps)).status).toBe(401);
    expect(
      (await handleDeleteProject(del("prj_a", ada.cookie, "https://evil.example"), "prj_a", deps))
        .status
    ).toBe(403);
    expect(await db.select().from(projects)).toHaveLength(1);
  });
});
