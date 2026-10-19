import { asc, desc, eq, gte, ne } from 'drizzle-orm';
import type { Config } from './config';
import type { Db } from './db/index';
import { events, healthSamples, issues } from './db/schema';
import { latestParents } from './active/parents';
import { loadActive } from './active/run';
import { evaluate, newIssue, type Counters, type IssueRow, type Notify } from './issues/lifecycle';
import { isQuietHours } from './issues/quiet';
import { enqueue, foldHeld } from './notify/outbox';
import { sendWeekly } from './notify/weekly';
import { prune } from './retention';
import { evaluateRules, issueKey, type EventRow, type RuleId } from './rules/index';
import { deviceSilentFor } from './rules/bridge-offline';
import { loadWifiSnapshot } from './wifi/snapshot';
import { loadHistory } from './trends/history';
import { hourStart, computeBaselines, recordScore, rollupHours } from './trends/rollup';
import { getSettings } from './settings';
import { flushDevices } from './store';
import type { AppState, EventKind } from './types';
import { FOREVER } from '../views';

const MIN = 60_000;
const H = 60 * MIN;

export interface EngineDeps {
	db: Db;
	state: AppState;
	counters: Counters;
	config: Config;
	dirty: Set<string>;
	// overridable for tests; default to the outbox
	notify?: (issue: IssueRow, n: Notify, quiet: boolean) => void;
	foldHeld?: (now: number) => void;
}

const toRow = ({ ieeeKey: _k, ...r }: typeof issues.$inferSelect): IssueRow =>
	({ ...r, rule: r.rule as RuleId, evidence: r.evidence ?? {} });

const fold = (deps: EngineDeps, now: number) => (deps.foldHeld ?? ((t: number) => foldHeld(deps.db, t)))(now);

export function runOnce(deps: EngineDeps, now: number): void {
	const { db, state, counters, config } = deps;
	const settings = getSettings(db);
	const longEvents: EventRow[] = db.select().from(events).where(gte(events.ts, now - Math.max(24, settings.causingWindowH) * H))
		.orderBy(asc(events.ts), asc(events.id)).all().map((e) => ({ ...e, kind: e.kind as EventKind, detail: e.detail ?? {} }));
	const evs = longEvents.filter((e) => e.ts >= now - 24 * H);
	const open = db.select().from(issues).where(ne(issues.state, 'resolved')).all().map(toRow);
	const ctx = { now, state, events: evs, longEvents, settings, open: new Set(open.map((i) => issueKey(i.rule, i.ieee))),
		openCritical: new Set(open.filter((i) => i.severity === 'critical').map((i) => issueKey(i.rule, i.ieee))),
		history: loadHistory(db, now),
		wifi: { ...loadWifiSnapshot(db, state, now), enabled: settings.wifiEnabled, failures: state.wifi.failures, lastError: state.wifi.lastError }, active: { ...loadActive(db), baseTopic: config.baseTopic },
		health: db.select({ ts: healthSamples.ts, queued: healthSamples.mqttQueued }).from(healthSamples).orderBy(desc(healthSamples.ts)).limit(2).all().reverse() };
	const findings = evaluateRules(ctx);
	let parents: ReturnType<typeof latestParents> | undefined; // loaded only when grouping asks
	const r = evaluate({ findings, issues: open, counters, settings, now, networkQuiet: deviceSilentFor(ctx, 60_000), device: (ieee) => state.devices.get(ieee), realParent: (ieee) => (parents ??= latestParents(db, (i) => state.devices.get(i)?.type, now, false))?.parents.get(ieee)?.parent ?? null,
		// ignored devices are silent like muted ones, so ignoring does not send "Resolved" for each issue
		mutedUntil: (ieee) => (state.devices.get(ieee)?.tags.includes('ignore') ? FOREVER : (state.devices.get(ieee)?.mutedUntil ?? null)) });
	const quiet = isQuietHours(now, settings, config.tz);

	db.transaction((tx) => {
		const byKey = new Map(open.map((i) => [issueKey(i.rule, i.ieee), i]));
		const byId = new Map(open.map((i) => [i.id, i]));
		for (const f of r.opens) {
			const key = issueKey(f.rule, f.ieee);
			const row = tx.insert(issues).values(newIssue(f, now, r.notify.some((n) => n.key === key))).returning().get();
			byKey.set(key, toRow(row));
		}
		for (const { id, patch } of r.updates) {
			tx.update(issues).set(patch).where(eq(issues.id, id)).run();
			Object.assign(byId.get(id)!, patch);
		}
		for (const [c, p] of r.parentOf) {
			const row = byKey.get(c)!;
			row.parentIssueId = byKey.get(p)!.id;
			tx.update(issues).set({ parentIssueId: row.parentIssueId }).where(eq(issues.id, row.id)).run();
		}
		const notify = deps.notify ?? ((issue: IssueRow, n: Notify, quiet: boolean) => enqueue(db, issue, n,
			{ now, quiet, publicUrl: config.publicUrl, tz: config.tz, device: (issue.ieee && state.devices.get(issue.ieee)) || null }));
		for (const n of r.notify) notify(byKey.get(n.key)!, n, quiet);
		// every non-quiet run: covers quiet hours ending, being disabled or moved, and restarts (no-op when nothing is held)
		if (!quiet) fold(deps, now);
	});
	sendWeekly(db, state, now, config.tz, quiet);
	state.monitor.lastRulesRunAt = now;
	flushDevices(db, state, deps.dirty);
}

export function startEngine(deps: EngineDeps): { stop(): void } {
	let prunedAt = 0;
	let lastTrendHour = 0;
	const timer = setInterval(() => {
		const now = Date.now();
		try {
			runOnce(deps, now);
		} catch (e) {
			console.error('engine: run failed', e); // keep the loop alive; the next run retries
		}
		try {
			if (now - prunedAt >= H) {
				prune(deps.db, now);
				prunedAt = now;
			}
		} catch (e) {
			console.error('engine: prune failed', e);
		}
		try {
			if (hourStart(now) > lastTrendHour) {
				rollupHours(deps.db, deps.state, now);
				computeBaselines(deps.db, now);
				recordScore(deps.db, deps.db.select().from(issues).where(ne(issues.state, 'resolved')).all(), now);
				lastTrendHour = hourStart(now);
			}
		} catch (e) {
			console.error('engine: trend job failed', e);
		}
	}, MIN);
	return { stop: () => clearInterval(timer) };
}
