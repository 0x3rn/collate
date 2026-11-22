CREATE TABLE `notification_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email_chapter_ready` integer DEFAULT true NOT NULL,
	`email_needs_attention` integer DEFAULT true NOT NULL,
	`email_project_complete` integer DEFAULT true NOT NULL,
	`email_receipts` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
