import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export * from './auth-schema';

type Severity = 'info' | 'warning' | 'critical';

export const devices = sqliteTable('devices', {
	ieee: text('ieee').primaryKey(),
	instanceId: text('instance_id').notNull().default('default'),
	friendlyName: text('friendly_name'),
	alias: text('alias'),
	type: text('type'),
	powerSource: text('power_source'),
	model: text('model'),
	vendor: text('vendor'),
	firmware: text('firmware'),
	networkAddress: integer('network_address'),
	availability: text('availability'),
	lastSeenAt: integer('last_seen_at'),
	firstSeenAt: integer('first_seen_at'),
	removedAt: integer('removed_at'),
	mutedUntil: integer('muted_until'),
	tags: text('tags', { mode: 'json' }).$type<{ chatty?: boolean; ignore?: boolean }>(),
	ignoreRules: text('ignore_rules', { mode: 'json' }).$type<string[]>(),
	typicalGapMs: integer('typical_gap_ms'),
	maxVoltage: real('max_voltage'),
	batteryLow: integer('battery_low', { mode: 'boolean' })
});

export const samples = sqliteTable(
	'samples',
	{
		ieee: text('ieee').notNull(),
		ts: integer('ts').notNull(),
		lqi: integer('lqi'),
		battery: real('battery'),
		voltage: real('voltage')
	},
	(t) => [primaryKey({ columns: [t.ieee, t.ts] }), index('samples_ts_idx').on(t.ts)]
);

export const samplesHourly = sqliteTable(
	'samples_hourly',
	{
		ieee: text('ieee').notNull(),
		hour: integer('hour').notNull(),
		lqiMin: integer('lqi_min'),
		lqiAvg: real('lqi_avg'),
		lqiMax: integer('lqi_max'),
		batteryMin: real('battery_min'),
		voltageMin: real('voltage_min'),
		msgCount: integer('msg_count').notNull()
	},
	(t) => [primaryKey({ columns: [t.ieee, t.hour] }), index('samples_hourly_hour_idx').on(t.hour)]
);

export type BaselineMetric = 'lqi_mean' | 'lqi_stddev' | 'route_errors_hourly' | 'battery_days_left' | 'msg_per_min' | 'battery_report_gap_h' | 'battery_last_report';

export const baselines = sqliteTable(
	'baselines',
	{
		ieee: text('ieee').notNull(), // '' = network
		metric: text('metric').$type<BaselineMetric>().notNull(),
		value: real('value').notNull(),
		days: integer('days').notNull(),
		computedAt: integer('computed_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.ieee, t.metric] })]
);

export const events = sqliteTable(
	'events',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		ts: integer('ts').notNull(),
		ieee: text('ieee'),
		kind: text('kind').notNull(),
		detail: text('detail', { mode: 'json' }).$type<Record<string, unknown>>()
	},
	(t) => [index('events_ts_idx').on(t.ts)]
);

export const issues = sqliteTable(
	'issues',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		rule: text('rule').notNull(),
		ieee: text('ieee'),
		// NULLs are distinct in SQLite unique indexes, so the index uses this instead.
		ieeeKey: text('ieee_key').notNull().generatedAlwaysAs(sql`coalesce(ieee, '')`),
		severity: text('severity').$type<Severity>().notNull(),
		state: text('state').$type<'open' | 'acknowledged' | 'resolved'>().notNull(),
		openedAt: integer('opened_at').notNull(),
		updatedAt: integer('updated_at').notNull(),
		resolvedAt: integer('resolved_at'),
		summary: text('summary').notNull(),
		action: text('action').notNull(),
		evidence: text('evidence', { mode: 'json' }).$type<Record<string, unknown>>(),
		lastNotifiedAt: integer('last_notified_at'),
		parentIssueId: integer('parent_issue_id')
	},
	(t) => [uniqueIndex('issues_open_unique').on(t.rule, t.ieeeKey).where(sql`state != 'resolved'`)]
);

export const channels = sqliteTable('channels', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	kind: text('kind').notNull(),
	name: text('name').notNull(),
	config: text('config', { mode: 'json' }).$type<Record<string, unknown>>(),
	minSeverity: text('min_severity').$type<Severity>().notNull().default('warning'),
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true)
});

export const outbox = sqliteTable('outbox', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	channelId: integer('channel_id').notNull(),
	issueId: integer('issue_id'),
	kind: text('kind').notNull(),
	severity: text('severity').$type<Severity>().notNull(),
	message: text('message', { mode: 'json' }).$type<unknown>().notNull(),
	dedupeKey: text('dedupe_key').notNull().unique(),
	status: text('status').$type<'pending' | 'held' | 'sent' | 'failed'>().notNull().default('pending'),
	attempts: integer('attempts').notNull().default(0),
	nextAttemptAt: integer('next_attempt_at'),
	lastError: text('last_error'),
	createdAt: integer('created_at').notNull(),
	sentAt: integer('sent_at')
});

export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value', { mode: 'json' }).$type<unknown>().notNull()
});

export const healthSamples = sqliteTable('health_samples', {
	ts: integer('ts').primaryKey(),
	uptimeSec: integer('uptime_sec'),
	mqttQueued: integer('mqtt_queued'),
	devices: text('devices', { mode: 'json' }).$type<Record<string, { leaves: number; addr: number }>>().notNull()
});

export const healthScores = sqliteTable('health_scores', {
	ts: integer('ts').primaryKey(),
	score: integer('score').notNull()
});

export const scans = sqliteTable('scans', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	kind: text('kind').notNull(),
	trigger: text('trigger').$type<'scheduled' | 'manual'>().notNull(),
	startedAt: integer('started_at').notNull(),
	finishedAt: integer('finished_at'),
	status: text('status').$type<'ok' | 'failed' | 'skipped' | 'running'>().notNull(),
	reason: text('reason'),
	nodes: integer('nodes'),
	links: integer('links'),
	/** coordinator_check: routers missing from the coordinator; networkmap: routers that did not answer */
	missing: text('missing', { mode: 'json' }).$type<string[]>()
}, (t) => [index('scans_kind_started').on(t.kind, t.startedAt)]);

export const scanLinks = sqliteTable('scan_links', {
	scanId: integer('scan_id').notNull(),
	sourceIeee: text('source_ieee').notNull(),
	targetIeee: text('target_ieee').notNull(),
	lqi: integer('lqi'),
	depth: integer('depth'),
	relationship: integer('relationship')
}, (t) => [index('scan_links_scan').on(t.scanId)]);

export const wifiAps = sqliteTable('wifi_aps', {
	mac: text('mac').primaryKey(),
	name: text('name').notNull(),
	model: text('model').notNull(),
	area: text('area'),
	lastSeen: integer('last_seen').notNull()
});

export const wifiSamples = sqliteTable('wifi_samples', {
	ts: integer('ts').notNull(),
	mac: text('mac').notNull(),
	channel: integer('channel').notNull(),
	width: integer('width').notNull(),
	cuTotal: real('cu_total'),
	cuSelfRx: real('cu_self_rx'),
	cuSelfTx: real('cu_self_tx'),
	numSta: integer('num_sta'),
	txPower: real('tx_power')
}, (t) => [index('wifi_samples_mac_ts').on(t.mac, t.ts)]);

export const wifiAreas = sqliteTable('wifi_areas', {
	name: text('name').primaryKey(),
	match: text('match').notNull()
});
