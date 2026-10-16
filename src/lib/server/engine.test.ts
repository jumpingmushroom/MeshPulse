import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../../tests/helpers/fixtures';
import { loadConfig } from './config';
import { openDb } from './db';
import { channels, devices, issues, outbox } from './db/schema';
import { runOnce } from './engine';
import type { IssueRow, Notify } from './issues/lifecycle';
import { route } from './mqtt/route';
import { applyEffects } from './store';
import { createState } from './types';

const T = 1760000000000;
const HALL = '0x00124b0000000003';

describe('engine', () => {
	it('runOnce persists opens and updates in one transaction', () => {
		const db = openDb(':memory:');
		const state = createState(T);
		Object.assign(state.monitor, { connected: true, connectedAt: T });
		const dirty = new Set<string>();
		// startup.jsonl has hall_plug (a router) offline
		for (const m of loadFixture('startup')) applyEffects(db, route(state, m, 'zigbee2mqtt'), dirty);
		const sent: { issue: IssueRow; n: Notify; inTx: boolean }[] = [];
		const deps = {
			db, state, dirty, config: loadConfig({ SECRET_KEY: 'x' }), counters: { seen: new Map(), missing: new Map() },
			notify: (issue: IssueRow, n: Notify) => sent.push({ issue, n, inTx: db.$client.inTransaction })
		};

		runOnce(deps, T + 60_000);
		expect(db.select().from(issues).all()).toEqual([]);
		expect(db.select().from(devices).all().length).toBeGreaterThan(0); // flushed
		runOnce(deps, T + 120_000);
		const rows = db.select().from(issues).all();
		expect(rows).toMatchObject([{ rule: 'device.offline', ieee: HALL, state: 'open', lastNotifiedAt: T + 120_000 }]);
		expect(sent).toEqual([{ issue: expect.objectContaining({ id: rows[0].id }), n: { key: `device.offline|${HALL}`, kind: 'open', severity: 'warning' }, inTx: true }]);
		expect(state.monitor.lastRulesRunAt).toBe(T + 120_000);

		runOnce(deps, T + 180_000);
		expect(db.select().from(issues).all()).toMatchObject([{ id: rows[0].id, state: 'open', updatedAt: T + 180_000 }]);
	});

	it('enqueues notifications to the outbox by default', () => {
		const db = openDb(':memory:');
		db.insert(channels).values({ kind: 'discord', name: 'd', config: {} }).run();
		const state = createState(T);
		Object.assign(state.monitor, { connected: true, connectedAt: T });
		const dirty = new Set<string>();
		for (const m of loadFixture('startup')) applyEffects(db, route(state, m, 'zigbee2mqtt'), dirty);
		const deps = { db, state, dirty, config: loadConfig({ SECRET_KEY: 'x' }), counters: { seen: new Map(), missing: new Map() } };
		runOnce(deps, T + 60_000);
		runOnce(deps, T + 120_000);
		const name = state.devices.get(HALL)!.friendlyName;
		expect(db.select().from(outbox).all()).toMatchObject([{ kind: 'open', severity: 'warning', status: 'pending',
			message: { fields: expect.arrayContaining([{ name: 'Device', value: name }]) } }]);
	});

	it('folds held messages inside the run transaction when quiet hours end, retrying a failed fold', () => {
		const db = openDb(':memory:');
		const state = createState(T);
		Object.assign(state.monitor, { connected: true, connectedAt: T });
		const folds: boolean[] = [];
		let fail = true;
		const deps = {
			db, state, dirty: new Set<string>(), config: loadConfig({ SECRET_KEY: 'x' }), counters: { seen: new Map(), missing: new Map() },
			foldHeld: () => {
				folds.push(db.$client.inTransaction);
				if (fail) throw new Error('boom');
			}
		};
		const quiet = Date.parse('2026-10-25T05:59:00Z'); // 06:59 CET
		const end = Date.parse('2026-10-25T06:00:00Z'); // 07:00 CET
		state.monitor.lastRulesRunAt = quiet;
		expect(() => runOnce(deps, end)).toThrow('boom');
		expect(state.monitor.lastRulesRunAt).toBe(quiet);
		fail = false;
		runOnce(deps, end);
		expect(folds).toEqual([true, true]);
		expect(state.monitor.lastRulesRunAt).toBe(end);
		runOnce(deps, end + 60_000);
		expect(folds).toHaveLength(2);
	});
});
