import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config';
import { openDb } from '../db/index';
import { scanLinks, scans } from '../db/schema';
import type { Requester } from '../mqtt/request';
import { saveSettings } from '../settings';
import { createState } from '../types';
import { startActive } from './loop';
import { loadActive, requestManualScan, runActive } from './run';
import { lastDay } from './schedule';

const NOW = Date.UTC(2026, 9, 20, 5, 0); // 07:00 Oslo
const config = loadConfig({ TZ: 'Europe/Oslo', SECRET_KEY: 'x'.repeat(32) } as never);

function setup(request: Requester['request'] = async () => ({ missing_routers: [{ ieee_address: '0xa', friendly_name: 'a' }] })) {
	const db = openDb(':memory:');
	const state = createState(NOW - 5 * 3_600_000);
	state.monitor.connected = true;
	state.bridge.state = 'online';
	const req = vi.fn(request);
	const requester: Requester = { request: req, onMessage: () => {}, busy: () => false };
	return { db, state, requester, req, config };
}

describe('runActive', () => {
	it('stores an ok row with the missing routers and sets the day', async () => {
		const d = setup();
		expect(await runActive(d, 'coordinator_check', 'scheduled', NOW)).toEqual({ status: 'ok' });
		expect(d.req).toHaveBeenCalledWith('coordinator_check', {}, 60_000);
		const row = d.db.select().from(scans).get()!;
		expect(row).toMatchObject({ kind: 'coordinator_check', status: 'ok', trigger: 'scheduled', missing: ['0xa'] });
		expect(lastDay(d.db, 'coordinator_check')).toBe('2026-10-20');
	});

	it('stores a failed row with the reason and still sets the day', async () => {
		const d = setup(async () => { throw new Error('No response'); });
		expect(await runActive(d, 'coordinator_check', 'scheduled', NOW)).toEqual({ status: 'failed', reason: 'No response' });
		expect(d.db.select().from(scans).get()).toMatchObject({ status: 'failed', reason: 'No response' });
		expect(lastDay(d.db, 'coordinator_check')).toBe('2026-10-20');
	});

	it('skips on a guard reason without sending, keeps the day open, and keeps one row per day', async () => {
		const d = setup();
		d.state.monitor.connected = false;
		expect((await runActive(d, 'coordinator_check', 'scheduled', NOW)).status).toBe('skipped');
		await runActive(d, 'coordinator_check', 'scheduled', NOW + 60_000);
		expect(d.req).not.toHaveBeenCalled();
		const rows = d.db.select().from(scans).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ status: 'skipped', reason: 'MQTT is disconnected', startedAt: NOW + 60_000 });
		expect(lastDay(d.db, 'coordinator_check')).toBe('');
	});
});

describe('startActive', () => {
	it('never requests while the feature is off, and runs once when on and due', async () => {
		vi.useFakeTimers({ now: NOW });
		const d = setup();
		const loop = startActive(d);
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		expect(d.req).not.toHaveBeenCalled();
		saveSettings(d.db, { activeCoordinatorCheck: true });
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		expect(d.req).toHaveBeenCalledTimes(1);
		loop.stop();
		vi.useRealTimers();
	});
});

describe('loadActive', () => {
	it('keeps the latest ok check through a newer failed one', async () => {
		const d = setup();
		await runActive(d, 'coordinator_check', 'scheduled', NOW);
		d.req.mockRejectedValueOnce(new Error('x'));
		await runActive(d, 'coordinator_check', 'manual', NOW + 1000);
		saveSettings(d.db, { activeCoordinatorCheck: true });
		expect(loadActive(d.db).missingRouters).toEqual(['0xa']);
		expect(loadActive(openDb(':memory:')).missingRouters).toBeNull();
	});

	it('returns null when the check is off, so open issues resolve', async () => {
		const d = setup();
		await runActive(d, 'coordinator_check', 'scheduled', NOW);
		expect(loadActive(d.db).missingRouters).toBeNull();
	});

	it('does not run again once the day is set', async () => {
		vi.useFakeTimers({ now: NOW });
		const d = setup();
		saveSettings(d.db, { activeCoordinatorCheck: true });
		const loop = startActive(d);
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		expect(d.req).toHaveBeenCalledTimes(1);
		loop.stop();
		vi.useRealTimers();
	});

	it('does nothing on a tick while a request is still running', async () => {
		vi.useFakeTimers({ now: NOW });
		const d = setup(() => new Promise(() => {}));
		saveSettings(d.db, { activeCoordinatorCheck: true });
		const loop = startActive(d);
		await vi.advanceTimersByTimeAsync(3 * 60_000);
		expect(d.req).toHaveBeenCalledTimes(1);
		expect(d.db.select().from(scans).all()).toMatchObject([{ status: 'running', trigger: 'scheduled', finishedAt: null }]);
		loop.stop();
		vi.useRealTimers();
	});
});

