import { beforeEach, describe, expect, it } from 'vitest';
import { DOOR, HALL, LAMP, T, ctx } from '../../../../tests/helpers/ctx';
import { openDb, type Db } from '../db';
import { baselines, channels, events, healthScores, issues, outbox, samplesHourly } from '../db/schema';
import type { AppState } from '../types';
import { sendWeekly, shouldSendWeekly, weeklyDigest } from './weekly';

const TZ = 'Europe/Oslo';
const Z = (s: string) => Date.parse(s);
const H = 3_600_000;
const DAY = 24 * H;

describe('shouldSendWeekly', () => {
	it('not before Sunday 18:00', () => {
		expect(shouldSendWeekly(Z('2026-10-25T16:59:00Z'), '2026-W42', TZ)).toBeNull(); // 17:59 CET, after the DST change
		expect(shouldSendWeekly(Z('2026-10-21T10:00:00Z'), '2026-W42', TZ)).toBeNull();
	});
	it('sends once at Sunday 18:00 across the DST change, and catches up on Monday', () => {
		expect(shouldSendWeekly(Z('2026-10-25T17:00:00Z'), '2026-W42', TZ)).toBe('2026-W43');
		expect(shouldSendWeekly(Z('2026-10-25T17:01:00Z'), '2026-W43', TZ)).toBeNull();
		expect(shouldSendWeekly(Z('2026-10-26T08:00:00Z'), '2026-W42', TZ)).toBe('2026-W43'); // down since 17:00 Sunday, up Monday 09:00
		expect(shouldSendWeekly(Z('2026-10-26T08:00:00Z'), '2026-W43', TZ)).toBeNull();
		expect(shouldSendWeekly(Z('2026-11-01T17:00:00Z'), '2026-W43', TZ)).toBe('2026-W44');
	});
	it('uses the ISO year at the year boundary', () => {
		expect(shouldSendWeekly(Z('2026-12-27T18:00:00Z'), null, TZ)).toBe('2026-W52');
		expect(shouldSendWeekly(Z('2027-01-03T18:00:00Z'), null, TZ)).toBe('2026-W53');
	});
});

describe('weeklyDigest', () => {
	const now = Z('2026-10-25T17:00:00Z');
	let db: Db;
	let state: AppState;
	beforeEach(() => {
		db = openDb(':memory:');
		state = ctx().state;
	});

	it('has every section from real data', () => {
		db.insert(healthScores).values([{ ts: now - 7 * DAY, score: 90 }, { ts: now - 3 * DAY, score: 70 }, { ts: now - H, score: 85 }]).run();
		db.insert(issues).values({ rule: 'battery.low', ieee: LAMP, severity: 'warning', state: 'open', openedAt: T, updatedAt: T, summary: 's', action: '', evidence: {} }).run();
		state.devices.get(DOOR)!.battery = 50;
		state.devices.get(DOOR)!.powerSource = 'Battery';
		db.insert(baselines).values({ ieee: DOOR, metric: 'battery_days_left', value: 12, days: 5, computedAt: now }).run();
		db.insert(samplesHourly).values([{ ieee: HALL, hour: now - 2 * H, lqiAvg: 20, msgCount: 1 }, { ieee: LAMP, hour: now - 2 * H, lqiAvg: 90, msgCount: 1 }]).run();
		db.insert(events).values([
			...[1, 2, 3].map((i) => ({ ts: now - i * H, ieee: HALL, kind: 'device_announce', detail: {} })),
			{ ts: now - H, ieee: LAMP, kind: 'route_error', detail: { kind: 'command_failed' } },
			{ ts: now - H, ieee: DOOR, kind: 'route_error', detail: { kind: 'other' } }
		]).run();
		const m = weeklyDigest(db, state, now);
		const f = Object.fromEntries(m.fields.map((x) => [x.name, x.value]));
		expect(m).toMatchObject({ kind: 'digest', severity: 'info', title: 'Weekly digest', summary: 'How the mesh did this week.' });
		expect(f['Health score']).toBe('85 now, 90 a week ago, lowest 70');
		expect(f['Open issues']).toBe('1 warning');
		expect(f['Batteries to buy']).toContain('about 12 days left');
		expect(f['Weakest links (24 h)'].split('\n')[0]).toContain('LQI 20');
		expect(f['Most rejoins (7 days)']).toContain(': 3');
		expect(f['Route failures (7 days)']).toContain(': 1');
		expect(f['Route failures (7 days)']).not.toContain('\n');
	});

	it('says all good when nothing is noteworthy', () => {
		db.insert(healthScores).values([{ ts: now - 6 * DAY, score: 95 }, { ts: now - H, score: 100 }]).run();
		const m = weeklyDigest(db, state, now);
		expect(m.summary).toBe('All good this week.');
		expect(m.fields).toHaveLength(1);
	});
});

describe('sendWeekly', () => {
	const now = Z('2026-10-25T17:00:00Z');
	const add = (db: Db, kind: string, config: Record<string, unknown>, minSeverity: 'info' | 'critical' = 'critical', enabled = true) =>
		db.insert(channels).values({ kind, name: kind, config, minSeverity, enabled }).returning().get().id;

	it('respects the per-channel checkbox and sends once per week', () => {
		const db = openDb(':memory:');
		const state = ctx().state;
		const d = add(db, 'discord', {}); // missing -> on, ignores minSeverity
		const a = add(db, 'apprise', {}); // missing -> off
		const a2 = add(db, 'apprise', { weeklyDigest: true });
		const off = add(db, 'discord', { weeklyDigest: false });
		const dis = add(db, 'discord', { weeklyDigest: true }, 'info', false);
		sendWeekly(db, state, now, TZ, false);
		sendWeekly(db, state, now + 60_000, TZ, false);
		const rows = db.select().from(outbox).all();
		expect(rows.map((r) => r.dedupeKey).sort()).toEqual([`weekly:2026-W43:${d}`, `weekly:2026-W43:${a2}`].sort());
		expect([a, off, dis]).toHaveLength(3);
		expect(rows[0]).toMatchObject({ kind: 'digest', severity: 'info', status: 'pending' });
	});

	it('waits out quiet hours', () => {
		const db = openDb(':memory:');
		add(db, 'discord', {});
		sendWeekly(db, ctx().state, now, TZ, true);
		expect(db.select().from(outbox).all()).toHaveLength(0);
		sendWeekly(db, ctx().state, now + H, TZ, false);
		expect(db.select().from(outbox).all()).toHaveLength(1);
	});
});
