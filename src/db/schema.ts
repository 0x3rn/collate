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

export const CITATION_STYLES = ["harvard", "apa7", "mla9", "chicago", "ieee", "vancouver"] as const;
export type CitationStyle = (typeof CITATION_STYLES)[number];

export const CITATION_INLINE_MODES = ["inline_and_list", "list_only"] as const;
export type CitationInlineMode = (typeof CITATION_INLINE_MODES)[number];

export const LINE_SPACINGS = ["single", "one_half", "double"] as const;
export type LineSpacing = (typeof LINE_SPACINGS)[number];

export const SPELLING_VARIANTS = ["uk", "us"] as const;
export type SpellingVariant = (typeof SPELLING_VARIANTS)[number];

export const PAGE_SIZES = ["a4", "letter"] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export const HEADING_COLORS = ["black", "blue"] as const;
export type HeadingColor = (typeof HEADING_COLORS)[number];

export const EXPERIMENTAL_DATA_MODES = ["user_provided", "published_benchmarks"] as const;
export type ExperimentalDataMode = (typeof EXPERIMENTAL_DATA_MODES)[number];

export const FEASIBILITY_VERDICTS = ["feasible", "not_feasible", "needs_refinement"] as const;
export type FeasibilityVerdict = (typeof FEASIBILITY_VERDICTS)[number];

export const RESEARCH_RUN_STATUSES = [
  "queued",
  "planning",
  "searching",
  "fetching",
  "scoring",
  "completed",
  "failed",
] as const;
export type ResearchRunStatus = (typeof RESEARCH_RUN_STATUSES)[number];

export const SOURCE_TYPES = [
  "peer_reviewed",
  "preprint",
  "institutional",
  "book",
  "dataset",
  "web",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_ACCESS_STATUSES = [
  "full_text",
  "abstract_only",
  "metadata_only",
  "fetch_failed",
] as const;
export type SourceAccessStatus = (typeof SOURCE_ACCESS_STATUSES)[number];

export const SOURCE_FETCH_STATUSES = ["pending", "fetched", "failed", "skipped"] as const;
export type SourceFetchStatus = (typeof SOURCE_FETCH_STATUSES)[number];

export const CHAPTER_VERSION_CREATORS = ["ai", "user", "revision"] as const;
export type ChapterVersionCreator = (typeof CHAPTER_VERSION_CREATORS)[number];

export const PAYMENT_PROVIDERS = ["paystack", "polar", "stripe"] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "cancelled",
  "refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const CREDIT_LEDGER_TYPES = [
  "purchase",
  "reserve",
  "capture",
  "refund",
  "manual_adjustment",
  "sweep_fee",
] as const;
export type CreditLedgerType = (typeof CREDIT_LEDGER_TYPES)[number];

