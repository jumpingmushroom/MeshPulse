import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config';
import { openDb } from '../db/index';
import { scans } from '../db/schema';
import type { Requester } from '../mqtt/request';
import { saveSettings } from '../settings';
import { createState } from '../types';
import { startActive } from './loop';
import { loadActive, runActive } from './run';
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
		expect(d.db.select().from(scans).all()).toEqual([]);
		loop.stop();
		vi.useRealTimers();
	});
});