const MAP = (failed: string[] = []) => ({
	value: {
		nodes: [{ ieeeAddr: '0xc', type: 'Coordinator' }, { ieeeAddr: '0xa', type: 'Router', failed }, { ieeeAddr: '0xb', type: 'EndDevice' }],
		links: [{ source: { ieeeAddr: '0xb' }, target: { ieeeAddr: '0xa' }, linkquality: 90, depth: 1, relationship: 1 }, { source: { ieeeAddr: '0xa' }, target: { ieeeAddr: '0xc' }, lqi: 120, depth: 0, relationship: 2 }]
	}
});

describe('runActive networkmap', () => {
	it('stores counts, silent routers and links, and sets the day', async () => {
		const d = setup(async () => MAP(['lqi']));
		expect(await runActive(d, 'networkmap', 'scheduled', NOW)).toEqual({ status: 'ok' });
		expect(d.req).toHaveBeenCalledWith('networkmap', { type: 'raw', routes: false }, 600_000);
		const row = d.db.select().from(scans).get()!;
		expect(row).toMatchObject({ kind: 'networkmap', status: 'ok', nodes: 3, links: 2, missing: ['0xa'] });
		expect(d.db.select().from(scanLinks).all()).toEqual([
			{ scanId: row.id, sourceIeee: '0xb', targetIeee: '0xa', lqi: 90, depth: 1, relationship: 1 },
			{ scanId: row.id, sourceIeee: '0xa', targetIeee: '0xc', lqi: 120, depth: 0, relationship: 2 }
		]);
		expect(lastDay(d.db, 'networkmap')).toBe('2026-10-20');
	});

	it('records failed on a bad response and stores no links', async () => {
		const d = setup(async () => ({ nope: 1 }));
		expect((await runActive(d, 'networkmap', 'scheduled', NOW)).status).toBe('failed');
		expect(d.db.select().from(scanLinks).all()).toEqual([]);
	});

	it('a drop mid-scan records failed, leaves nothing busy, and the next day runs', async () => {
		vi.useFakeTimers({ now: NOW });
		let pending = false;
		const d = setup(() => { pending = true; return new Promise((_, rej) => setTimeout(() => { pending = false; rej(new Error('MQTT is disconnected')); }, 1000)); });
		d.requester.busy = () => pending;
		saveSettings(d.db, { activeNetworkScan: true });
		const p = runActive(d, 'networkmap', 'scheduled', NOW);
		expect(d.requester.busy('networkmap')).toBe(true);
		await vi.advanceTimersByTimeAsync(1000);
		expect(await p).toEqual({ status: 'failed', reason: 'MQTT is disconnected' });
		expect(d.requester.busy('networkmap')).toBe(false);
		expect(d.db.select().from(scans).get()).toMatchObject({ status: 'failed', reason: 'MQTT is disconnected' });
		d.req.mockResolvedValueOnce(MAP());
		const next = NOW + 24 * 3_600_000;
		expect((await runActive(d, 'networkmap', 'scheduled', next)).status).toBe('ok');
		vi.useRealTimers();
	});

	it('the loop scans at 04:00 only when the scan is on', async () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 9, 20, 1, 55) }); // 03:55 Oslo
		const d = setup(async () => MAP());
		d.state.monitor.startedAt = Date.now() - 5 * 3_600_000;
		const loop = startActive(d);
		await vi.advanceTimersByTimeAsync(10 * 60_000);
		expect(d.req).not.toHaveBeenCalled();
		saveSettings(d.db, { activeNetworkScan: true });
		await vi.advanceTimersByTimeAsync(60_000);
		expect(d.req).toHaveBeenCalledTimes(1);
		expect(d.req.mock.calls[0][0]).toBe('networkmap');
		loop.stop();
		vi.useRealTimers();
	});
});

describe('requestManualScan', () => {
	const on = (d: ReturnType<typeof setup>) => saveSettings(d.db, { activeNetworkScan: true });

	it('refuses with the guard reason and sends nothing', async () => {
		const d = setup(async () => MAP());
		on(d);
		d.state.monitor.connected = false;
		expect(await requestManualScan(d, NOW)).toEqual({ ok: false, reason: 'MQTT is disconnected' });
		expect(d.req).not.toHaveBeenCalled();
		expect(d.db.select().from(scans).all()).toEqual([]);
	});

	it('refuses while the scan is off', async () => {
		const d = setup(async () => MAP());
		expect((await requestManualScan(d, NOW)).ok).toBe(false);
		expect(d.req).not.toHaveBeenCalled();
	});

	it('refuses while a request runs', async () => {
		const d = setup(async () => MAP());
		on(d);
		d.requester.busy = () => true;
		expect(await requestManualScan(d, NOW)).toEqual({ ok: false, reason: 'A request is already running' });
	});

	it('starts without awaiting, then limits to one per 60 min', async () => {
		let release: (v: unknown) => void = () => {};
		const d = setup(() => new Promise((r) => { release = r; }));
		on(d);
		expect(await requestManualScan(d, NOW)).toEqual({ ok: true });
		expect(d.req).toHaveBeenCalledTimes(1);
		release(MAP());
		await vi.waitFor(() => expect(d.db.select().from(scans).all()).toHaveLength(1));
		expect(d.db.select().from(scans).get()).toMatchObject({ trigger: 'manual', status: 'ok' });
		expect(lastDay(d.db, 'networkmap')).toBe('');
		const r = await requestManualScan(d, NOW + 59 * 60_000);
		expect(r).toEqual({ ok: false, reason: 'A scan ran less than an hour ago' });
		d.req.mockResolvedValueOnce(MAP());
		expect(await requestManualScan(d, NOW + 61 * 60_000)).toEqual({ ok: true });
		expect(d.req).toHaveBeenCalledTimes(2);
	});
});

