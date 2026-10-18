import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../../tests/helpers/fixtures';
import { loadConfig } from './config';
import { openDb } from './db';
import { channels, devices, issues, outbox, samplesHourly } from './db/schema';
import { runOnce } from './engine';
import { saveSettings } from './settings';
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

	it('ignoring a device resolves its issues without a notification', () => {
		const db = openDb(':memory:');
		const state = createState(T);
		Object.assign(state.monitor, { connected: true, connectedAt: T });
		const dirty = new Set<string>();
		for (const m of loadFixture('startup')) applyEffects(db, route(state, m, 'zigbee2mqtt'), dirty);
		const sent: Notify[] = [];
		const deps = { db, state, dirty, config: loadConfig({ SECRET_KEY: 'x' }), counters: { seen: new Map(), missing: new Map() },
			notify: (_: IssueRow, n: Notify) => sent.push(n) };
		runOnce(deps, T + 60_000);
		runOnce(deps, T + 120_000);
		expect(sent.map((n) => n.kind)).toEqual(['open']);
		state.devices.get(HALL)!.tags = ['ignore'];
		for (let k = 3; k < 10; k++) runOnce(deps, T + k * 60_000);
		expect(db.select().from(issues).all()).toMatchObject([{ ieee: HALL, state: 'resolved' }]);
		expect(sent.map((n) => n.kind)).toEqual(['open']);
	});

	it('feeds hourly history to the rules', () => {
		const db = openDb(':memory:');
		const state = createState(T);
		Object.assign(state.monitor, { connected: true, connectedAt: T });
		const dirty = new Set<string>();
		for (const m of loadFixture('startup')) applyEffects(db, route(state, m, 'zigbee2mqtt'), dirty);
		const DOOR = '0x00124b0000000004';
		const now = T + 60_000;
		const hour = now - (now % 3_600_000);
		db.insert(samplesHourly).values(Array.from({ length: 6 }, (_, i) => ({ ieee: DOOR, hour: hour - (i + 1) * 3_600_000, lqiAvg: 20, msgCount: 1 }))).run();
		const deps = { db, state, dirty, config: loadConfig({ SECRET_KEY: 'x' }), counters: { seen: new Map(), missing: new Map() }, notify: () => {} };
		runOnce(deps, now);
		runOnce(deps, now + 60_000);
		expect(db.select().from(issues).all().map((i) => `${i.rule}|${i.ieee}`)).toContain(`lqi.weak|${DOOR}`);
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

	const heldSetup = () => {
		const db = openDb(':memory:');
		db.insert(channels).values({ kind: 'discord', name: 'd', config: {} }).run();
		db.insert(outbox).values({ channelId: 1, issueId: null, kind: 'open', severity: 'warning', message: {}, dedupeKey: 'h1',
			status: 'held', createdAt: T }).run();
		const state = createState(T);
		Object.assign(state.monitor, { connected: true, connectedAt: T });
		const deps = { db, state, dirty: new Set<string>(), config: loadConfig({ SECRET_KEY: 'x' }), counters: { seen: new Map(), missing: new Map() } };
		const digests = () => db.select().from(outbox).all().filter((r) => r.kind === 'digest').length;
		const held = () => db.select().from(outbox).all().filter((r) => r.status === 'held').length;
		return { db, deps, digests, held };
	};
	const quiet = Date.parse('2026-10-25T05:59:00Z'); // 06:59 CET
	const end = Date.parse('2026-10-25T06:00:00Z'); // 07:00 CET

	it('folds held messages once when quiet hours end', () => {
		const { deps, digests, held } = heldSetup();
		runOnce(deps, quiet);
		expect([held(), digests()]).toEqual([1, 0]);
		runOnce(deps, end);
		expect([held(), digests()]).toEqual([0, 1]);
		runOnce(deps, end + 60_000);
		expect(digests()).toBe(1);
	});

	it('folds held messages on the next run when quiet hours are disabled at night', () => {
		const { db, deps, digests, held } = heldSetup();
		saveSettings(db, { quietEnabled: false });
		runOnce(deps, quiet);
		expect([held(), digests()]).toEqual([0, 1]);
	});

	it('folds inside the run transaction and retries a failed fold', () => {
		const { deps } = heldSetup();
		const folds: boolean[] = [];
		let fail = true;
		const d = { ...deps, foldHeld: () => {
			folds.push(deps.db.$client.inTransaction);
			if (fail) throw new Error('boom');
		} };
		expect(() => runOnce(d, end)).toThrow('boom');
		expect(deps.state.monitor.lastRulesRunAt).toBeNull();
		fail = false;
		runOnce(d, end);
		expect(folds).toEqual([true, true]);
		expect(deps.state.monitor.lastRulesRunAt).toBe(end);
	});
});
