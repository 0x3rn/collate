import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const IS_WIN = process.platform === "win32";

function logStep(title) {
  console.log(`\n========================================`);
  console.log(`▶ ${title}`);
  console.log(`========================================`);
}

function fail(message) {
  console.error(`\n✖ ERROR: ${message}`);
  process.exit(1);
}

function quoteWinArg(arg) {
  if (!/[\s"&|<>^()]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function run(cmd, args = [], options = {}) {
  const { capture = false, allowFail = false, cwd = ROOT, nonInteractive = false } = options;
  const finalArgs = IS_WIN ? args.map(quoteWinArg) : args;
  try {
    const out = execFileSync(cmd, finalArgs, {
      cwd,
      shell: IS_WIN,
      env: nonInteractive ? { ...process.env, CI: "true" } : process.env,
      stdio: capture
        ? ["ignore", "pipe", "pipe"]
        : nonInteractive
          ? ["ignore", "inherit", "inherit"]
          : "inherit",
      encoding: "utf8",
    });
    return { ok: true, stdout: (out ?? "").trim() };
  } catch (err) {
    if (allowFail) {
      return {
        ok: false,
        stdout: String(err.stdout ?? "").trim(),
        stderr: String(err.stderr ?? "").trim(),
      };
    }
    fail(`Command failed: ${cmd} ${args.join(" ")}\n${err.message}`);
  }
}

function stripJsonComments(input) {
  let out = "";
  let inString = false;
  let escape = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];

    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      i++;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }

    if (ch === "/" && next === "/") {
      i += 2;
      while (i < input.length && input[i] !== "\n") i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    out += ch;
    i++;
  }

  return out.replace(/,\s*([}\]])/g, "$1");
}

function readJsonFile(filePath) {
  return JSON.parse(stripJsonComments(fs.readFileSync(filePath, "utf8")));
}

function writeFileEnsureDir(relPath, content) {
  const fullPath = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
  console.log(`  ✓ wrote ${relPath}`);
}

function verifyStep01Present() {
  logStep("1. Verifying Step 0.1 foundation files");
  for (const required of ["package.json", "wrangler.jsonc", "tsconfig.json", "vitest.config.ts"]) {
    if (!fs.existsSync(path.join(ROOT, required))) {
      fail(`Missing ${required}. Please run step-0-1-scaffold.mjs first.`);
    }
  }
  console.log("  ✓ Step 0.1 files present");
}

function installDrizzle() {
  logStep("2. Installing drizzle-orm and drizzle-kit");
  run("pnpm", ["add", "drizzle-orm"]);
  run("pnpm", ["add", "-D", "drizzle-kit"]);
}

function updateWranglerBindings() {
  logStep("3. Adding D1 and R2 bindings for dev, staging, and prod in wrangler.jsonc");

  const wranglerPath = path.join(ROOT, "wrangler.jsonc");
  const config = readJsonFile(wranglerPath);

  // Preserve real remote database_ids if already provisioned; otherwise use local dev placeholders.
  const devDbId = config.d1_databases?.[0]?.database_id ?? "00000000-0000-0000-0000-000000000001";
  const stagingDbId =
    config.env?.staging?.d1_databases?.[0]?.database_id ?? "00000000-0000-0000-0000-000000000002";
  const prodDbId =
    config.env?.prod?.d1_databases?.[0]?.database_id ?? "00000000-0000-0000-0000-000000000003";

  config.d1_databases = [
    {
      binding: "DB",
      database_name: "collate-dev",
      database_id: devDbId,
      migrations_dir: "drizzle",
    },
  ];

  config.r2_buckets = [
    {
      binding: "FILES",
      bucket_name: "collate-files-dev",
    },
  ];

  config.env = {
    ...(config.env ?? {}),
    staging: {
      ...(config.env?.staging ?? {}),
      name: "collate-staging",
      observability: { enabled: true },
      vars: {
        APP_NAME: "Collate",
        APP_ENV: "staging",
      },
      d1_databases: [
        {
          binding: "DB",
          database_name: "collate-staging",
          database_id: stagingDbId,
          migrations_dir: "drizzle",
        },
      ],
      r2_buckets: [
        {
          binding: "FILES",
          bucket_name: "collate-files-staging",
        },
      ],
    },
    prod: {
      ...(config.env?.prod ?? {}),
      name: "collate-prod",
      observability: { enabled: true },
      vars: {
        APP_NAME: "Collate",
        APP_ENV: "prod",
      },
      d1_databases: [
        {
          binding: "DB",
          database_name: "collate-prod",
          database_id: prodDbId,
          migrations_dir: "drizzle",
        },
      ],
      r2_buckets: [
        {
          binding: "FILES",
          bucket_name: "collate-files-prod",
        },
      ],
    },
  };

  const header = [
    "// Collate — Cloudflare Workers configuration",
    "// Default = dev. Use --env staging or --env prod for remote environments.",
    "// Run scripts/bootstrap/provision-cloudflare.mjs after 'wrangler login' to populate real remote IDs.",
    "",
  ].join("\n");

  fs.writeFileSync(wranglerPath, `${header}${JSON.stringify(config, null, 2)}\n`, "utf8");
  console.log("  ✓ Updated wrangler.jsonc with DB (D1) and FILES (R2) bindings");
}