describe('loadActive scanFailStreak', () => {
	const fail = (d: ReturnType<typeof setup>, trigger: 'scheduled' | 'manual', at: number, status: 'ok' | 'failed' | 'skipped' | 'running' = 'failed') =>
		d.db.insert(scans).values({ kind: 'networkmap', trigger, startedAt: at, finishedAt: at, status }).run();

	it('is 0 while the scan is off, and ignores a running row', () => {
		const d = setup();
		fail(d, 'scheduled', 1); fail(d, 'scheduled', 2); fail(d, 'scheduled', 3);
		expect(loadActive(d.db).scanFailStreak).toBe(0);
		saveSettings(d.db, { activeNetworkScan: true });
		fail(d, 'scheduled', 4, 'running');
		expect(loadActive(d.db).scanFailStreak).toBe(3);
	});

	it('counts scheduled failures since the last ok, ignoring manual failures and skips', () => {
		const d = setup();
		saveSettings(d.db, { activeNetworkScan: true });
		fail(d, 'scheduled', 1, 'ok');
		fail(d, 'scheduled', 2); fail(d, 'scheduled', 3); fail(d, 'manual', 4); fail(d, 'scheduled', 5, 'skipped'); fail(d, 'scheduled', 6);
		expect(loadActive(d.db).scanFailStreak).toBe(3);
		fail(d, 'manual', 7, 'ok');
		expect(loadActive(d.db).scanFailStreak).toBe(0);
	});
});

describe('run records', () => {
	it('inserts a running row at start, sets the day, and closes the row at the end', async () => {
		let release: (v: unknown) => void = () => {};
		const d = setup(() => new Promise((r) => { release = r; }));
		const p = runActive(d, 'networkmap', 'scheduled', NOW);
		expect(d.db.select().from(scans).all()).toMatchObject([{ status: 'running', startedAt: NOW, finishedAt: null }]);
		expect(lastDay(d.db, 'networkmap')).toBe('2026-10-20');
		release(MAP());
		await p;
		const rows = d.db.select().from(scans).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ status: 'ok', nodes: 3, links: 2 });
		expect(rows[0].finishedAt).not.toBeNull();
		expect(d.db.select().from(scanLinks).all()).toHaveLength(2);
	});

	it('a restart mid-run leaves a failed row and the scheduled scan does not run again that day', async () => {
		vi.useFakeTimers({ now: NOW });
		const d = setup(() => new Promise(() => {}));
		saveSettings(d.db, { activeNetworkScan: true });
		void runActive(d, 'networkmap', 'scheduled', NOW); // the process dies here
		const after = setup(async () => MAP());
		const restarted = { ...after, db: d.db };
		const loop = startActive(restarted);
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		expect(restarted.req).not.toHaveBeenCalled();
		expect(d.db.select().from(scans).all()).toMatchObject([{ status: 'failed', reason: 'MeshPulse restarted during the run' }]);
		expect(d.db.select().from(scans).get()!.finishedAt).not.toBeNull();
		loop.stop();
		vi.useRealTimers();
	});

	it('the manual limit counts a running row', async () => {
		const d = setup(async () => MAP());
		saveSettings(d.db, { activeNetworkScan: true });
		d.db.insert(scans).values({ kind: 'networkmap', trigger: 'scheduled', startedAt: NOW - 10 * 60_000, status: 'running' }).run();
		expect(await requestManualScan(d, NOW)).toEqual({ ok: false, reason: 'A scan ran less than an hour ago' });
		expect(d.req).not.toHaveBeenCalled();
	});

	it('a scheduled scan is skipped, day left open, when a scan started less than an hour ago', async () => {
		const d = setup(async () => MAP());
		d.db.insert(scans).values({ kind: 'networkmap', trigger: 'manual', startedAt: NOW - 30 * 60_000, finishedAt: NOW - 25 * 60_000, status: 'ok' }).run();
		expect(await runActive(d, 'networkmap', 'scheduled', NOW)).toEqual({ status: 'skipped', reason: 'A scan ran less than an hour ago' });
		expect(d.req).not.toHaveBeenCalled();
		expect(lastDay(d.db, 'networkmap')).toBe('');
		expect((await runActive(d, 'networkmap', 'scheduled', NOW + 31 * 60_000)).status).toBe('ok');
	});
});
