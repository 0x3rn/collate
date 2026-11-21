CREATE TABLE `project_memory` (
	`project_id` text PRIMARY KEY NOT NULL,
	`outline_json` text DEFAULT '{}' NOT NULL,
	`outline_locked` integer DEFAULT false NOT NULL,
	`chapter_summaries_json` text DEFAULT '[]' NOT NULL,
	`glossary_json` text DEFAULT '[]' NOT NULL,
	`style_notes` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sections` (
	`id` text PRIMARY KEY NOT NULL,
	`chapter_id` text NOT NULL,
	`order_index` integer NOT NULL,
	`heading` text NOT NULL,
	`word_budget` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sections_order_positive" CHECK("sections"."order_index" >= 1),
	CONSTRAINT "sections_word_budget_non_negative" CHECK("sections"."word_budget" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sections_chapter_order_unique` ON `sections` (`chapter_id`,`order_index`);--> statement-breakpoint
CREATE INDEX `sections_chapter_idx` ON `sections` (`chapter_id`);