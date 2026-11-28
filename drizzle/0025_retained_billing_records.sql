CREATE TABLE `retained_billing_records` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_reference` text NOT NULL,
	`provider_order_id` text,
	`customer_email` text NOT NULL,
	`customer_name` text NOT NULL,
	`currency` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`credits` integer NOT NULL,
	`status` text NOT NULL,
	`paid_at` integer NOT NULL,
	`account_erased_at` integer NOT NULL,
	`evidence_json` text,
	`evidence_purge_after` integer NOT NULL,
	`record_purge_after` integer NOT NULL,
	`open_dispute` integer DEFAULT 0 NOT NULL
);
CREATE UNIQUE INDEX `retained_billing_payment_unique` ON `retained_billing_records` (`payment_id`);
CREATE INDEX `retained_billing_reference_idx` ON `retained_billing_records` (`provider`,`provider_reference`);
CREATE INDEX `retained_billing_order_idx` ON `retained_billing_records` (`provider`,`provider_order_id`);
CREATE INDEX `retained_billing_paid_idx` ON `retained_billing_records` (`paid_at`);
-- These actions are always written with a signed-in actor, so a missing actor means the account
-- was already deleted: remove the IP address and device details left behind.
UPDATE `audit_log` SET `metadata_json` = NULL WHERE `actor_user_id` IS NULL AND `action` IN ('auth.signup','auth.signin','auth.signup_google','auth.signin_google','billing.checkout_started','export.downloaded');
