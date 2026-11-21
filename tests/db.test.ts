import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type AppDb } from "@/db/client";
import { listJobLogsByWorkflow, recordJobLog } from "@/db/queries/jobs-log";
import {
  createProjectForUser,
  getProjectForUser,
  listProjectsForUser,
} from "@/db/queries/projects";
import { projects, sessions, users } from "@/db/schema";
import { createInMemoryD1, type InMemoryD1Context } from "./helpers/in-memory-d1";

describe("D1 + Drizzle database layer", () => {
  let ctx: InMemoryD1Context;
  let db: AppDb;
  const fixedNow = new Date("2026-11-21T12:00:00.000Z");

  beforeEach(() => {
    ctx = createInMemoryD1();
    ctx.applyMigrations();
    db = createDb(ctx.d1);
  });

  afterEach(() => {
    ctx.close();
  });

  async function insertUser(id: string, email: string, name = "Test User") {
    await db.insert(users).values({
      id,
      email,
      emailVerified: true,
      name,
      creditsBalance: 10,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    });
  }

  it("enforces user ownership isolation across projects (prevents horizontal access)", async () => {
    await insertUser("usr_a", "alice@example.com", "Alice");
    await insertUser("usr_b", "bob@example.com", "Bob");

    const aliceProject = await createProjectForUser(db, {
      id: "prj_alice_1",
      userId: "usr_a",
      type: "thesis",
      title: "Alice Thesis Topic",
      targetPages: 60,
      now: fixedNow,
    });

    await createProjectForUser(db, {
      id: "prj_bob_1",
      userId: "usr_b",
      type: "assignment",
      title: "Bob Assignment",
      now: fixedNow,
    });

    const aliceList = await listProjectsForUser(db, "usr_a");
    expect(aliceList.map((p) => p.id)).toEqual([aliceProject.id]);

    const unauthorizedLookup = await getProjectForUser(db, "usr_b", aliceProject.id);
    expect(unauthorizedLookup).toBeNull();

    const authorizedLookup = await getProjectForUser(db, "usr_a", aliceProject.id);
    expect(authorizedLookup?.title).toBe("Alice Thesis Topic");
  });

  it("rejects duplicate emails via UNIQUE constraint", async () => {
    await insertUser("usr_1", "dup@example.com");
    await expect(insertUser("usr_2", "dup@example.com")).rejects.toThrow();
  });

  it("rejects invalid domain values via CHECK constraints", async () => {
    await expect(
      db.insert(users).values({
        id: "usr_neg",
        email: "neg@example.com",
        emailVerified: false,
        name: "Negative Credits",
        creditsBalance: -5,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      })
    ).rejects.toThrow();

    await insertUser("usr_ok", "ok@example.com");
    await expect(
      db.insert(projects).values({
        id: "prj_bad_pages",
        userId: "usr_ok",
        type: "research",
        title: "Zero Page Study",
        status: "draft",
        targetPages: 0,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      })
    ).rejects.toThrow();
  });

  it("rejects orphan projects via FOREIGN KEY constraint", async () => {
    await expect(
      createProjectForUser(db, {
        id: "prj_orphan",
        userId: "usr_does_not_exist",
        type: "project",
        title: "Orphan Project",
        now: fixedNow,
      })
    ).rejects.toThrow();
  });

  it("cascades user deletion to sessions/projects while preserving jobs_log cost audit", async () => {
    await insertUser("usr_del", "delete-me@example.com");

    await db.insert(sessions).values({
      id: "ses_1",
      userId: "usr_del",
      token: "tok_secret_123",
      expiresAt: new Date("2026-12-21T12:00:00.000Z"),
      createdAt: fixedNow,
      updatedAt: fixedNow,
    });

    await createProjectForUser(db, {
      id: "prj_del",
      userId: "usr_del",
      type: "research",
      title: "Temporary Project",
      now: fixedNow,
    });

    await recordJobLog(db, {
      id: "job_cost_1",
      workflowId: "wf_1",
      projectId: "prj_del",
      step: "query_plan",
      model: "claude-sonnet-test",
      status: "succeeded",
      tokensIn: 1200,
      tokensOut: 400,
      costEstimateUsd: 0.0096,
      latencyMs: 850,
      now: fixedNow,
    });

    await db.delete(users).where(eq(users.id, "usr_del"));

    expect(await db.select().from(sessions)).toHaveLength(0);
    expect(await db.select().from(projects)).toHaveLength(0);

    const logs = await listJobLogsByWorkflow(db, "wf_1");
    expect(logs).toHaveLength(1);
    expect(logs[0]?.projectId).toBeNull();
    expect(logs[0]?.costEstimateUsd).toBeCloseTo(0.0096, 6);
  });

  it("applies scripts/seed.sql idempotently without duplicating rows", async () => {
    const seedPath = path.resolve(process.cwd(), "scripts/seed.sql");
    ctx.execSqlFile(seedPath);
    ctx.execSqlFile(seedPath);

    const seededUsers = await db.select().from(users);
    const seededProjects = await db.select().from(projects);
    expect(seededUsers).toHaveLength(1);
    expect(seededUsers[0]?.email).toBe("dev@collate.local");
    expect(seededProjects).toHaveLength(1);
  });

  it("rejects empty userId or blank title at application validation boundary", async () => {
    await expect(listProjectsForUser(db, "   ")).rejects.toThrow("userId is required");
    await insertUser("usr_val", "val@example.com");
    await expect(
      createProjectForUser(db, {
        id: "prj_blank",
        userId: "usr_val",
        type: "project",
        title: "   ",
      })
    ).rejects.toThrow();
  });
});
