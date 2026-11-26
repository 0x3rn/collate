CREATE TABLE `admin_alerts` (
	`key` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
CREATE INDEX `jobs_log_created_at_idx` ON `jobs_log` (`created_at`);
