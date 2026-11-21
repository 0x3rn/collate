CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_provider_account_unique` ON `accounts` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `accounts_user_id_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`metadata_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_entity_idx` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_log_actor_idx` ON `audit_log` (`actor_user_id`);--> statement-breakpoint
CREATE TABLE `jobs_log` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`project_id` text,
	`step` text NOT NULL,
	`provider` text DEFAULT 'anthropic' NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`cost_estimate_usd` real DEFAULT 0 NOT NULL,
	`latency_ms` integer,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "jobs_log_status_valid" CHECK("jobs_log"."status" IN ('started', 'succeeded', 'failed', 'retrying')),
	CONSTRAINT "jobs_log_tokens_non_negative" CHECK("jobs_log"."tokens_in" >= 0 AND "jobs_log"."tokens_out" >= 0),
	CONSTRAINT "jobs_log_cost_non_negative" CHECK("jobs_log"."cost_estimate_usd" >= 0)
);
--> statement-breakpoint
CREATE INDEX `jobs_log_workflow_idx` ON `jobs_log` (`workflow_id`);--> statement-breakpoint
CREATE INDEX `jobs_log_project_idx` ON `jobs_log` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`level` text,
	`field` text,
	`institution` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`target_pages` integer,
	`ideal_pages` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "projects_type_valid" CHECK("projects"."type" IN ('project', 'research', 'thesis', 'assignment')),
	CONSTRAINT "projects_status_valid" CHECK("projects"."status" IN ('draft', 'researching', 'feasible', 'not_feasible', 'needs_refinement', 'outline_pending', 'in_progress', 'completed', 'archived')),
	CONSTRAINT "projects_target_pages_positive" CHECK("projects"."target_pages" IS NULL OR "projects"."target_pages" > 0),
	CONSTRAINT "projects_ideal_pages_positive" CHECK("projects"."ideal_pages" IS NULL OR "projects"."ideal_pages" > 0)
);
--> statement-breakpoint
CREATE INDEX `projects_user_created_idx` ON `projects` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`name` text NOT NULL,
	`image` text,
	`credits_balance` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "users_credits_non_negative" CHECK("users"."credits_balance" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verifications_identifier_idx` ON `verifications` (`identifier`);