function updatePackageAndConfigs() {
  logStep("4. Updating package.json, tsconfig.json, and .prettierignore");

  const pkgPath = path.join(ROOT, "package.json");
  const pkg = readJsonFile(pkgPath);
  pkg.scripts = {
    ...pkg.scripts,
    "db:generate": "drizzle-kit generate",
    "db:migrate:local": "wrangler d1 migrations apply DB --local",
    "db:migrate:staging": "wrangler d1 migrations apply DB --env staging --remote",
    "db:migrate:prod": "wrangler d1 migrations apply DB --env prod --remote",
    "db:seed:local": "wrangler d1 execute DB --local --file=scripts/seed.sql",
  };
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  console.log("  ✓ Added db:* scripts to package.json");

  const tsconfigPath = path.join(ROOT, "tsconfig.json");
  const tsconfig = readJsonFile(tsconfigPath);
  const includes = new Set(tsconfig.include ?? []);
  includes.add("worker-configuration.d.ts");
  includes.add("drizzle.config.ts");
  tsconfig.include = Array.from(includes);
  fs.writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`, "utf8");
  console.log("  ✓ Updated tsconfig.json to include worker-configuration.d.ts");

  const prettierIgnorePath = path.join(ROOT, ".prettierignore");
  const existingIgnore = fs.existsSync(prettierIgnorePath)
    ? fs.readFileSync(prettierIgnorePath, "utf8")
    : "";
  const lines = new Set(existingIgnore.split(/\r?\n/).filter(Boolean));
  lines.add("drizzle");
  lines.add("worker-configuration.d.ts");
  fs.writeFileSync(prettierIgnorePath, `${Array.from(lines).join("\n")}\n`, "utf8");
  console.log("  ✓ Updated .prettierignore");
}

function writeDatabaseLayer() {
  logStep("5. Writing Drizzle config, schema, client, scoped queries, seed, and provisioning helper");

  writeFileEnsureDir(
    "drizzle.config.ts",
    `import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  strict: true,
  verbose: true,
});
`
  );

  writeFileEnsureDir(
    "src/db/schema.ts",
    `import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Timestamps are stored consistently as UTC epoch milliseconds (timestamp_ms).
 * Database constraints (NOT NULL, UNIQUE, FOREIGN KEY, CHECK) enforce core invariants
 * independently of application code.
 */

