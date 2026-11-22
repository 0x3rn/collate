CREATE TABLE `citations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_id` text NOT NULL,
	`cite_key` text NOT NULL,
	`csl_json` text NOT NULL,
	`verification_status` text DEFAULT 'unverified' NOT NULL,
	`verification_notes` text,
	`verified_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `citations_project_key_unique` ON `citations` (`project_id`,`cite_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `citations_project_source_unique` ON `citations` (`project_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `citations_project_idx` ON `citations` (`project_id`);