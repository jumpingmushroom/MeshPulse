import { and, desc, eq, ne } from 'drizzle-orm';
import type { Config } from '../config';
import type { Db } from '../db/index';
import { issues, scans } from '../db/schema';
import type { Requester } from '../mqtt/request';
import { issueKey } from '../rules/types';
import type { AppState } from '../types';
import { parseCoordinatorCheck } from './parse';
import { activeGuard, localDay, setLastDay } from './schedule';

export interface ActiveDeps { db: Db; state: AppState; requester: Requester; config: Config }
type Kind = 'networkmap' | 'coordinator_check';
export type RunResult = { status: 'ok' | 'failed' | 'skipped'; reason?: string };

const TIMEOUT = { networkmap: 600_000, coordinator_check: 60_000 };

export async function runActive(deps: ActiveDeps, kind: Kind, trigger: 'scheduled' | 'manual', now: number): Promise<RunResult> {
	const { db, state, requester, config } = deps;
	if (kind !== 'coordinator_check') throw new Error('networkmap runs arrive with the network scan');
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
		const missing = parseCoordinatorCheck(await requester.request(kind, {}, TIMEOUT[kind]));
		db.insert(scans).values({ kind, trigger, startedAt: now, finishedAt: Date.now(), status: 'ok', missing }).run();
		res = { status: 'ok' };
	} catch (e) {
		const reason = e instanceof Error ? e.message : String(e);
		db.insert(scans).values({ kind, trigger, startedAt: now, finishedAt: Date.now(), status: 'failed', reason }).run();
		res = { status: 'failed', reason };
	}
	if (trigger === 'scheduled') setLastDay(db, kind, localDay(now, config.tz));
	return res;
}

/** Engine input: missing routers from the latest ok check (a newer failed one does not clear it), and consecutive failed scans. */
export function loadActive(db: Db): { missingRouters: string[] | null; scanFailStreak: number } {
	const ok = db.select().from(scans).where(and(eq(scans.kind, 'coordinator_check'), eq(scans.status, 'ok'))).orderBy(desc(scans.startedAt), desc(scans.id)).get();
	const recent = db.select({ status: scans.status }).from(scans).where(and(eq(scans.kind, 'networkmap'), ne(scans.status, 'skipped'))).orderBy(desc(scans.startedAt), desc(scans.id)).limit(10).all();
	const firstOk = recent.findIndex((r) => r.status === 'ok');
	return { missingRouters: ok?.missing ?? null, scanFailStreak: firstOk === -1 ? recent.length : firstOk };
}
