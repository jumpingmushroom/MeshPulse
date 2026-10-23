import { describe, expect, it } from 'vitest';
import { openDb } from '../db/index';
import { baselines, devices, events, healthScores, samples, samplesHourly } from '../db/schema';
import { createState } from '../types';
import { computeBaselines, hourStart, networkMsgPerMin, recordScore, rollupHours } from './rollup';

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

	it('keeps msg_count when rerun without a counter, and adds split counters', () => {
		const { db, state } = setup();
		db.insert(samples).values({ ieee: IEEE, ts: at(10, 5), lqi: 70 }).run();
		state.msgCounts.set(`${IEEE}|${at(10)}`, 3);
		rollupHours(db, state, T);
		rollupHours(db, state, T);
		expect(db.select().from(samplesHourly).all()[0].msgCount).toBe(3);
		state.msgCounts.set(`${IEEE}|${at(10)}`, 4);
		rollupHours(db, state, T);
		expect(db.select().from(samplesHourly).all()[0].msgCount).toBe(7);
	});

	it('drops counters older than the window', () => {
		const { db, state } = setup();
		state.msgCounts.set(`${IEEE}|${T - 60 * H}`, 3);
		rollupHours(db, state, T);
		expect(state.msgCounts.size).toBe(0);
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
		// 168 hours of data in the 7-day window
		expect(get(db, IEEE, 'lqi_mean')).toMatchObject({ value: 100, days: 7, computedAt: T });
		expect(get(db, IEEE, 'lqi_stddev')!.days).toBe(7);
		expect(get(db, IEEE, 'lqi_stddev')!.value).toBe(0);
	});

	it('lqi baseline days are whole days of hours with LQI data', () => {
		const { db } = setup();
		// 38 h spanning 3 calendar days, plus hours with only a message count
		const rows = Array.from({ length: 38 }, (_, i) => ({ ieee: IEEE, hour: hourStart(T - 3 * D) + i * H, lqiAvg: 90, msgCount: 1 }));
		rows.push(...Array.from({ length: 20 }, (_, i) => ({ ieee: IEEE, hour: hourStart(T - 6 * D) + i * H, lqiAvg: null as unknown as number, msgCount: 1 })));
		db.insert(samplesHourly).values(rows).run();
		computeBaselines(db, T);
		expect(get(db, IEEE, 'lqi_mean')!.days).toBe(1);
		expect(get(db, IEEE, 'lqi_stddev')!.days).toBe(1);
	});

	it('route_errors_hourly days are whole days of hours with any hourly row, not events', () => {
		const { db } = setup();
		const start = hourStart(T - 7 * D);
		// two devices overlap: hours 0-39 and 20-59, 60 distinct hours
		db.insert(samplesHourly).values([
			...Array.from({ length: 40 }, (_, i) => ({ ieee: '0xa', hour: start + i * H, msgCount: 1 })),
			...Array.from({ length: 40 }, (_, i) => ({ ieee: '0xb', hour: start + (i + 20) * H, msgCount: 1 }))
		]).run();
		db.insert(events).values(Array.from({ length: 100 }, (_, i) => ({ ts: T - 8 * D + i * H, kind: 'route_error' }))).run();
		computeBaselines(db, T);
		expect(get(db, '', 'route_errors_hourly')!.days).toBe(2);
	});

	it('msg_per_min is the mean hourly msgCount / 60 per device, network the sum of device means', () => {
		const { db } = setup();
		const start = hourStart(T - 7 * D);
		// 0xa: 72 h alternating 60/180 msgs (mean 120 -> 2/min, 3 days); 0xb: 30 h of 30 msgs (0.5/min, 1 day)
		db.insert(samplesHourly).values([
			...Array.from({ length: 72 }, (_, i) => ({ ieee: '0xa', hour: start + i * H, msgCount: i % 2 ? 180 : 60 })),
			...Array.from({ length: 30 }, (_, i) => ({ ieee: '0xb', hour: start + i * H, msgCount: 30 })),
			...Array.from({ length: 30 }, (_, i) => ({ ieee: '0xb', hour: start + (40 + i) * H, msgCount: 0 })), // lost counters: ignored
			{ ieee: '0xa', hour: T - D, msgCount: 10_000 } // last 24 h: not in the baseline
		]).run();
		computeBaselines(db, T);
		expect(get(db, '0xa', 'msg_per_min')).toMatchObject({ value: 2, days: 3 });
		expect(get(db, '0xb', 'msg_per_min')).toMatchObject({ value: 0.5, days: 1 });
		expect(get(db, '', 'msg_per_min')).toMatchObject({ value: 2.5, days: 3 });
	});

	it('route_errors_hourly days are 0 with only events', () => {
		const { db } = setup();
		db.insert(events).values(Array.from({ length: 100 }, (_, i) => ({ ts: T - 8 * D + i * H, kind: 'route_error' }))).run();
		computeBaselines(db, T);
		expect(get(db, '', 'route_errors_hourly')!.days).toBe(0);
	});

	it('network route_errors_hourly is the mean per hour with data, not per hour of the window', () => {
		const { db } = setup();
		// 3 days of history in the 7-day window, 2 errors an hour
		const start = hourStart(T - 4 * D);
		db.insert(samplesHourly).values(Array.from({ length: 72 }, (_, i) => ({ ieee: IEEE, hour: start + i * H, msgCount: 1 }))).run();
		db.insert(events).values(Array.from({ length: 144 }, (_, i) => ({ ts: start + (i * H) / 2, kind: 'route_error' }))).run();
		computeBaselines(db, T);
		expect(get(db, '', 'route_errors_hourly')).toMatchObject({ value: 2, days: 3 });
	});

	it('route_errors_hourly is 0 with no events', () => {
		const { db } = setup();
		computeBaselines(db, T);
		expect(get(db, '', 'route_errors_hourly')!.value).toBe(0);
	});

	describe('battery_days_left', () => {
		const battery = (db: ReturnType<typeof openDb>, from: number, days: number, start: number, perDay: number) => {
			const rows = [];
			for (let i = 0; i < days * 24; i++) rows.push({ ieee: IEEE, hour: from + i * H, batteryMin: start - (perDay * i) / 24, msgCount: 1 });
			db.insert(samplesHourly).values(rows).run();
		};
		const addDevice = (db: ReturnType<typeof openDb>, powerSource = 'Battery') =>
			db.insert(devices).values({ ieee: IEEE, powerSource }).run();

		it('fits the last 30 days and stores the span', () => {
			const { db } = setup();
			addDevice(db);
			battery(db, T - 10 * D, 10, 80, 1); // 80 -> 71 over ~10 days
			computeBaselines(db, T);
			const b = get(db, IEEE, 'battery_days_left')!;
			expect(b.days).toBe(9);
			expect(b.value).toBeCloseTo(60, 0);
		});

		it('swap resets the fit', () => {
			const { db } = setup();
			addDevice(db);
			battery(db, T - 23 * D, 20, 80, 3); // 80 -> 20
			db.insert(events).values({ ts: T - 3 * D, ieee: IEEE, kind: 'battery_swap', detail: {} }).run();
			battery(db, T - 3 * D + H, 3, 100, 0);
			computeBaselines(db, T);
			expect(get(db, IEEE, 'battery_days_left')).toBeUndefined();
		});

		it('stores the median battery report gap and the last report over 30 days', () => {
			const { db } = setup();
			addDevice(db);
			db.insert(samplesHourly).values([0, 2, 4, 10, 40 * 24].map((ago) => ({ ieee: IEEE, hour: T - 9 * D - ago * H, batteryMin: 50, msgCount: 1 }))).run();
			computeBaselines(db, T);
			expect(get(db, IEEE, 'battery_report_gap_h')).toMatchObject({ value: 2 }); // gaps 6, 2, 2 (the 40-day-old row is outside)
			expect(get(db, IEEE, 'battery_last_report')).toMatchObject({ value: T - 9 * D });
		});

		it('battery_drop is the peak since the last swap minus the latest reading', () => {
			const { db } = setup();
			addDevice(db);
			battery(db, T - 10 * D, 5, 90, 2); // old battery, before the swap
			db.insert(events).values({ ts: T - 5 * D, ieee: IEEE, kind: 'battery_swap', detail: {} }).run();
			battery(db, T - 5 * D + H, 4, 38, 0); // flat NiMH
			battery(db, T - D + H, 1, 30, 10); // the cliff: 30 -> ~20.4
			computeBaselines(db, T);
			expect(get(db, IEEE, 'battery_drop')!.value).toBeCloseTo(38 - (30 - (10 * 23) / 24), 5);
		});

		it('no battery_days_left for a rechargeable device, but battery_drop still', () => {
			const { db } = setup();
			db.insert(devices).values({ ieee: IEEE, powerSource: 'Battery', tags: { rechargeable: true } }).run();
			battery(db, T - 10 * D, 10, 80, 1);
			computeBaselines(db, T);
			expect(get(db, IEEE, 'battery_days_left')).toBeUndefined();
			expect(get(db, IEEE, 'battery_drop')).toBeDefined();
		});

		it('max_gap_7d is the longest gap between stored readings in 7 days', () => {
			const { db } = setup();
			addDevice(db);
			db.insert(samples).values([0, 30, 60, 645, 660].map((m) => ({ ieee: IEEE, ts: T - 2 * D + m * 60_000, lqi: 100 }))).run(); // 585 min quiet spell
			db.insert(samples).values({ ieee: IEEE, ts: T - 9 * D, lqi: 100 }).run(); // older than 7 days: ignored
			computeBaselines(db, T);
			expect(get(db, IEEE, 'max_gap_7d')).toMatchObject({ value: 585 * 60_000 });
		});

		it('forecasts a device with no power source from its battery reports', () => {
			const { db } = setup();
			db.insert(devices).values({ ieee: IEEE }).run();
			battery(db, T - 10 * D, 10, 80, 1);
			computeBaselines(db, T);
			expect(get(db, IEEE, 'battery_days_left')).toBeDefined();
		});

		it('deletes a stale row and ignores mains devices', () => {
			const { db } = setup();
			addDevice(db);
			battery(db, T - 10 * D, 10, 80, 1);
			computeBaselines(db, T);
			db.update(devices).set({ powerSource: 'Mains' }).run();
			computeBaselines(db, T);
			expect(get(db, IEEE, 'battery_days_left')).toBeUndefined();
			expect(get(db, IEEE, 'battery_drop')).toBeUndefined();
		});
	});
});

it('hourStart floors to the UTC hour', () => {
	expect(hourStart(at(10, 59))).toBe(at(10));
});

describe('recordScore', () => {
	it('writes one network score row per hour', () => {
		const { db } = setup();
		const open = [{ severity: 'warning' as const, parentIssueId: null }];
		recordScore(db, open, T + 5 * 60_000);
		recordScore(db, [], T + 30 * 60_000);
		expect(db.select().from(healthScores).all()).toEqual([{ ts: T, score: 92 }]);
		recordScore(db, [], T + H);
		expect(db.select().from(healthScores).all()).toHaveLength(2);
	});
});

describe('networkMsgPerMin', () => {
	it('sums hourly counts across devices, divided by 60, for the last 24 h', () => {
		const { db } = setup();
		db.insert(samplesHourly).values([
			{ ieee: '0x1', hour: at(10), msgCount: 60 }, { ieee: '0x2', hour: at(10), msgCount: 120 },
			{ ieee: '0x1', hour: T - 25 * H, msgCount: 999 }
		]).run();
		expect(networkMsgPerMin(db, T)).toEqual([{ t: at(10), v: 3 }]);
	});
});
