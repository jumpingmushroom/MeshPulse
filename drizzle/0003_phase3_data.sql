CREATE TABLE `health_samples` (
	`ts` integer PRIMARY KEY NOT NULL,
	`uptime_sec` integer,
	`mqtt_queued` integer,
	`devices` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `health_scores` (
	`ts` integer PRIMARY KEY NOT NULL,
	`score` integer NOT NULL
);
