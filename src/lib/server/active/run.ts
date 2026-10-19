import { and, desc, eq, ne } from 'drizzle-orm';
import type { Config } from '../config';
import type { Db } from '../db/index';
import { issues, scanLinks, scans } from '../db/schema';
import type { Requester } from '../mqtt/request';
import { issueKey } from '../rules/types';
import { getSettings } from '../settings';
import type { AppState } from '../types';
import { parseCoordinatorCheck, parseNetworkmap } from './parse';
import { activeGuard, localDay, setLastDay } from './schedule';

export interface ActiveDeps { db: Db; state: AppState; requester: Requester; config: Config }
type Kind = 'networkmap' | 'coordinator_check';
export type RunResult = { status: 'ok' | 'failed' | 'skipped'; reason?: string };

const TIMEOUT = { networkmap: 600_000, coordinator_check: 60_000 };

export async function runActive(deps: ActiveDeps, kind: Kind, trigger: 'scheduled' | 'manual', now: number): Promise<RunResult> {
	const { db, state, requester, config } = deps;
	const open = new Set(db.select().from(issues).where(ne(issues.state, 'resolved')).all().map((i) => issueKey(i.rule, i.ieee)));
	const skip = activeGuard(state, open, now, requester.busy(kind));
	if (skip) {
		// one skipped row per day: later ticks update it rather than adding another
		const last = db.select().from(scans).where(eq(scans.kind, kind)).orderBy(desc(scans.startedAt), desc(scans.id)).get();
		if (last?.status === 'skipped' && last.trigger === trigger && localDay(last.startedAt, config.tz) === localDay(now, config.tz))
			db.update(scans).set({ startedAt: now, finishedAt: now, reason: skip }).where(eq(scans.id, last.id)).run();
		else db.insert(scans).values({ kind, trigger, startedAt: now, finishedAt: now, status: 'skipped', reason: skip }).run();
		return { status: 'skipped', reason: skip };
	}
	let res: RunResult;
	try {
		if (kind === 'coordinator_check') {
			const missing = parseCoordinatorCheck(await requester.request(kind, {}, TIMEOUT[kind]));
			db.insert(scans).values({ kind, trigger, startedAt: now, finishedAt: Date.now(), status: 'ok', missing }).run();
		} else {
			const map = parseNetworkmap(await requester.request(kind, { type: 'raw', routes: false }, TIMEOUT[kind]));
			db.transaction((tx) => {
				const { id } = tx.insert(scans).values({ kind, trigger, startedAt: now, finishedAt: Date.now(), status: 'ok', nodes: map.nodes.length, links: map.links.length, missing: map.nodes.filter((n) => n.failed).map((n) => n.ieee) }).returning({ id: scans.id }).get();
				for (let i = 0; i < map.links.length; i += 100)
					tx.insert(scanLinks).values(map.links.slice(i, i + 100).map((l) => ({ scanId: id, sourceIeee: l.source, targetIeee: l.target, lqi: l.lqi, depth: l.depth, relationship: l.relationship }))).run();
			});
		}
		res = { status: 'ok' };
	} catch (e) {
		const reason = e instanceof Error ? e.message : String(e);
		db.insert(scans).values({ kind, trigger, startedAt: now, finishedAt: Date.now(), status: 'failed', reason }).run();
		res = { status: 'failed', reason };
	}
	if (trigger === 'scheduled') setLastDay(db, kind, localDay(now, config.tz));
	return res;
}

/** Engine input: missing routers from the latest ok check (a newer failed one does not clear it; null when the check is off, so its issues resolve), and consecutive failed scheduled network scans. */
export function loadActive(db: Db): { missingRouters: string[] | null; scanFailStreak: number } {
	const ok = !getSettings(db).activeCoordinatorCheck ? undefined
		: db.select().from(scans).where(and(eq(scans.kind, 'coordinator_check'), eq(scans.status, 'ok'))).orderBy(desc(scans.startedAt), desc(scans.id)).get();
	// manual failures say nothing about the nightly scan; an ok manual scan does clear it
	const recent = db.select({ status: scans.status, trigger: scans.trigger }).from(scans).where(and(eq(scans.kind, 'networkmap'), ne(scans.status, 'skipped'))).orderBy(desc(scans.startedAt), desc(scans.id)).limit(50).all()
		.filter((r) => r.status === 'ok' || r.trigger === 'scheduled');
	const firstOk = recent.findIndex((r) => r.status === 'ok');
	return { missingRouters: ok?.missing ?? null, scanFailStreak: firstOk === -1 ? recent.length : firstOk };
}

/** Starts a manual network scan without awaiting it; refused by the guard, when the scan is off, or within 60 min of the last manual one. */
export async function requestManualScan(deps: ActiveDeps, now: number): Promise<{ ok: true } | { ok: false; reason: string }> {
	const { db, state, requester } = deps;
	if (!getSettings(db).activeNetworkScan) return { ok: false, reason: 'The network scan is off' };
	const open = new Set(db.select().from(issues).where(ne(issues.state, 'resolved')).all().map((i) => issueKey(i.rule, i.ieee)));
	const reason = activeGuard(state, open, now, requester.busy('networkmap'));
	if (reason) return { ok: false, reason };
	const last = db.select().from(scans).where(and(eq(scans.kind, 'networkmap'), eq(scans.trigger, 'manual'), ne(scans.status, 'skipped'))).orderBy(desc(scans.startedAt)).get();
	if (last && now - last.startedAt < 3_600_000) return { ok: false, reason: 'A manual scan ran less than an hour ago' };
	// runActive reaches request() synchronously, so busy() is already true when this returns
	void runActive(deps, 'networkmap', 'manual', now).catch((e) => console.error('active: manual scan failed', e));
	return { ok: true };
}
