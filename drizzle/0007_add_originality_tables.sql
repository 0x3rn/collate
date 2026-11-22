CREATE TABLE `chapter_fingerprints` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`chapter_version_id` text NOT NULL,
	`topic_normalized` text NOT NULL,
	`shingle_hashes_json` text DEFAULT '[]' NOT NULL,
	`embedding_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_version_id`) REFERENCES `chapter_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chapter_fingerprints_topic_idx` ON `chapter_fingerprints` (`topic_normalized`);--> statement-breakpoint
CREATE INDEX `chapter_fingerprints_user_idx` ON `chapter_fingerprints` (`user_id`);--> statement-breakpoint
CREATE TABLE `originality_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`chapter_version_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`project_id` text NOT NULL,
	`overlap_score` real DEFAULT 0 NOT NULL,
	`semantic_score` real DEFAULT 0 NOT NULL,
	`quote_share_pct` real DEFAULT 0 NOT NULL,
	`cross_user_score` real DEFAULT 0 NOT NULL,
	`flagged_spans_json` text DEFAULT '[]' NOT NULL,
	`external_report_json` text,
	`passed` integer DEFAULT false NOT NULL,
	`waived` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chapter_version_id`) REFERENCES `chapter_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "originality_scores_range" CHECK("originality_reports"."overlap_score" >= 0 AND "originality_reports"."overlap_score" <= 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `originality_reports_version_unique` ON `originality_reports` (`chapter_version_id`);--> statement-breakpoint
CREATE INDEX `originality_reports_chapter_idx` ON `originality_reports` (`chapter_id`);--> statement-breakpoint
CREATE INDEX `originality_reports_project_idx` ON `originality_reports` (`project_id`);