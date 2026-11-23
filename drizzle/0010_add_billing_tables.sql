CREATE TABLE `credit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text,
	`chapter_id` text,
	`payment_id` text,
	`idempotency_key` text NOT NULL,
	`entry_type` text NOT NULL,
	`credits_delta` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "credit_ledger_balance_non_negative" CHECK("credit_ledger"."balance_after" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_ledger_idempotency_unique` ON `credit_ledger` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `credit_ledger_user_idx` ON `credit_ledger` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `credit_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`chapter_id` text,
	`idempotency_key` text NOT NULL,
	`credits_reserved` integer NOT NULL,
	`status` text DEFAULT 'held' NOT NULL,
	`created_at` integer NOT NULL,
	`settled_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "credit_reservations_positive" CHECK("credit_reservations"."credits_reserved" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_reservations_idempotency_unique` ON `credit_reservations` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `credit_reservations_user_idx` ON `credit_reservations` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_reference` text NOT NULL,
	`currency` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`credits_granted` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`raw_event_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "payments_amount_positive" CHECK("payments"."amount_minor" > 0 AND "payments"."credits_granted" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_provider_ref_unique` ON `payments` (`provider`,`provider_reference`);--> statement-breakpoint
CREATE INDEX `payments_user_idx` ON `payments` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `system_controls` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