export const RESERVATION_STATUSES = ["held", "captured", "refunded"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const EXPORT_SCOPES = ["chapter", "combined", "full"] as const;
export type ExportScope = (typeof EXPORT_SCOPES)[number];

export const EXPORT_FORMATS = ["pdf", "docx"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const CLAIM_VERDICTS = ["supported", "partly_supported", "unsupported"] as const;
export type ClaimVerdict = (typeof CLAIM_VERDICTS)[number];

export const CITATION_VERIFICATION_STATUSES = [
  "unverified",
  "verified",
  "fake_or_not_found",
  "title_mismatch",
  "dead_url",
] as const;
export type CitationVerificationStatus = (typeof CITATION_VERIFICATION_STATUSES)[number];

export const SECTION_STATUSES = ["not_started", "drafting", "verified", "needs_revision"] as const;
export type SectionStatus = (typeof SECTION_STATUSES)[number];

export const CHAPTER_STATUSES = [
  "not_started",
  "queued",
  "writing",
  "ready",
  "approved",
  "needs_attention",
] as const;
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];

export const CHAPTER_ATTACHMENT_KINDS = ["csv", "markdown", "text"] as const;
export type ChapterAttachmentKind = (typeof CHAPTER_ATTACHMENT_KINDS)[number];

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    name: text("name").notNull(),
    image: text("image"),
    creditsBalance: integer("credits_balance").notNull().default(0),
    /**
     * Set while a payment dispute is open, or after a refund the user had already spent credits
     * from. While set, the account cannot buy or spend credits. Cleared by an admin, or
     * automatically when a dispute is won.
     */
    billingHoldReason: text("billing_hold_reason"),
    billingHoldAt: integer("billing_hold_at", { mode: "timestamp_ms" }),
    /** Signed-in analytics cookie choice; acceptance persists on the account, while declines expire after 7 days. */
    analyticsConsent: text("analytics_consent", { enum: ["accepted", "declined"] }),
    analyticsConsentAt: integer("analytics_consent_at", { mode: "timestamp_ms" }),
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
    /** Approximate location from Cloudflare at sign-in (city and two-letter country code). */
    city: text("city"),
    country: text("country"),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
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

/**
 * Six-digit one-time codes (email verification, password reset, email change). Stored hashed,
 * one live code per user and purpose, deleted when used, expired or guessed wrong too often.
 */
export const authCodes = sqliteTable(
  "auth_codes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    codeHash: text("code_hash").notNull(),
    /** Extra data the code confirms, such as the new address for an email change. */
    target: text("target"),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("auth_codes_user_purpose_idx").on(table.userId, table.purpose)]
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
    supervisorNotes: text("supervisor_notes"),
    status: text("status", { enum: PROJECT_STATUSES }).notNull().default("draft"),
    wizardStep: integer("wizard_step").notNull().default(1),
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

export const projectSettings = sqliteTable(
  "project_settings",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projects.id, { onDelete: "cascade" }),
    citationStyle: text("citation_style", { enum: CITATION_STYLES }).notNull().default("apa7"),
    inlineMode: text("inline_mode", { enum: CITATION_INLINE_MODES })
      .notNull()
      .default("inline_and_list"),
    font: text("font").notNull().default("Times New Roman"),
    fontSizePt: integer("font_size_pt").notNull().default(12),
    lineSpacing: text("line_spacing", { enum: LINE_SPACINGS }).notNull().default("double"),
    marginsMm: integer("margins_mm").notNull().default(25),
    pageSize: text("page_size", { enum: PAGE_SIZES }).notNull().default("a4"),
    pageNumbering: integer("page_numbering", { mode: "boolean" }).notNull().default(true),
    headingColor: text("heading_color", { enum: HEADING_COLORS }).notNull().default("black"),
    spelling: text("spelling", { enum: SPELLING_VARIANTS }).notNull().default("uk"),
    isExperimental: integer("is_experimental", { mode: "boolean" }).notNull().default(false),
    experimentalDataMode: text("experimental_data_mode", { enum: EXPERIMENTAL_DATA_MODES })
      .notNull()
      .default("user_provided"),
    frontMatterJson: text("front_matter_json").notNull(),
    coverJson: text("cover_json").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "project_settings_font_size_valid",
      sql`${table.fontSizePt} >= 10 AND ${table.fontSizePt} <= 14`
    ),
    check(
      "project_settings_margins_valid",
      sql`${table.marginsMm} >= 15 AND ${table.marginsMm} <= 40`
    ),
  ]
);

export const questions = sqliteTable(
  "questions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    orderIndex: integer("order_index").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("questions_project_order_unique").on(table.projectId, table.orderIndex),
    index("questions_project_idx").on(table.projectId),
    check("questions_order_positive", sql`${table.orderIndex} >= 1`),
  ]
);

export const chapters = sqliteTable(
  "chapters",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    chapterType: text("chapter_type").notNull().default("custom"),
    brief: text("brief"),
    userInstructions: text("user_instructions"),
    userAttachmentName: text("user_attachment_name"),
    userAttachmentKind: text("user_attachment_kind", { enum: CHAPTER_ATTACHMENT_KINDS }),
    userDataSummaryMarkdown: text("user_data_summary_markdown"),
    pageBudget: integer("page_budget"),
    wordBudget: integer("word_budget"),
    isAutoReferences: integer("is_auto_references", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: CHAPTER_STATUSES }).notNull().default("not_started"),
    workflowInstanceId: text("workflow_instance_id"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("chapters_project_number_unique").on(table.projectId, table.number),
    index("chapters_project_idx").on(table.projectId),
    check("chapters_number_positive", sql`${table.number} >= 1`),
  ]
);