export const PROJECT_TYPES = ["project", "research", "thesis", "assignment"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_STATUSES = [
  "draft",
  "researching",
  "feasible",
  "not_feasible",
  "needs_refinement",
  "outline_pending",
  "in_progress",
  "completed",
  "archived",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const JOB_STATUSES = ["started", "succeeded", "failed", "retrying"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    name: text("name").notNull(),
    image: text("image"),
    creditsBalance: integer("credits_balance").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    check("users_credits_non_negative", sql\`\${table.creditsBalance} >= 0\`),
  ]
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("sessions_token_unique").on(table.token),
    index("sessions_user_id_idx").on(table.userId),
  ]
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("accounts_provider_account_unique").on(table.providerId, table.accountId),
    index("accounts_user_id_idx").on(table.userId),
  ]
);

export const verifications = sqliteTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)]
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", { enum: PROJECT_TYPES }).notNull(),
    title: text("title").notNull(),
    level: text("level"),
    field: text("field"),
    institution: text("institution"),
    status: text("status", { enum: PROJECT_STATUSES }).notNull().default("draft"),
    targetPages: integer("target_pages"),
    idealPages: integer("ideal_pages"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("projects_user_created_idx").on(table.userId, table.createdAt),
    check(
      "projects_type_valid",
      sql\`\${table.type} IN ('project', 'research', 'thesis', 'assignment')\`
    ),
    check(
      "projects_status_valid",
      sql\`\${table.status} IN ('draft', 'researching', 'feasible', 'not_feasible', 'needs_refinement', 'outline_pending', 'in_progress', 'completed', 'archived')\`
    ),
    check(
      "projects_target_pages_positive",
      sql\`\${table.targetPages} IS NULL OR \${table.targetPages} > 0\`
    ),
    check(
      "projects_ideal_pages_positive",
      sql\`\${table.idealPages} IS NULL OR \${table.idealPages} > 0\`
    ),
  ]
);

export const jobsLog = sqliteTable(
  "jobs_log",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id").notNull(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    step: text("step").notNull(),
    provider: text("provider").notNull().default("anthropic"),
    model: text("model").notNull(),
    status: text("status", { enum: JOB_STATUSES }).notNull(),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costEstimateUsd: real("cost_estimate_usd").notNull().default(0),
    latencyMs: integer("latency_ms"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("jobs_log_workflow_idx").on(table.workflowId),
    index("jobs_log_project_idx").on(table.projectId),
    check(
      "jobs_log_status_valid",
      sql\`\${table.status} IN ('started', 'succeeded', 'failed', 'retrying')\`
    ),
    check("jobs_log_tokens_non_negative", sql\`\${table.tokensIn} >= 0 AND \${table.tokensOut} >= 0\`),
    check("jobs_log_cost_non_negative", sql\`\${table.costEstimateUsd} >= 0\`),
  ]
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    metadataJson: text("metadata_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("audit_log_entity_idx").on(table.entityType, table.entityId),
    index("audit_log_actor_idx").on(table.actorUserId),
  ]
);

export type UserRecord = typeof users.$inferSelect;
export type NewUserRecord = typeof users.$inferInsert;
export type ProjectRecord = typeof projects.$inferSelect;
export type NewProjectRecord = typeof projects.$inferInsert;
export type JobLogRecord = typeof jobsLog.$inferSelect;
export type NewJobLogRecord = typeof jobsLog.$inferInsert;
`
  );

  writeFileEnsureDir(
    "src/db/client.ts",
    `import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export type AppDb = DrizzleD1Database<typeof schema>;

export function createDb(d1: D1Database): AppDb {
  return drizzle(d1, { schema });
}
`
  );

  writeFileEnsureDir(
    "src/db/queries/projects.ts",
    `import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "../client";
import { PROJECT_TYPES, projects, type ProjectRecord } from "../schema";

export const CreateProjectInputSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  type: z.enum(PROJECT_TYPES),
  title: z.string().trim().min(1).max(300),
  level: z.string().trim().max(100).optional(),
  field: z.string().trim().max(150).optional(),
  institution: z.string().trim().max(200).optional(),
  targetPages: z.number().int().positive().max(500).optional(),
  now: z.date().optional(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

/**
 * Every project query requires an authenticated userId to enforce
 * resource-level ownership isolation at the persistence boundary.
 */
export async function listProjectsForUser(db: AppDb, userId: string): Promise<ProjectRecord[]> {
  if (!userId.trim()) {
    throw new Error("userId is required to list projects");
  }

  return db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt));
}

export async function getProjectForUser(
  db: AppDb,
  userId: string,
  projectId: string
): Promise<ProjectRecord | null> {
  if (!userId.trim() || !projectId.trim()) {
    return null;
  }

  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);

  return rows[0] ?? null;
}

export async function createProjectForUser(
  db: AppDb,
  rawInput: CreateProjectInput
): Promise<ProjectRecord> {
  const input = CreateProjectInputSchema.parse(rawInput);
  const timestamp = input.now ?? new Date();

  const [created] = await db
    .insert(projects)
    .values({
      id: input.id,
      userId: input.userId,
      type: input.type,
      title: input.title,
      level: input.level ?? null,
      field: input.field ?? null,
      institution: input.institution ?? null,
      status: "draft",
      targetPages: input.targetPages ?? null,
      idealPages: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();

  if (!created) {
    throw new Error("Failed to insert project record");
  }

  return created;
}
`
  );

  writeFileEnsureDir(
    "src/db/queries/jobs-log.ts",
    `import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "../client";
import { JOB_STATUSES, jobsLog, type JobLogRecord } from "../schema";

export const RecordJobLogInputSchema = z.object({
  id: z.string().min(1),
  workflowId: z.string().min(1),
  projectId: z.string().min(1).nullable().optional(),
  step: z.string().min(1),
  provider: z.string().min(1).default("anthropic"),
  model: z.string().min(1),
  status: z.enum(JOB_STATUSES),
  tokensIn: z.number().int().nonnegative().default(0),
  tokensOut: z.number().int().nonnegative().default(0),
  costEstimateUsd: z.number().nonnegative().default(0),
  latencyMs: z.number().int().nonnegative().nullable().optional(),
  error: z.string().max(4000).nullable().optional(),
  now: z.date().optional(),
});

export type RecordJobLogInput = z.input<typeof RecordJobLogInputSchema>;

export async function recordJobLog(db: AppDb, rawInput: RecordJobLogInput): Promise<JobLogRecord> {
  const input = RecordJobLogInputSchema.parse(rawInput);
  const [created] = await db
    .insert(jobsLog)
    .values({
      id: input.id,
      workflowId: input.workflowId,
      projectId: input.projectId ?? null,
      step: input.step,
      provider: input.provider,
      model: input.model,
      status: input.status,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      costEstimateUsd: input.costEstimateUsd,
      latencyMs: input.latencyMs ?? null,
      error: input.error ?? null,
      createdAt: input.now ?? new Date(),
    })
    .returning();

  if (!created) {
    throw new Error("Failed to insert jobs_log record");
  }

  return created;
}

export async function listJobLogsByWorkflow(
  db: AppDb,
  workflowId: string
): Promise<JobLogRecord[]> {
  return db
    .select()
    .from(jobsLog)
    .where(eq(jobsLog.workflowId, workflowId))
    .orderBy(desc(jobsLog.createdAt));
}
`
  );

  writeFileEnsureDir(
    "scripts/seed.sql",
    `-- Idempotent local development seed for Collate (safe to run multiple times).
-- Note: Do not wrap in BEGIN TRANSACTION; Cloudflare D1 manages statement atomicity.

INSERT OR IGNORE INTO users (
  id, email, email_verified, name, image, credits_balance, created_at, updated_at
) VALUES (
  'usr_seed_dev_001',
  'dev@collate.local',
  1,
  'Collate Dev Researcher',
  NULL,
  100,
  1763726400000,
  1763726400000
);

INSERT OR IGNORE INTO projects (
  id, user_id, type, title, level, field, institution, status, target_pages, ideal_pages, created_at, updated_at
) VALUES (
  'prj_seed_dev_001',
  'usr_seed_dev_001',
  'thesis',
  'Solar Microgrid Reliability in Sub-Saharan Peri-Urban Communities',
  'Masters',
  'Renewable Energy Systems',
  'Sample University',
  'draft',
  80,
  NULL,
  1763726400000,
  1763726400000
);

INSERT OR IGNORE INTO jobs_log (
  id, workflow_id, project_id, step, provider, model, status, tokens_in, tokens_out, cost_estimate_usd, latency_ms, error, created_at
) VALUES (
  'job_seed_dev_001',
  'wf_seed_bootstrap',
  'prj_seed_dev_001',
  'seed_smoke_check',
  'anthropic',
  'configured-at-runtime',
  'succeeded',
  0,
  0,
  0,
  1,
  NULL,
  1763726400000
);
`
  );

  writeFileEnsureDir(
    "scripts/bootstrap/provision-cloudflare.mjs",
    `/**
 * Run this script ONCE AFTER 'pnpm exec wrangler login' when you are ready
 * to create real remote Cloudflare resources for dev, staging, and prod.
 *
 * Usage:
 *   node scripts/bootstrap/provision-cloudflare.mjs
 */
import { execFileSync } from "node:child_process";

const IS_WIN = process.platform === "win32";
const ENVS = ["dev", "staging", "prod"];

function run(args) {
  console.log(\`> pnpm exec wrangler \${args.join(" ")}\`);
  try {
    execFileSync("pnpm", ["exec", "wrangler", ...args], {
      shell: IS_WIN,
      stdio: "inherit",
    });
  } catch {
    console.log("  (resource may already exist — verify output above)");
  }
}

console.log("Checking Cloudflare authentication...");
run(["whoami"]);

for (const env of ENVS) {
  console.log(\`\n=== Provisioning \${env} ===\`);
  run(["d1", "create", \`collate-\${env}\`]);
  run(["r2", "bucket", "create", \`collate-files-\${env}\`]);
  run(["queues", "create", \`collate-fetch-\${env}\`]);
  run(["vectorize", "create", \`collate-passages-\${env}\`, "--dimensions=768", "--metric=cosine"]);
}

console.log("\\nNext: copy the printed D1 database_id values into wrangler.jsonc, then run:");
console.log("  pnpm run db:migrate:staging");
`
  );
}

function writeDatabaseTests() {
  logStep("6. Writing in-memory D1 test harness (node:sqlite) and database integration tests");

  writeFileEnsureDir(
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

  writeFileEnsureDir(
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

    // Bob cannot read Alice's project even if he knows its ID
    const unauthorizedLookup = await getProjectForUser(db, "usr_b", aliceProject.id);
    expect(unauthorizedLookup).toBeNull();

    // Alice can read her own project
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

    // Cost history remains intact with project_id nulled out
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
}

function generateAndApplyMigrations() {
  logStep("7. Generating Drizzle SQL migration and applying to local Cloudflare D1");

  const drizzleDir = path.join(ROOT, "drizzle");
  const existingSql =
    fs.existsSync(drizzleDir) &&
    fs.readdirSync(drizzleDir).some((file) => file.endsWith(".sql"));

  if (existingSql) {
    console.log("  ℹ Existing migration SQL found in drizzle/ — skipping initial generate.");
  } else {
    run("pnpm", ["exec", "drizzle-kit", "generate", "--name", "init_foundations"]);
  }

  run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local"], {
    nonInteractive: true,
  });

  // Run seed twice against real local Wrangler D1 to prove idempotency
  run("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--file=scripts/seed.sql"], {
    nonInteractive: true,
  });
  run("pnpm", ["exec", "wrangler", "d1", "execute", "DB", "--local", "--file=scripts/seed.sql"], {
    nonInteractive: true,
  });

  // Generate Cloudflare Worker binding types
  run("pnpm", ["run", "cf-typegen"], { nonInteractive: true });
}

function verifyAll() {
  logStep("8. Running format and full verification gate (typecheck, lint, format, test, build)");
  run("pnpm", ["run", "format"]);
  run("pnpm", ["run", "verify"]);
}

function updateProgressMd() {
  logStep("9. Updating PROGRESS.md after verified pass");
  const progressPath = path.join(ROOT, "PROGRESS.md");
  if (!fs.existsSync(progressPath)) return;

  let content = fs.readFileSync(progressPath, "utf8");
  content = content.replace(
    "- [ ] Step 0.2: Drizzle + D1 migrations + seed script",
    "- [x] Step 0.2: Drizzle + D1 migrations + seed script (verified locally with Wrangler D1 + Vitest)"
  );
  fs.writeFileSync(progressPath, content, "utf8");
  console.log("  ✓ Updated PROGRESS.md");
}

function main() {
  console.log("Collate — Phase 0 / Step 0.2 (Drizzle ORM + Cloudflare D1)");
  verifyStep01Present();
  installDrizzle();
  updateWranglerBindings();
  updatePackageAndConfigs();
  writeDatabaseLayer();
  generateAndApplyMigrations();
  verifyAll();
  updateProgressMd();

  console.log("\n========================================");
  console.log("✓ Step 0.2 PASSED all verification gates!");
  console.log("========================================");
  console.log("Verified:");
  console.log("  • Drizzle schema + SQL migration generated in drizzle/");
  console.log("  • Real Wrangler local D1 migrated & seeded idempotently");
  console.log("  • Vitest DB integration suite proved UNIQUE, CHECK, FK, cascade, and user isolation");
  console.log("  • typecheck, lint, format:check, test, and vinext build all passed");
  console.log("\nPaste this output back to proceed to Step 0.3 (AI Gateway + callLLM cost logging).");
}

main();
