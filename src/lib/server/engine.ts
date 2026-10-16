import { asc, eq, gte, ne } from 'drizzle-orm';
import type { Config } from './config';
import type { Db } from './db/index';
import { events, issues } from './db/schema';
import { evaluate, newIssue, type Counters, type IssueRow, type Notify } from './issues/lifecycle';
import { isQuietHours, quietHoursEnded } from './issues/quiet';
import { prune } from './retention';
import { evaluateRules, issueKey, type EventRow, type RuleId } from './rules/index';
import { getSettings } from './settings';
import { flushDevices } from './store';
import type { AppState, EventKind } from './types';

const MIN = 60_000;
const H = 60 * MIN;

export interface EngineDeps {
	db: Db;
	state: AppState;
	counters: Counters;
	config: Config;
	dirty: Set<string>;
	// real implementations arrive with the outbox (Task 9)
	notify?: (issue: IssueRow, n: Notify, quiet: boolean) => void;
	foldHeld?: (now: number) => void;
}

const toRow = ({ ieeeKey: _k, parentIssueId: _p, ...r }: typeof issues.$inferSelect): IssueRow =>
	({ ...r, rule: r.rule as RuleId, evidence: r.evidence ?? {} });

export function runOnce(deps: EngineDeps, now: number): void {
	const { db, state, counters, config } = deps;
	const settings = getSettings(db);
	const evs: EventRow[] = db.select().from(events).where(gte(events.ts, now - 24 * H)).orderBy(asc(events.ts), asc(events.id)).all()
		.map((e) => ({ ...e, kind: e.kind as EventKind, detail: e.detail ?? {} }));
	const open = db.select().from(issues).where(ne(issues.state, 'resolved')).all().map(toRow);
	const findings = evaluateRules({ now, state, events: evs, settings, open: new Set(open.map((i) => issueKey(i.rule, i.ieee))) });
	const r = evaluate({ findings, issues: open, counters, settings, now,
		mutedUntil: (ieee) => state.devices.get(ieee)?.mutedUntil ?? null });
	const quiet = isQuietHours(now, settings, config.tz);
	const prev = state.monitor.lastRulesRunAt;

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
		for (const n of r.notify) deps.notify?.(byKey.get(n.key)!, n, quiet);
		state.monitor.lastRulesRunAt = now;
	});
	flushDevices(db, state, deps.dirty);
	if (prev !== null && quietHoursEnded(prev, now, settings, config.tz)) deps.foldHeld?.(now);
}

export function startEngine(deps: EngineDeps): { stop(): void } {
	let prunedAt = 0;
	const timer = setInterval(() => {
		const now = Date.now();
		try {
			runOnce(deps, now);
			if (now - prunedAt >= H) {
				prune(deps.db, now);
				prunedAt = now;
			}
		} catch (e) {
			console.error('engine: run failed', e); // keep the loop alive; the next run retries
		}
	}, MIN);
	return { stop: () => clearInterval(timer) };
}
