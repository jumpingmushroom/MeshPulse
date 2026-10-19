CREATE TABLE `wifi_aps` (
	`mac` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`model` text NOT NULL,
	`area` text,
	`last_seen` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wifi_areas` (
	`name` text PRIMARY KEY NOT NULL,
	`match` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wifi_samples` (
	`ts` integer NOT NULL,
	`mac` text NOT NULL,
	`channel` integer NOT NULL,
	`width` integer NOT NULL,
	`cu_total` real,
	`cu_self_rx` real,
	`cu_self_tx` real,
	`num_sta` integer,
	`tx_power` real
);
--> statement-breakpoint
CREATE INDEX `wifi_samples_mac_ts` ON `wifi_samples` (`mac`,`ts`);