CREATE TABLE `scan_links` (
	`scan_id` integer NOT NULL,
	`source_ieee` text NOT NULL,
	`target_ieee` text NOT NULL,
	`lqi` integer,
	`depth` integer,
	`relationship` integer
);
--> statement-breakpoint
CREATE INDEX `scan_links_scan` ON `scan_links` (`scan_id`);--> statement-breakpoint
CREATE TABLE `scans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`trigger` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`reason` text,
	`nodes` integer,
	`links` integer,
	`missing` text
);
--> statement-breakpoint
CREATE INDEX `scans_kind_started` ON `scans` (`kind`,`started_at`);