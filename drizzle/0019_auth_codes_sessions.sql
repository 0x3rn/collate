CREATE TABLE `auth_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`purpose` text NOT NULL,
	`code_hash` text NOT NULL,
	`target` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `auth_codes_user_purpose_idx` ON `auth_codes` (`user_id`,`purpose`);
ALTER TABLE `sessions` ADD COLUMN `city` text;
ALTER TABLE `sessions` ADD COLUMN `country` text;
ALTER TABLE `sessions` ADD COLUMN `last_seen_at` integer;
