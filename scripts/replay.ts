import { ne } from 'drizzle-orm';
import { loadConfig } from '../src/lib/server/config';
import { openDb } from '../src/lib/server/db/index';
import { issues } from '../src/lib/server/db/schema';
import { runOnce } from '../src/lib/server/engine';
import { route } from '../src/lib/server/mqtt/route';
import { saveSettings, type Settings } from '../src/lib/server/settings';
import { applyEffects } from '../src/lib/server/store';
import { computeBaselines, hourStart, recordScore, rollupHours } from '../src/lib/server/trends/rollup';
import { createState, type Effect, type MqttMsg, type Severity } from '../src/lib/server/types';
import { formatTime } from '../src/lib/views';

const MIN = 60_000;

export interface ReplayReport {
	from: number;
	to: number;
	messages: number;
	issues: { rule: string; ieee: string | null; name: string | null; severity: Severity; openedAt: number; resolvedAt: number | null }[];
	notifications: { at: number; rule: string; kind: string; severity: string; name: string | null; held: boolean }[];
}

/** Feeds a capture through the real router, DB-backed engine and trend jobs on capture time; nothing is sent. */
export function replay(lines: MqttMsg[], opts: { settings?: Partial<Settings> } = {}): ReplayReport {
	if (!lines.length) return { from: 0, to: 0, messages: 0, issues: [], notifications: [] };
	// captures are in order; copy and sort only when not (avoids a 1.2 M element copy)
	const msgs = lines.every((m, i) => i === 0 || lines[i - 1].ts <= m.ts) ? lines : [...lines].sort((a, b) => a.ts - b.ts);
	const from = msgs[0].ts;
	const to = msgs[msgs.length - 1].ts;
	const config = loadConfig({ SECRET_KEY: 'replay', TZ: process.env.TZ });
	const db = openDb(':memory:');
	if (opts.settings) saveSettings(db, opts.settings);
	const state = createState(from);
	Object.assign(state.monitor, { connected: true, connectedAt: from });
	const dirty = new Set<string>();
	const counters = { seen: new Map<string, number>(), missing: new Map<string, number>() };
	const notifications: ReplayReport['notifications'] = [];
	const notify = (issue: { rule: string; ieee: string | null }, n: { kind: string; severity: string }, quiet: boolean) =>
		notifications.push({ at: state.monitor.lastRulesRunAt ?? 0, rule: issue.rule, kind: n.kind, severity: n.severity,
			name: (issue.ieee && state.devices.get(issue.ieee)?.friendlyName) || null, held: quiet && n.severity !== 'critical' }); // as enqueue()
	const deps = { db, state, counters, config, dirty, foldHeld: () => {}, notify: (i: never, n: never, q: boolean) => notify(i, n, q) };

	let next = 0;
	let lastHour = 0;
	for (let now = from + MIN; now <= to + MIN; now += MIN) {
		const fx: Effect[] = [];
		for (; next < msgs.length && msgs[next].ts <= now; next++) fx.push(...route(state, msgs[next], config.baseTopic));
		applyEffects(db, fx, dirty);
		// notify() stamps with lastRulesRunAt, so set it before the run
		state.monitor.lastRulesRunAt = now;
		runOnce(deps, now);
		if (hourStart(now) > lastHour) {
			rollupHours(db, state, now);
			computeBaselines(db, now);
			recordScore(db, db.select().from(issues).where(ne(issues.state, 'resolved')).all(), now);
			lastHour = hourStart(now);
		}
	}
	const name = (ieee: string | null) => (ieee && state.devices.get(ieee)?.friendlyName) || null;
	return {
		from, to, messages: msgs.length, notifications,
		issues: db.select().from(issues).all().map((i) => ({ rule: i.rule, ieee: i.ieee, name: name(i.ieee), severity: i.severity as Severity,
			openedAt: i.openedAt, resolvedAt: i.resolvedAt }))
	};
}

export function formatReport(r: ReplayReport, tz: string): string {
	const count = (xs: { rule: string; severity: string }[]) => {
		const m = new Map<string, number>();
		for (const x of xs) m.set(`${x.rule} ${x.severity}`, (m.get(`${x.rule} ${x.severity}`) ?? 0) + 1);
		return [...m].sort().map(([k, n]) => `  ${k}: ${n}`);
	};
	return [
		`Replay ${formatTime(r.from, tz)} - ${formatTime(r.to, tz)}, ${r.messages} messages`,
		`Issues (${r.issues.length}):`, ...count(r.issues),
		`Notifications (${r.notifications.length}):`, ...count(r.notifications),
		...r.notifications.map((n) => `${formatTime(n.at, tz)} ${n.kind} ${n.severity} ${n.rule} ${n.name ?? '-'}${n.held ? ' (held)' : ''}`)
	].join('\n');
}
