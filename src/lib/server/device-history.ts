import { and, asc, desc, eq, gte } from 'drizzle-orm';
import { autoRange, fillHours, summarise, type Point } from '../chart';
import { formatVoltage } from '../views';
import { baselines, devices, samples, samplesHourly } from './db/schema';
import type { Db } from './db';
import type { Settings } from './settings';
import { hourStart } from './trends/rollup';

const H = 3_600_000;
export const RANGES = { '24h': 24 * H, '7d': 168 * H, '30d': 720 * H } as const;
export type Range = keyof typeof RANGES;
export type ChartProps = {
	t0: number; t1: number; maxGapMs: number; title: string; unit: string; points: Point[]; y0: number; y1: number;
	refs: { y: number; label: string }[]; latest: string | undefined; summary: string; integer?: boolean;
};

/** Charts for one device over `range` ending at `now`. battery/voltage are null for mains devices. */
export function deviceCharts(db: Db, ieee: string, range: Range, settings: Settings, now: number, batteryPowered?: boolean): {
	lqi: ChartProps; battery: ChartProps | null; voltage: ChartProps | null; msgs: ChartProps; msgsHour: ChartProps;
} {
	const t1 = now;
	const t0 = t1 - RANGES[range];
	const d = db.select().from(devices).where(eq(devices.ieee, ieee)).get();
	const last = db.select().from(samples).where(eq(samples.ieee, ieee)).orderBy(desc(samples.ts)).limit(1).get();

	const hourly = db.select().from(samplesHourly).where(and(eq(samplesHourly.ieee, ieee), gte(samplesHourly.hour, t0)))
		.orderBy(asc(samplesHourly.hour)).all();
	const fromRaw = range === '24h';
	const raw = fromRaw
		? db.select().from(samples).where(and(eq(samples.ieee, ieee), gte(samples.ts, t0))).orderBy(asc(samples.ts)).all()
		: [];
	const lqi: Point[] = fromRaw ? raw.map((s) => ({ t: s.ts, v: s.lqi }))
		: hourly.map((h) => ({ t: h.hour, v: h.lqiAvg, lo: h.lqiMin, hi: h.lqiMax }));
	const battery: Point[] = fromRaw ? raw.map((s) => ({ t: s.ts, v: s.battery })) : hourly.map((h) => ({ t: h.hour, v: h.batteryMin }));
	const voltage: Point[] = fromRaw ? raw.map((s) => ({ t: s.ts, v: s.voltage })) : hourly.map((h) => ({ t: h.hour, v: h.voltageMin }));
	const msgsAt = (f: (n: number) => number) => fillHours(hourly.map((h) => ({ t: h.hour, v: f(h.msgCount) })), hourStart(t1) - H);

	const lqiMean = db.select().from(baselines).where(and(eq(baselines.ieee, ieee), eq(baselines.metric, 'lqi_mean'))).get()?.value ?? null;
	// sleepy sensors report less often than the default gap; don't break their line between normal reports
	const gap = (min: number) => Math.max(min, 3 * (d?.typicalGapMs ?? 0));
	const g = { t0, t1, maxGapMs: gap(fromRaw ? 30 * 60_000 : 3 * H) };
	const latest = (points: Point[], f: (v: number) => string) => {
		const v = points.findLast((p) => p.v !== null && Number.isFinite(p.v))?.v;
		return v == null ? undefined : f(v);
	};
	const round = (v: number) => String(Math.round(v));
	const chart = (title: string, unit: string, points: Point[], y0: number, y1: number, f = round, maxGapMs = g.maxGapMs,
		refs: { y: number; label: string }[] = []): ChartProps =>
		({ ...g, maxGapMs, title, unit, points, y0, y1, refs, latest: latest(points, f), summary: summarise(title, unit, points) });
	const [v0, v1] = autoRange(voltage.map((p) => p.v));
	batteryPowered ??= d?.powerSource === 'Battery' || (last?.battery ?? null) !== null || (last?.voltage ?? null) !== null;
	const perHour = msgsAt((n) => n);
	const perMin = msgsAt((n) => n / 60);
	const top = (ps: Point[]) => Math.max(1, ...ps.map((p) => p.v ?? 0));

	return {
		lqi: chart('Link quality', '', lqi, 0, 255, round, g.maxGapMs, [
			...(lqiMean !== null ? [{ y: lqiMean, label: `baseline ${Math.round(lqiMean)}` }] : []),
			{ y: settings.lqiWeak, label: `weak ${settings.lqiWeak}` }
		]),
		battery: batteryPowered ? chart('Battery', '%', battery, 0, 100, round, g.maxGapMs, [
			{ y: settings.batteryLowPct, label: `Low ${settings.batteryLowPct} %` }, { y: settings.batteryCriticalPct, label: `Critical ${settings.batteryCriticalPct} %` }]) : null,
		voltage: batteryPowered ? chart('Voltage', 'V', voltage, v0, v1, formatVoltage, g.maxGapMs,
			voltage.some((p) => p.v !== null) ? [{ y: settings.voltageLow, label: `Coin cell low ${settings.voltageLow} V` }] : []) : null,
		msgs: chart('Messages per minute', '/min', perMin, 0, top(perMin), (v) => v.toFixed(1), gap(3 * H)),
		msgsHour: { ...chart('Messages per hour', '', perHour, 0, top(perHour), round, gap(3 * H)), integer: true }
	};
}
