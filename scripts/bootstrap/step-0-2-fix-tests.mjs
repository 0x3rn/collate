import { createStepRunner } from "./_runner.mjs";

const step = createStepRunner("Phase 0 / Step 0.2 (Add & Verify Database Test Suite)");

async function main() {
  step.logStep("1. Writing in-memory D1 test harness (node:sqlite) and database integration tests");

  step.writeFileEnsureDir(
    "tests/helpers/in-memory-d1.ts",
    `import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

interface D1MetaShape {
  duration: number;
  size_after: number;
  rows_read: number;
  rows_written: number;
  last_row_id: number;
  changed_db: boolean;
  changes: number;
}

function emptyMeta(changes = 0, lastRowId = 0): D1MetaShape {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: changes,
    last_row_id: lastRowId,
    changed_db: changes > 0,
    changes,
  };
}

function toSqlInput(value: unknown): SQLInputValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string") {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return value as NodeJS.ArrayBufferView;
  }
  throw new Error(\`Unsupported SQLite bind parameter type: \${typeof value}\`);
}

interface BoundStatement {
  bind(...values: unknown[]): BoundStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true; meta: D1MetaShape }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true; meta: D1MetaShape }>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>;
}

export interface InMemoryD1Context {
  d1: D1Database;
  sqlite: DatabaseSync;
  applyMigrations(migrationsDir?: string): void;
  execSqlFile(filePath: string): void;
  close(): void;
}

/**
 * Lightweight, zero-native-build D1Database adapter backed by Node's built-in node:sqlite.
 * Enforces PRAGMA foreign_keys = ON so tests exercise real SQLite constraints and migrations.
 */
export function createInMemoryD1(): InMemoryD1Context {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  function createStatement(sqlText: string, boundParams: SQLInputValue[] = []): BoundStatement {
    return {
      bind(...values: unknown[]): BoundStatement {
        return createStatement(sqlText, values.map(toSqlInput));
      },

      async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
        const stmt = sqlite.prepare(sqlText);
        const row = stmt.get(...boundParams) as Record<string, unknown> | undefined;
        if (!row) return null;
        if (colName !== undefined) {
          return (row[colName] ?? null) as T | null;
        }
        return row as T;
      },

      async run<T = Record<string, unknown>>(): Promise<{
        results: T[];
        success: true;
        meta: D1MetaShape;
      }> {
        const stmt = sqlite.prepare(sqlText);
        const info = stmt.run(...boundParams);
        return {
          results: [],
          success: true,
          meta: emptyMeta(Number(info.changes), Number(info.lastInsertRowid)),
        };
      },

      async all<T = Record<string, unknown>>(): Promise<{
        results: T[];
        success: true;
        meta: D1MetaShape;
      }> {
        const stmt = sqlite.prepare(sqlText);
        const rows = stmt.all(...boundParams) as unknown as T[];
        return {
          results: rows,
          success: true,
          meta: { ...emptyMeta(), rows_read: rows.length },
        };
      },

      async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
        const stmt = sqlite.prepare(sqlText);
        stmt.setReturnArrays(true);
        const rows = stmt.all(...boundParams) as unknown as unknown[][];
        if (options?.columnNames) {
          const cols = stmt.columns().map((c) => c.name);
          return [cols, ...rows] as unknown as T[];
        }
        return rows as unknown as T[];
      },
    };
  }

  const d1Like = {
    prepare(query: string): BoundStatement {
      return createStatement(query);
    },
    async batch<T = unknown>(statements: BoundStatement[]): Promise<T[]> {
      sqlite.exec("BEGIN");
      try {
        const results: T[] = [];
        for (const stmt of statements) {
          results.push((await stmt.all()) as unknown as T);
        }
        sqlite.exec("COMMIT");
        return results;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
    async exec(query: string): Promise<{ count: number; duration: number }> {
      sqlite.exec(query);
      return { count: 1, duration: 0 };
    },
    async dump(): Promise<ArrayBuffer> {
      return new ArrayBuffer(0);
    },
  };

  function applyMigrations(migrationsDir = path.resolve(process.cwd(), "drizzle")): void {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      throw new Error(\`No .sql migration files found in \${migrationsDir}\`);
    }

    for (const file of files) {
      const content = fs.readFileSync(path.join(migrationsDir, file), "utf8");
      const statements = content
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);

      for (const stmt of statements) {
        sqlite.exec(stmt);
      }
    }
  }

  function execSqlFile(filePath: string): void {
    const content = fs.readFileSync(filePath, "utf8");
    sqlite.exec(content);
  }

  return {
    d1: d1Like as unknown as D1Database,
    sqlite,
    applyMigrations,
    execSqlFile,
    close(): void {
      sqlite.close();
    },
  };
}
`
  );

  step.writeFileEnsureDir(
    "tests/db.test.ts",
    `import path from "node:path";
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
`
  );

  step.logStep("2. Formatting and running full verification gate for Step 0.2");
  await step.run("pnpm", ["run", "format"]);
  await step.run("pnpm", ["run", "verify"]);

  await step.gitCommit("Add database tests verifying constraints, migrations, and user isolation");

  step.log("");
  step.log("========================================");
  step.log("✓ Step 0.2 database tests PASSED and committed!");
  step.log("========================================");
}

step.execute(main);
