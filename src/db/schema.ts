import { sql } from "drizzle-orm";
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
    check("users_credits_non_negative", sql`${table.creditsBalance} >= 0`),
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
      sql`${table.type} IN ('project', 'research', 'thesis', 'assignment')`
    ),
    check(
      "projects_status_valid",
      sql`${table.status} IN ('draft', 'researching', 'feasible', 'not_feasible', 'needs_refinement', 'outline_pending', 'in_progress', 'completed', 'archived')`
    ),
    check(
      "projects_target_pages_positive",
      sql`${table.targetPages} IS NULL OR ${table.targetPages} > 0`
    ),
    check(
      "projects_ideal_pages_positive",
      sql`${table.idealPages} IS NULL OR ${table.idealPages} > 0`
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
      sql`${table.status} IN ('started', 'succeeded', 'failed', 'retrying')`
    ),
    check("jobs_log_tokens_non_negative", sql`${table.tokensIn} >= 0 AND ${table.tokensOut} >= 0`),
    check("jobs_log_cost_non_negative", sql`${table.costEstimateUsd} >= 0`),
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
