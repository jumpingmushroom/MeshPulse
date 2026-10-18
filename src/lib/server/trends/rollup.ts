import { and, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/index';
import { baselines, events, samples, samplesHourly } from '../db/schema';
import type { AppState } from '../types';

const H = 3_600_000;
const D = 24 * H;

export const hourStart = (ts: number) => ts - (ts % H);

/** Rolls complete hours in [hourStart(now) - 48 h, hourStart(now)) into samples_hourly; idempotent. */
export function rollupHours(db: Db, state: AppState, now: number): void {
	const to = hourStart(now);
	const from = to - 48 * H;
	const rows = new Map<string, typeof samplesHourly.$inferInsert>();
	const row = (ieee: string, hour: number) => {
		const k = `${ieee}|${hour}`;
		if (!rows.has(k)) rows.set(k, { ieee, hour, msgCount: 0 });
		return rows.get(k)!;
	};
	const hourExpr = sql<number>`${samples.ts} - (${samples.ts} % ${H})`;
	const agg = db.select({
		ieee: samples.ieee, hour: hourExpr,
		lqiMin: sql<number | null>`min(${samples.lqi})`, lqiAvg: sql<number | null>`avg(${samples.lqi})`,
		lqiMax: sql<number | null>`max(${samples.lqi})`, batteryMin: sql<number | null>`min(${samples.battery})`,
		voltageMin: sql<number | null>`min(${samples.voltage})`
	}).from(samples).where(and(gte(samples.ts, from), lt(samples.ts, to))).groupBy(samples.ieee, hourExpr).all();
	for (const { ieee, hour, ...a } of agg) Object.assign(row(ieee, hour), a);

	const drained: string[] = [];
	for (const [k, n] of state.msgCounts) {
		const [ieee, h] = [k.slice(0, k.lastIndexOf('|')), Number(k.slice(k.lastIndexOf('|') + 1))];
		if (h < from || h >= to) continue;
		row(ieee, h).msgCount = n;
		drained.push(k);
	}
	db.transaction((tx) => {
		for (const r of rows.values()) {
			const { ieee: _i, hour: _h, ...set } = r;
			tx.insert(samplesHourly).values(r).onConflictDoUpdate({ target: [samplesHourly.ieee, samplesHourly.hour], set }).run();
		}
	});
	for (const k of drained) state.msgCounts.delete(k);
}

/** Per-device LQI baseline and the network route-error rate over [now - 8 d, now - 24 h). */
export function computeBaselines(db: Db, now: number): void {
	const from = now - 8 * D;
	const to = now - D;
	const day = (ts: number) => Math.floor(ts / D);
	const hourly = db.select().from(samplesHourly).where(and(gte(samplesHourly.hour, from), lt(samplesHourly.hour, to))).all();
	const evs = db.select({ ts: events.ts, kind: events.kind }).from(events).where(and(gte(events.ts, from), lt(events.ts, to))).all();

	const out: (typeof baselines.$inferInsert)[] = [];
	const by = new Map<string, { avgs: number[]; days: Set<number> }>();
	for (const r of hourly) {
		const g = by.get(r.ieee) ?? { avgs: [], days: new Set() };
		g.days.add(day(r.hour));
		if (r.lqiAvg !== null) g.avgs.push(r.lqiAvg);
		by.set(r.ieee, g);
	}
	for (const [ieee, { avgs, days }] of by) {
		if (!avgs.length) continue;
		const mean = avgs.reduce((a, b) => a + b, 0) / avgs.length;
		const sd = Math.sqrt(avgs.reduce((a, b) => a + (b - mean) ** 2, 0) / avgs.length);
		out.push({ ieee, metric: 'lqi_mean', value: mean, days: days.size, computedAt: now },
			{ ieee, metric: 'lqi_stddev', value: sd, days: days.size, computedAt: now });
	}
	const netDays = new Set([...hourly.map((r) => day(r.hour)), ...evs.map((e) => day(e.ts))]);
	const errors = evs.filter((e) => e.kind === 'route_error').length;
	out.push({ ieee: '', metric: 'route_errors_hourly', value: errors / ((to - from) / H), days: netDays.size, computedAt: now });

	db.transaction((tx) => {
		for (const b of out) {
			tx.insert(baselines).values(b).onConflictDoUpdate({ target: [baselines.ieee, baselines.metric], set: { value: b.value, days: b.days, computedAt: b.computedAt } }).run();
		}
	});
}
