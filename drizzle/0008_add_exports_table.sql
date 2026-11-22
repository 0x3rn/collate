CREATE TABLE `exports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`chapter_id` text,
	`scope` text NOT NULL,
	`format` text NOT NULL,
	`r2_key` text NOT NULL,
	`page_count` integer DEFAULT 0 NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "exports_counts_non_negative" CHECK("exports"."page_count" >= 0 AND "exports"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE INDEX `exports_project_idx` ON `exports` (`project_id`,`created_at`);