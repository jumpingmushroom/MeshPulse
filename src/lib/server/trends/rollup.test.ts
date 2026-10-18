import { describe, expect, it } from 'vitest';
import { openDb } from '../db/index';
import { baselines, events, samples, samplesHourly } from '../db/schema';
import { createState } from '../types';
import { computeBaselines, hourStart, rollupHours } from './rollup';

const H = 3_600_000;
const D = 24 * H;
const T = Date.UTC(2026, 9, 18, 12, 0); // 2026-10-18T12:00Z
const IEEE = '0x1';
const at = (h: number, m = 0) => Date.UTC(2026, 9, 18, h, m);

function setup() {
	const db = openDb(':memory:');
	const state = createState(T);
	return { db, state };
}

describe('rollupHours', () => {
	it('rolls up a complete hour', () => {
		const { db, state } = setup();
		db.insert(samples).values([
			{ ieee: IEEE, ts: at(10, 5), lqi: 100, battery: 60, voltage: 3 },
			{ ieee: IEEE, ts: at(10, 20), lqi: 80, battery: 59, voltage: 2.9 },
			{ ieee: IEEE, ts: at(10, 50), lqi: 90, battery: 58, voltage: 2.8 }
		]).run();
		state.msgCounts.set(`${IEEE}|${at(10)}`, 7);
		rollupHours(db, state, T);
		expect(db.select().from(samplesHourly).all()).toEqual([
			{ ieee: IEEE, hour: at(10), lqiMin: 80, lqiAvg: 90, lqiMax: 100, batteryMin: 58, voltageMin: 2.8, msgCount: 7 }
		]);
		expect(state.msgCounts.size).toBe(0);
	});

	it('writes a row for a device with only a message count', () => {
		const { db, state } = setup();
		state.msgCounts.set(`${IEEE}|${at(9)}`, 3);
		rollupHours(db, state, T);
		expect(db.select().from(samplesHourly).all()[0]).toMatchObject({ lqiAvg: null, batteryMin: null, msgCount: 3 });
	});

	it('never rolls up the current hour', () => {
		const { db, state } = setup();
		db.insert(samples).values({ ieee: IEEE, ts: at(12, 5), lqi: 50 }).run();
		state.msgCounts.set(`${IEEE}|${at(12)}`, 2);
		rollupHours(db, state, T + 30 * 60_000);
		expect(db.select().from(samplesHourly).all()).toEqual([]);
		expect(state.msgCounts.size).toBe(1);
	});

	it('rerun is idempotent', () => {
		const { db, state } = setup();
		db.insert(samples).values({ ieee: IEEE, ts: at(10, 5), lqi: 70 }).run();
		rollupHours(db, state, T);
		rollupHours(db, state, T);
		expect(db.select().from(samplesHourly).all()).toHaveLength(1);
	});

	it('catch-up is bounded to 48 h', () => {
		const { db, state } = setup();
		db.insert(samples).values({ ieee: IEEE, ts: T - 50 * H, lqi: 70 }).run();
		rollupHours(db, state, T);
		expect(db.select().from(samplesHourly).all()).toEqual([]);
	});
});

describe('computeBaselines', () => {
	const get = (db: ReturnType<typeof openDb>, ieee: string, metric: string) =>
		db.select().from(baselines).all().find((b) => b.ieee === ieee && b.metric === metric);

	it('baseline excludes the last 24 h', () => {
		const { db } = setup();
		const rows = [];
		for (let t = T - 8 * D; t < T; t += H) {
			rows.push({ ieee: IEEE, hour: t, lqiAvg: t < T - D ? 100 : 10, msgCount: 1 });
		}
		db.insert(samplesHourly).values(rows).run();
		computeBaselines(db, T);
		expect(get(db, IEEE, 'lqi_mean')).toMatchObject({ value: 100, days: 8, computedAt: T });
		expect(get(db, IEEE, 'lqi_stddev')!.value).toBe(0);
	});

	it('network route_errors_hourly is the mean per hour', () => {
		const { db } = setup();
		const ev = Array.from({ length: 48 }, (_, i) => ({ ts: T - 8 * D + i * H, kind: 'route_error' }));
		db.insert(events).values(ev).run();
		computeBaselines(db, T);
		expect(get(db, '', 'route_errors_hourly')!.value).toBeCloseTo(48 / 168);
	});

	it('route_errors_hourly is 0 with no events', () => {
		const { db } = setup();
		computeBaselines(db, T);
		expect(get(db, '', 'route_errors_hourly')!.value).toBe(0);
	});
});

it('hourStart floors to the UTC hour', () => {
	expect(hourStart(at(10, 59))).toBe(at(10));
});
