ALTER TABLE `notification_preferences` ADD COLUMN `email_marketing` integer DEFAULT 0 NOT NULL;
CREATE TABLE `email_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`mailbox` text NOT NULL,
	`subject` text NOT NULL,
	`contact_email` text NOT NULL,
	`contact_name` text,
	`user_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`unread` integer DEFAULT 1 NOT NULL,
	`last_message_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX `email_threads_mailbox_idx` ON `email_threads` (`mailbox`,`last_message_at`);
CREATE INDEX `email_threads_contact_idx` ON `email_threads` (`contact_email`);
CREATE TABLE `email_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`direction` text NOT NULL,
	`from_address` text NOT NULL,
	`to_address` text NOT NULL,
	`subject` text NOT NULL,
	`text_body` text NOT NULL,
	`message_id_header` text,
	`sender_verified` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `email_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `email_messages_thread_idx` ON `email_messages` (`thread_id`,`created_at`);
CREATE INDEX `email_messages_message_id_idx` ON `email_messages` (`message_id_header`);
CREATE TABLE `email_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`r2_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `email_messages`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `email_attachments_message_idx` ON `email_attachments` (`message_id`);
CREATE TABLE `email_broadcasts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'sending' NOT NULL,
	`recipient_count` integer DEFAULT 0 NOT NULL,
	`sent_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE TABLE `email_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`r2_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer NOT NULL
);
