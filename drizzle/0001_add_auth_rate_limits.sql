CREATE TABLE `auth_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`window_start_ms` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "auth_rate_limits_count_non_negative" CHECK("auth_rate_limits"."count" >= 0)
);
