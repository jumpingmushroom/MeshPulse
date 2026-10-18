CREATE TABLE `baselines` (
	`ieee` text NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	`days` integer NOT NULL,
	`computed_at` integer NOT NULL,
	PRIMARY KEY(`ieee`, `metric`)
);
--> statement-breakpoint
CREATE TABLE `samples_hourly` (
	`ieee` text NOT NULL,
	`hour` integer NOT NULL,
	`lqi_min` integer,
	`lqi_avg` real,
	`lqi_max` integer,
	`battery_min` real,
	`voltage_min` real,
	`msg_count` integer NOT NULL,
	PRIMARY KEY(`ieee`, `hour`)
);