export const feasibilityReports = sqliteTable(
  "feasibility_reports",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    questionId: text("question_id").references(() => questions.id, { onDelete: "cascade" }),
    verdict: text("verdict", { enum: FEASIBILITY_VERDICTS }).notNull(),
    score: real("score").notNull(),
    reasonsJson: text("reasons_json").notNull(),
    coverageJson: text("coverage_json").notNull(),
    isMocked: integer("is_mocked", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("feasibility_project_idx").on(table.projectId),
    index("feasibility_question_idx").on(table.questionId),
    check("feasibility_score_range", sql`${table.score} >= 0 AND ${table.score} <= 100`),
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
    index("jobs_log_created_at_idx").on(table.createdAt),
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

export const authRateLimits = sqliteTable(
  "auth_rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(0),
    windowStartMs: integer("window_start_ms").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [check("auth_rate_limits_count_non_negative", sql`${table.count} >= 0`)]
);

export const researchRuns = sqliteTable(
  "research_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    questionId: text("question_id").references(() => questions.id, { onDelete: "cascade" }),
    workflowInstanceId: text("workflow_instance_id"),
    status: text("status", { enum: RESEARCH_RUN_STATUSES }).notNull().default("queued"),
    subtopicsJson: text("subtopics_json").notNull().default("[]"),
    queriesJson: text("queries_json").notNull().default("[]"),
    sourcesFound: integer("sources_found").notNull().default(0),
    sourcesFetched: integer("sources_fetched").notNull().default(0),
    subtopicsCovered: integer("subtopics_covered").notNull().default(0),
    spendCapUsd: real("spend_cap_usd").notNull().default(2.0),
    costUsd: real("cost_usd").notNull().default(0),
    error: text("error"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("research_runs_project_idx").on(table.projectId, table.startedAt),
    check(
      "research_runs_counts_non_negative",
      sql`${table.sourcesFound} >= 0 AND ${table.sourcesFetched} >= 0`
    ),
    check(
      "research_runs_cost_non_negative",
      sql`${table.costUsd} >= 0 AND ${table.spendCapUsd} > 0`
    ),
  ]
);

export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    questionId: text("question_id").references(() => questions.id, { onDelete: "cascade" }),
    researchRunId: text("research_run_id").references(() => researchRuns.id, {
      onDelete: "set null",
    }),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    doi: text("doi"),
    title: text("title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    authorsJson: text("authors_json").notNull().default("[]"),
    year: integer("year"),
    publisher: text("publisher"),
    venue: text("venue"),
    sourceType: text("source_type", { enum: SOURCE_TYPES }).notNull().default("web"),
    connectorName: text("connector_name").notNull(),
    citationCount: integer("citation_count"),
    credibilityScore: real("credibility_score").notNull().default(0),
    relevanceScore: real("relevance_score").notNull().default(0),
    accessStatus: text("access_status", { enum: SOURCE_ACCESS_STATUSES })
      .notNull()
      .default("metadata_only"),
    fetchStatus: text("fetch_status", { enum: SOURCE_FETCH_STATUSES }).notNull().default("pending"),
    abstractText: text("abstract_text"),
    snapshotR2Key: text("snapshot_r2_key"),
    retrievedAt: integer("retrieved_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("sources_project_idx").on(table.projectId),
    index("sources_project_doi_idx").on(table.projectId, table.doi),
    index("sources_project_canonical_url_idx").on(table.projectId, table.canonicalUrl),
    check(
      "sources_credibility_range",
      sql`${table.credibilityScore} >= 0 AND ${table.credibilityScore} <= 100`
    ),
    check(
      "sources_relevance_range",
      sql`${table.relevanceScore} >= 0 AND ${table.relevanceScore} <= 100`
    ),
  ]
);

export const sourcePassages = sqliteTable(
  "source_passages",
  {
    id: text("id").primaryKey(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    passageIndex: integer("passage_index").notNull(),
    text: text("text").notNull(),
    location: text("location").notNull().default("body"),
    tokenCount: integer("token_count").notNull().default(0),
    vectorId: text("vector_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("source_passages_source_idx_unique").on(table.sourceId, table.passageIndex),
    index("source_passages_project_idx").on(table.projectId),
    check("source_passages_index_non_negative", sql`${table.passageIndex} >= 0`),
    check("source_passages_tokens_non_negative", sql`${table.tokenCount} >= 0`),
  ]
);

export const sections = sqliteTable(
  "sections",
  {
    id: text("id").primaryKey(),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull(),
    heading: text("heading").notNull(),
    wordBudget: integer("word_budget").notNull().default(0),
    status: text("status", { enum: SECTION_STATUSES }).notNull().default("not_started"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("sections_chapter_order_unique").on(table.chapterId, table.orderIndex),
    index("sections_chapter_idx").on(table.chapterId),
    check("sections_order_positive", sql`${table.orderIndex} >= 1`),
    check("sections_word_budget_non_negative", sql`${table.wordBudget} >= 0`),
  ]
);

export const projectMemory = sqliteTable("project_memory", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  outlineJson: text("outline_json").notNull().default("{}"),
  outlineLocked: integer("outline_locked", { mode: "boolean" }).notNull().default(false),
  chapterSummariesJson: text("chapter_summaries_json").notNull().default("[]"),
  glossaryJson: text("glossary_json").notNull().default("[]"),
  styleNotes: text("style_notes"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const citations = sqliteTable(
  "citations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    citeKey: text("cite_key").notNull(),
    cslJson: text("csl_json").notNull(),
    verificationStatus: text("verification_status", {
      enum: CITATION_VERIFICATION_STATUSES,
    })
      .notNull()
      .default("unverified"),
    verificationNotes: text("verification_notes"),
    verifiedAt: integer("verified_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("citations_project_key_unique").on(table.projectId, table.citeKey),
    uniqueIndex("citations_project_source_unique").on(table.projectId, table.sourceId),
    index("citations_project_idx").on(table.projectId),
  ]
);

export const chapterVersions = sqliteTable(
  "chapter_versions",
  {
    id: text("id").primaryKey(),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    contentR2Key: text("content_r2_key").notNull(),
    wordCount: integer("word_count").notNull().default(0),
    pageCount: integer("page_count").notNull().default(0),
    promptVersion: text("prompt_version").notNull().default("v1.0"),
    createdBy: text("created_by", { enum: CHAPTER_VERSION_CREATORS }).notNull().default("ai"),
    revisionNotes: text("revision_notes"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("chapter_versions_chapter_version_unique").on(table.chapterId, table.version),
    index("chapter_versions_chapter_idx").on(table.chapterId),
    check("chapter_versions_version_positive", sql`${table.version} >= 1`),
    check(
      "chapter_versions_counts_non_negative",
      sql`${table.wordCount} >= 0 AND ${table.pageCount} >= 0`
    ),
  ]
);

export const sectionDrafts = sqliteTable(
  "section_drafts",
  {
    id: text("id").primaryKey(),
    sectionId: text("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    draftText: text("draft_text").notNull(),
    wordCount: integer("word_count").notNull().default(0),
    status: text("status", { enum: SECTION_STATUSES }).notNull().default("verified"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("section_drafts_section_run_unique").on(table.sectionId, table.runId),
    index("section_drafts_chapter_run_idx").on(table.chapterId, table.runId),
  ]
);

export const claims = sqliteTable(
  "claims",
  {
    id: text("id").primaryKey(),
    sectionId: text("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    citationId: text("citation_id").references(() => citations.id, { onDelete: "set null" }),
    passageId: text("passage_id").references(() => sourcePassages.id, { onDelete: "set null" }),
    verdict: text("verdict", { enum: CLAIM_VERDICTS }).notNull().default("unsupported"),
    verified: integer("verified", { mode: "boolean" }).notNull().default(false),
    verifierNotes: text("verifier_notes"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("claims_chapter_idx").on(table.chapterId),
    index("claims_section_idx").on(table.sectionId),
  ]
);

export const projectDatasets = sqliteTable(
  "project_datasets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    r2Key: text("r2_key").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    columnsJson: text("columns_json").notNull().default("[]"),
    summaryJson: text("summary_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("project_datasets_project_idx").on(table.projectId),
    check("project_datasets_rows_non_negative", sql`${table.rowCount} >= 0`),
  ]
);

export const originalityReports = sqliteTable(
  "originality_reports",
  {
    id: text("id").primaryKey(),
    chapterVersionId: text("chapter_version_id")
      .notNull()
      .references(() => chapterVersions.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    overlapScore: real("overlap_score").notNull().default(0),
    semanticScore: real("semantic_score").notNull().default(0),
    quoteSharePct: real("quote_share_pct").notNull().default(0),
    crossUserScore: real("cross_user_score").notNull().default(0),
    flaggedSpansJson: text("flagged_spans_json").notNull().default("[]"),
    externalReportJson: text("external_report_json"),
    passed: integer("passed", { mode: "boolean" }).notNull().default(false),
    waived: integer("waived", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("originality_reports_version_unique").on(table.chapterVersionId),
    index("originality_reports_chapter_idx").on(table.chapterId),
    index("originality_reports_project_idx").on(table.projectId),
    check(
      "originality_scores_range",
      sql`${table.overlapScore} >= 0 AND ${table.overlapScore} <= 100`
    ),
  ]
);

export const chapterFingerprints = sqliteTable(
  "chapter_fingerprints",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chapterVersionId: text("chapter_version_id")
      .notNull()
      .references(() => chapterVersions.id, { onDelete: "cascade" }),
    topicNormalized: text("topic_normalized").notNull(),
    shingleHashesJson: text("shingle_hashes_json").notNull().default("[]"),
    embeddingJson: text("embedding_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("chapter_fingerprints_topic_idx").on(table.topicNormalized),
    index("chapter_fingerprints_user_idx").on(table.userId),
  ]
);

export const exportsTable = sqliteTable(
  "exports",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id").references(() => chapters.id, { onDelete: "set null" }),
    scope: text("scope", { enum: EXPORT_SCOPES }).notNull(),
    format: text("format", { enum: EXPORT_FORMATS }).notNull(),
    r2Key: text("r2_key").notNull(),
    pageCount: integer("page_count").notNull().default(0),
    sizeBytes: integer("size_bytes").notNull().default(0),
    sha256: text("sha256").notNull(),
    /**
     * Which chapter versions the file was made from, as "chapterId:version" pairs joined by "|".
     * Re-exporting the same versions in the same scope and format replaces the earlier export
     * instead of adding another one. Null on exports made before versions were recorded.
     */
    sourceKey: text("source_key"),
    /** Chapter version number for single-chapter exports (shown on /exports). */
    chapterVersion: integer("chapter_version"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("exports_project_idx").on(table.projectId, table.createdAt),
    // NULL source keys never collide in SQLite, so older exports are unaffected.
    uniqueIndex("exports_project_source_unique").on(
      table.projectId,
      table.scope,
      table.format,
      table.sourceKey
    ),
    check("exports_counts_non_negative", sql`${table.pageCount} >= 0 AND ${table.sizeBytes} >= 0`),
  ]
);

export const notificationPreferences = sqliteTable("notification_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  emailChapterReady: integer("email_chapter_ready", { mode: "boolean" }).notNull().default(true),
  emailNeedsAttention: integer("email_needs_attention", { mode: "boolean" })
    .notNull()
    .default(true),
  emailProjectComplete: integer("email_project_complete", { mode: "boolean" })
    .notNull()
    .default(true),
  emailReceipts: integer("email_receipts", { mode: "boolean" }).notNull().default(true),
  /** Promotions and offers. Off unless the user opts in. */
  emailMarketing: integer("email_marketing", { mode: "boolean" }).notNull().default(false),
  /** Set once the user responds to (or dismisses) the dashboard product-updates opt-in prompt. */
  marketingPromptSeenAt: integer("marketing_prompt_seen_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: PAYMENT_PROVIDERS }).notNull(),
    providerReference: text("provider_reference").notNull(),
    /** Polar order id (refunds and disputes point at the order, not the checkout). */
    providerOrderId: text("provider_order_id"),
    currency: text("currency").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    creditsGranted: integer("credits_granted").notNull(),
    status: text("status", { enum: PAYMENT_STATUSES }).notNull().default("pending"),
    rawEventJson: text("raw_event_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("payments_provider_ref_unique").on(table.provider, table.providerReference),
    index("payments_provider_order_idx").on(table.provider, table.providerOrderId),
    index("payments_user_idx").on(table.userId, table.createdAt),
    check(
      "payments_amount_positive",
      sql`${table.amountMinor} > 0 AND ${table.creditsGranted} > 0`
    ),
  ]
);

export const REVERSAL_KINDS = ["refund", "dispute"] as const;
export type ReversalKind = (typeof REVERSAL_KINDS)[number];

/**
 * Money going back to a customer after a payment: a refund, or a dispute (chargeback) opened
 * with their bank. Each one takes back the matching share of the credits that payment bought.
 */
export const paymentReversals = sqliteTable(
  "payment_reversals",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: PAYMENT_PROVIDERS }).notNull(),
    kind: text("kind", { enum: REVERSAL_KINDS }).notNull(),
    providerReversalId: text("provider_reversal_id").notNull(),
    /** Provider status, e.g. succeeded, needs_response, won, lost, awaiting-merchant-feedback. */
    status: text("status").notNull(),
    reason: text("reason"),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    /** Credits this reversal accounts for (its share of the payment). */
    creditsTarget: integer("credits_target").notNull().default(0),
    /** Credits actually taken back (can be less if they were already spent). */
    creditsRemoved: integer("credits_removed").notNull().default(0),
    /** Credits that were already spent and could not be taken back. */
    creditsShort: integer("credits_short").notNull().default(0),
    dueAt: integer("due_at", { mode: "timestamp_ms" }),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("payment_reversals_provider_unique").on(
      table.provider,
      table.kind,
      table.providerReversalId
    ),
    index("payment_reversals_payment_idx").on(table.paymentId),
    index("payment_reversals_user_idx").on(table.userId, table.createdAt),
    check("payment_reversals_kind_valid", sql`${table.kind} IN ('refund', 'dispute')`),
    check(
      "payment_reversals_credits_non_negative",
      sql`${table.creditsTarget} >= 0 AND ${table.creditsRemoved} >= 0 AND ${table.creditsShort} >= 0`
    ),
  ]
);

export const creditLedger = sqliteTable(
  "credit_ledger",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    chapterId: text("chapter_id").references(() => chapters.id, { onDelete: "set null" }),
    paymentId: text("payment_id").references(() => payments.id, { onDelete: "set null" }),
    idempotencyKey: text("idempotency_key").notNull(),
    entryType: text("entry_type", { enum: CREDIT_LEDGER_TYPES }).notNull(),
    creditsDelta: integer("credits_delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("credit_ledger_idempotency_unique").on(table.idempotencyKey),
    index("credit_ledger_user_idx").on(table.userId, table.createdAt),
    check("credit_ledger_balance_non_negative", sql`${table.balanceAfter} >= 0`),
  ]
);

export const creditReservations = sqliteTable(
  "credit_reservations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    chapterId: text("chapter_id").references(() => chapters.id, { onDelete: "set null" }),
    idempotencyKey: text("idempotency_key").notNull(),
    creditsReserved: integer("credits_reserved").notNull(),
    status: text("status", { enum: RESERVATION_STATUSES }).notNull().default("held"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    settledAt: integer("settled_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("credit_reservations_idempotency_unique").on(table.idempotencyKey),
    index("credit_reservations_user_idx").on(table.userId, table.createdAt),
    check("credit_reservations_positive", sql`${table.creditsReserved} > 0`),
  ]
);

export const systemControls = sqliteTable("system_controls", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** One row per admin alert already sent (for example "ai_spend:2026-11-25:10"), so each fires once. */
export const adminAlerts = sqliteTable("admin_alerts", {
  key: text("key").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const projectFigures = sqliteTable(
  "project_figures",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    sourcePageUrl: text("source_page_url").notNull(),
    title: text("title").notNull(),
    alt: text("alt").notNull(),
    caption: text("caption").notNull(),
    attribution: text("attribution").notNull(),
    license: text("license").notNull(),
    mimeType: text("mime_type").notNull(),
    naturalWidth: integer("natural_width").notNull(),
    naturalHeight: integer("natural_height").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("project_figures_project_url_unique").on(table.projectId, table.url),
    index("project_figures_project_idx").on(table.projectId, table.createdAt),
    check(
      "project_figures_dimensions_positive",
      sql`${table.naturalWidth} > 0 AND ${table.naturalHeight} > 0`
    ),
  ]
);

export type ProjectFigureRecord = typeof projectFigures.$inferSelect;
export type UserRecord = typeof users.$inferSelect;
export type PaymentRecord = typeof payments.$inferSelect;
export type CreditLedgerRecord = typeof creditLedger.$inferSelect;
export type CreditReservationRecord = typeof creditReservations.$inferSelect;
export type NotificationPreferencesRecord = typeof notificationPreferences.$inferSelect;
export type ExportRecord = typeof exportsTable.$inferSelect;
export type OriginalityReportRecord = typeof originalityReports.$inferSelect;
export type ChapterFingerprintRecord = typeof chapterFingerprints.$inferSelect;
export type ChapterVersionRecord = typeof chapterVersions.$inferSelect;
export type SectionDraftRecord = typeof sectionDrafts.$inferSelect;
export type ClaimRecord = typeof claims.$inferSelect;
export type ProjectDatasetRecord = typeof projectDatasets.$inferSelect;
export type CitationRecord = typeof citations.$inferSelect;
export type SectionRecord = typeof sections.$inferSelect;
export type ProjectMemoryRecord = typeof projectMemory.$inferSelect;
export type ResearchRunRecord = typeof researchRuns.$inferSelect;
export type SourceRecord = typeof sources.$inferSelect;
export type SourcePassageRecord = typeof sourcePassages.$inferSelect;
export type NewUserRecord = typeof users.$inferInsert;
export type ProjectRecord = typeof projects.$inferSelect;
export type NewProjectRecord = typeof projects.$inferInsert;
export type ProjectSettingsRecord = typeof projectSettings.$inferSelect;
// ── Admin email inbox ───────────────────────────────────────────────────────

export const INBOX_MAILBOXES = ["support", "billing", "general"] as const;
export type InboxMailbox = (typeof INBOX_MAILBOXES)[number];

/** One conversation with one person in one mailbox (Support, Billing or General). */
export const emailThreads = sqliteTable(
  "email_threads",
  {
    id: text("id").primaryKey(),
    mailbox: text("mailbox", { enum: INBOX_MAILBOXES }).notNull(),
    subject: text("subject").notNull(),
    contactEmail: text("contact_email").notNull(),
    contactName: text("contact_name"),
    /** The Collate account with that email, when there is one. */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status", { enum: ["open", "closed"] })
      .notNull()
      .default("open"),
    unread: integer("unread", { mode: "boolean" }).notNull().default(true),
    lastMessageAt: integer("last_message_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("email_threads_mailbox_idx").on(table.mailbox, table.lastMessageAt),
    index("email_threads_contact_idx").on(table.contactEmail),
  ]
);

export const emailMessages = sqliteTable(
  "email_messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => emailThreads.id, { onDelete: "cascade" }),
    direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    textBody: text("text_body").notNull(),
    /** RFC Message-ID, used to thread replies. */
    messageIdHeader: text("message_id_header"),
    /**
     * False when the From header names a different domain than the sending server used, which
     * is how forged "From" lines usually look. Shown as a warning in the inbox.
     */
    senderVerified: integer("sender_verified", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("email_messages_thread_idx").on(table.threadId, table.createdAt),
    index("email_messages_message_id_idx").on(table.messageIdHeader),
  ]
);

export const emailAttachments = sqliteTable(
  "email_attachments",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => emailMessages.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    r2Key: text("r2_key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("email_attachments_message_idx").on(table.messageId)]
);

export const BROADCAST_KINDS = ["announcement", "promotion"] as const;
export type BroadcastKind = (typeof BROADCAST_KINDS)[number];

/** An announcement or promotion sent to many users. */
export const emailBroadcasts = sqliteTable("email_broadcasts", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: BROADCAST_KINDS }).notNull(),
  subject: text("subject").notNull(),
  /** Body in the composer's simple formatting (rendered to safe HTML when sent). */
  body: text("body").notNull(),
  status: text("status", { enum: ["sending", "sent", "failed"] })
    .notNull()
    .default("sending"),
  recipientCount: integer("recipient_count").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
});

/** Images uploaded for announcements and promotions, served publicly by id. */
export const emailAssets = sqliteTable("email_assets", {
  id: text("id").primaryKey(),
  r2Key: text("r2_key").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export type QuestionRecord = typeof questions.$inferSelect;
export type ChapterRecord = typeof chapters.$inferSelect;
export type FeasibilityReportRecord = typeof feasibilityReports.$inferSelect;
export type JobLogRecord = typeof jobsLog.$inferSelect;
export type NewJobLogRecord = typeof jobsLog.$inferInsert;
