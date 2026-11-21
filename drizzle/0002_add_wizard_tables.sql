CREATE TABLE `chapters` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`chapter_type` text DEFAULT 'custom' NOT NULL,
	`brief` text,
	`page_budget` integer,
	`word_budget` integer,
	`is_auto_references` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'not_started' NOT NULL,
	`workflow_instance_id` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chapters_number_positive" CHECK("chapters"."number" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chapters_project_number_unique` ON `chapters` (`project_id`,`number`);--> statement-breakpoint
CREATE INDEX `chapters_project_idx` ON `chapters` (`project_id`);--> statement-breakpoint
CREATE TABLE `feasibility_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`question_id` text,
	`verdict` text NOT NULL,
	`score` real NOT NULL,
	`reasons_json` text NOT NULL,
	`coverage_json` text NOT NULL,
	`is_mocked` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "feasibility_score_range" CHECK("feasibility_reports"."score" >= 0 AND "feasibility_reports"."score" <= 100)
);
--> statement-breakpoint
CREATE INDEX `feasibility_project_idx` ON `feasibility_reports` (`project_id`);--> statement-breakpoint
CREATE INDEX `feasibility_question_idx` ON `feasibility_reports` (`question_id`);--> statement-breakpoint
CREATE TABLE `project_settings` (
	`project_id` text PRIMARY KEY NOT NULL,
	`citation_style` text DEFAULT 'apa7' NOT NULL,
	`inline_mode` text DEFAULT 'inline_and_list' NOT NULL,
	`font` text DEFAULT 'Times New Roman' NOT NULL,
	`font_size_pt` integer DEFAULT 12 NOT NULL,
	`line_spacing` text DEFAULT 'double' NOT NULL,
	`margins_mm` integer DEFAULT 25 NOT NULL,
	`page_numbering` integer DEFAULT true NOT NULL,
	`spelling` text DEFAULT 'uk' NOT NULL,
	`front_matter_json` text NOT NULL,
	`cover_json` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_settings_font_size_valid" CHECK("project_settings"."font_size_pt" >= 10 AND "project_settings"."font_size_pt" <= 14),
	CONSTRAINT "project_settings_margins_valid" CHECK("project_settings"."margins_mm" >= 15 AND "project_settings"."margins_mm" <= 40)
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`text` text NOT NULL,
	`order_index` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "questions_order_positive" CHECK("questions"."order_index" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `questions_project_order_unique` ON `questions` (`project_id`,`order_index`);--> statement-breakpoint
CREATE INDEX `questions_project_idx` ON `questions` (`project_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `supervisor_notes` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `wizard_step` integer DEFAULT 1 NOT NULL;