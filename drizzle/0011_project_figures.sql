CREATE TABLE IF NOT EXISTS `project_figures` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`url` text NOT NULL,
	`source_page_url` text NOT NULL,
	`title` text NOT NULL,
	`alt` text NOT NULL,
	`caption` text NOT NULL,
	`attribution` text NOT NULL,
	`license` text NOT NULL,
	`mime_type` text NOT NULL,
	`natural_width` integer NOT NULL,
	`natural_height` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `project_figures_dimensions_positive` CHECK(`natural_width` > 0 AND `natural_height` > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `project_figures_project_url_unique` ON `project_figures` (`project_id`,`url`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_figures_project_idx` ON `project_figures` (`project_id`,`created_at`);
