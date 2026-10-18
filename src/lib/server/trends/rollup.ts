import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/index';
import { forecastDaysLeft } from './forecast';
import { baselines, devices, events, samples, samplesHourly } from '../db/schema';
import { getSettings } from '../settings';
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
	const counted = new Set<string>();
	for (const [k, n] of state.msgCounts) {
		const [ieee, h] = [k.slice(0, k.lastIndexOf('|')), Number(k.slice(k.lastIndexOf('|') + 1))];
		if (h < from || h >= to) continue;
		row(ieee, h).msgCount = n;
		counted.add(`${ieee}|${h}`);
	}
	// counters outside the window can never be rolled up; drop them
	for (const k of state.msgCounts.keys()) if (Number(k.slice(k.lastIndexOf('|') + 1)) < to) drained.push(k);
	db.transaction((tx) => {
		for (const r of rows.values()) {
			const { ieee, hour, msgCount, ...set } = r;
			// a counter is added to the stored count (a restart can split an hour); no counter leaves it untouched
			const count = counted.has(`${ieee}|${hour}`) ? { msgCount: sql`${samplesHourly.msgCount} + ${msgCount}` } : {};
			tx.insert(samplesHourly).values(r).onConflictDoUpdate({ target: [samplesHourly.ieee, samplesHourly.hour], set: { ...set, ...count } }).run();
		}
	});
	for (const k of drained) state.msgCounts.delete(k);
}

/** Per-device LQI baseline and the network route-error rate over [now - 8 d, now - 24 h). */
export function computeBaselines(db: Db, now: number): void {
	const from = now - 8 * D;
	const to = now - D;
	const hourly = db.select().from(samplesHourly).where(and(gte(samplesHourly.hour, from), lt(samplesHourly.hour, to))).all();
	const evs = db.select({ ts: events.ts, kind: events.kind }).from(events).where(and(gte(events.ts, from), lt(events.ts, to))).all();

	const out: (typeof baselines.$inferInsert)[] = [];
	// days = whole days of hours with data, so a short history is not counted as several calendar days
	const by = new Map<string, number[]>();
	for (const r of hourly) if (r.lqiAvg !== null) by.set(r.ieee, [...(by.get(r.ieee) ?? []), r.lqiAvg]);
	for (const [ieee, avgs] of by) {
		const days = Math.floor(avgs.length / 24);
		const mean = avgs.reduce((a, b) => a + b, 0) / avgs.length;
		const sd = Math.sqrt(avgs.reduce((a, b) => a + (b - mean) ** 2, 0) / avgs.length);
		out.push({ ieee, metric: 'lqi_mean', value: mean, days, computedAt: now },
			{ ieee, metric: 'lqi_stddev', value: sd, days, computedAt: now });
	}
	// hours the monitor was collecting; route errors were only parsed since then, so events do not count
	const netDays = Math.floor(new Set(hourly.map((r) => r.hour)).size / 24);
	const errors = evs.filter((e) => e.kind === 'route_error').length;
	out.push({ ieee: '', metric: 'route_errors_hourly', value: errors / ((to - from) / H), days: netDays, computedAt: now });
	const counts = new Map<string, number[]>();
	for (const r of hourly) counts.set(r.ieee, [...(counts.get(r.ieee) ?? []), r.msgCount]);
	let netPerMin = 0;
	for (const [ieee, c] of counts) {
		const perMin = c.reduce((a, b) => a + b, 0) / c.length / 60;
		netPerMin += perMin;
		out.push({ ieee, metric: 'msg_per_min', value: perMin, days: Math.floor(c.length / 24), computedAt: now });
	}
	out.push({ ieee: '', metric: 'msg_per_min', value: netPerMin, days: netDays, computedAt: now });

	const { stale, forecasts } = batteryForecasts(db, now);
	out.push(...forecasts);

	db.transaction((tx) => {
		if (stale.length) tx.delete(baselines).where(and(eq(baselines.metric, 'battery_days_left'), inArray(baselines.ieee, stale))).run();
		for (const b of out) {
			tx.insert(baselines).values(b).onConflictDoUpdate({ target: [baselines.ieee, baselines.metric], set: { value: b.value, days: b.days, computedAt: b.computedAt } }).run();
		}
	});
}

/** Days until each battery device hits the target, fitted on the last 30 days since its latest battery swap. */
function batteryForecasts(db: Db, now: number) {
	const s = getSettings(db);
	const ieees = db.select({ ieee: devices.ieee }).from(devices).where(and(eq(devices.powerSource, 'Battery'), sql`${devices.removedAt} is null`)).all().map((r) => r.ieee);
	const swaps = new Map<string, number>();
	for (const e of db.select({ ieee: events.ieee, ts: events.ts }).from(events).where(and(eq(events.kind, 'battery_swap'), gte(events.ts, now - 30 * D))).orderBy(events.ts).all())
		if (e.ieee) swaps.set(e.ieee, e.ts);
	const pts = new Map<string, { t: number; battery: number }[]>();
	for (const r of db.select().from(samplesHourly).where(and(gte(samplesHourly.hour, now - 30 * D), isNotNull(samplesHourly.batteryMin))).orderBy(samplesHourly.hour).all()) {
		if (r.hour <= (swaps.get(r.ieee) ?? -Infinity)) continue;
		pts.set(r.ieee, [...(pts.get(r.ieee) ?? []), { t: r.hour, battery: r.batteryMin! }]);
	}
	const forecasts: (typeof baselines.$inferInsert)[] = [];
	for (const ieee of ieees) {
		const p = pts.get(ieee) ?? [];
		const value = forecastDaysLeft(p, now, s.forecastTargetPct, s.forecastMinDays);
		if (value !== null) forecasts.push({ ieee, metric: 'battery_days_left', value, days: Math.floor((p[p.length - 1].t - p[0].t) / D), computedAt: now });
	}
	// everything without a fresh forecast (also devices no longer battery powered) loses its row
	const have = new Set(forecasts.map((f) => f.ieee));
	const stale = db.select({ ieee: baselines.ieee }).from(baselines).where(eq(baselines.metric, 'battery_days_left')).all().map((r) => r.ieee).filter((i) => !have.has(i));
	return { stale, forecasts };
}
