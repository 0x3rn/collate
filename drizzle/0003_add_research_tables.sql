CREATE TABLE `research_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`question_id` text,
	`workflow_instance_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`subtopics_json` text DEFAULT '[]' NOT NULL,
	`queries_json` text DEFAULT '[]' NOT NULL,
	`sources_found` integer DEFAULT 0 NOT NULL,
	`sources_fetched` integer DEFAULT 0 NOT NULL,
	`subtopics_covered` integer DEFAULT 0 NOT NULL,
	`spend_cap_usd` real DEFAULT 2 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`error` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "research_runs_counts_non_negative" CHECK("research_runs"."sources_found" >= 0 AND "research_runs"."sources_fetched" >= 0),
	CONSTRAINT "research_runs_cost_non_negative" CHECK("research_runs"."cost_usd" >= 0 AND "research_runs"."spend_cap_usd" > 0)
);
--> statement-breakpoint
CREATE INDEX `research_runs_project_idx` ON `research_runs` (`project_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `source_passages` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`project_id` text NOT NULL,
	`passage_index` integer NOT NULL,
	`text` text NOT NULL,
	`location` text DEFAULT 'body' NOT NULL,
	`token_count` integer DEFAULT 0 NOT NULL,
	`vector_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "source_passages_index_non_negative" CHECK("source_passages"."passage_index" >= 0),
	CONSTRAINT "source_passages_tokens_non_negative" CHECK("source_passages"."token_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_passages_source_idx_unique` ON `source_passages` (`source_id`,`passage_index`);--> statement-breakpoint
CREATE INDEX `source_passages_project_idx` ON `source_passages` (`project_id`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`question_id` text,
	`research_run_id` text,
	`url` text NOT NULL,
	`canonical_url` text NOT NULL,
	`doi` text,
	`title` text NOT NULL,
	`normalized_title` text NOT NULL,
	`authors_json` text DEFAULT '[]' NOT NULL,
	`year` integer,
	`publisher` text,
	`venue` text,
	`source_type` text DEFAULT 'web' NOT NULL,
	`connector_name` text NOT NULL,
	`citation_count` integer,
	`credibility_score` real DEFAULT 0 NOT NULL,
	`relevance_score` real DEFAULT 0 NOT NULL,
	`access_status` text DEFAULT 'metadata_only' NOT NULL,
	`fetch_status` text DEFAULT 'pending' NOT NULL,
	`abstract_text` text,
	`snapshot_r2_key` text,
	`retrieved_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`research_run_id`) REFERENCES `research_runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "sources_credibility_range" CHECK("sources"."credibility_score" >= 0 AND "sources"."credibility_score" <= 100),
	CONSTRAINT "sources_relevance_range" CHECK("sources"."relevance_score" >= 0 AND "sources"."relevance_score" <= 100)
);
--> statement-breakpoint
CREATE INDEX `sources_project_idx` ON `sources` (`project_id`);--> statement-breakpoint
CREATE INDEX `sources_project_doi_idx` ON `sources` (`project_id`,`doi`);--> statement-breakpoint
CREATE INDEX `sources_project_canonical_url_idx` ON `sources` (`project_id`,`canonical_url`);