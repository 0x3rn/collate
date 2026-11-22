CREATE TABLE `chapter_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`chapter_id` text NOT NULL,
	`version` integer NOT NULL,
	`content_r2_key` text NOT NULL,
	`word_count` integer DEFAULT 0 NOT NULL,
	`page_count` integer DEFAULT 0 NOT NULL,
	`prompt_version` text DEFAULT 'v1.0' NOT NULL,
	`created_by` text DEFAULT 'ai' NOT NULL,
	`revision_notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chapter_versions_version_positive" CHECK("chapter_versions"."version" >= 1),
	CONSTRAINT "chapter_versions_counts_non_negative" CHECK("chapter_versions"."word_count" >= 0 AND "chapter_versions"."page_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chapter_versions_chapter_version_unique` ON `chapter_versions` (`chapter_id`,`version`);--> statement-breakpoint
CREATE INDEX `chapter_versions_chapter_idx` ON `chapter_versions` (`chapter_id`);--> statement-breakpoint
CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`text` text NOT NULL,
	`citation_id` text,
	`passage_id` text,
	`verdict` text DEFAULT 'unsupported' NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`verifier_notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`citation_id`) REFERENCES `citations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`passage_id`) REFERENCES `source_passages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `claims_chapter_idx` ON `claims` (`chapter_id`);--> statement-breakpoint
CREATE INDEX `claims_section_idx` ON `claims` (`section_id`);--> statement-breakpoint
CREATE TABLE `project_datasets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`filename` text NOT NULL,
	`r2_key` text NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`columns_json` text DEFAULT '[]' NOT NULL,
	`summary_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_datasets_rows_non_negative" CHECK("project_datasets"."row_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `project_datasets_project_idx` ON `project_datasets` (`project_id`);--> statement-breakpoint
CREATE TABLE `section_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`run_id` text NOT NULL,
	`draft_text` text NOT NULL,
	`word_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'verified' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `section_drafts_section_run_unique` ON `section_drafts` (`section_id`,`run_id`);--> statement-breakpoint
CREATE INDEX `section_drafts_chapter_run_idx` ON `section_drafts` (`chapter_id`,`run_id`);