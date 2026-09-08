CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`event` text NOT NULL,
	`summary` text NOT NULL,
	`created` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_owner_created` ON `audit` (`owner`,`created`);--> statement-breakpoint
CREATE TABLE `job_targets` (
	`owner` text NOT NULL,
	`device` text NOT NULL,
	`job` text NOT NULL,
	`expires` text NOT NULL,
	PRIMARY KEY(`owner`, `device`)
);
--> statement-breakpoint
CREATE INDEX `idx_job_targets_job` ON `job_targets` (`job`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`encrypted` text NOT NULL,
	`state` text NOT NULL,
	`created` text NOT NULL,
	`expires` text NOT NULL,
	`result_digest` text,
	`result` text
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_owner_created` ON `jobs` (`owner`,`created`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`owner` text PRIMARY KEY NOT NULL,
	`encrypted` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated` text NOT NULL
);
