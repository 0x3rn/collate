ALTER TABLE `payments` ADD COLUMN `provider_order_id` text;
UPDATE `payments` SET `provider_order_id` = json_extract(`raw_event_json`, '$.data.id') WHERE `provider` = 'polar' AND json_valid(`raw_event_json`);
CREATE INDEX `payments_provider_order_idx` ON `payments` (`provider`,`provider_order_id`);
ALTER TABLE `users` ADD COLUMN `billing_hold_reason` text;
ALTER TABLE `users` ADD COLUMN `billing_hold_at` integer;
CREATE TABLE `payment_reversals` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`kind` text NOT NULL,
	`provider_reversal_id` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`credits_target` integer DEFAULT 0 NOT NULL,
	`credits_removed` integer DEFAULT 0 NOT NULL,
	`credits_short` integer DEFAULT 0 NOT NULL,
	`due_at` integer,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "payment_reversals_kind_valid" CHECK("payment_reversals"."kind" IN ('refund', 'dispute')),
	CONSTRAINT "payment_reversals_credits_non_negative" CHECK("payment_reversals"."credits_target" >= 0 AND "payment_reversals"."credits_removed" >= 0 AND "payment_reversals"."credits_short" >= 0)
);
CREATE UNIQUE INDEX `payment_reversals_provider_unique` ON `payment_reversals` (`provider`,`kind`,`provider_reversal_id`);
CREATE INDEX `payment_reversals_payment_idx` ON `payment_reversals` (`payment_id`);
CREATE INDEX `payment_reversals_user_idx` ON `payment_reversals` (`user_id`,`created_at`);
