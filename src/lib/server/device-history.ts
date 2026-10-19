import { and, asc, desc, eq, gte, inArray, lt, min, or, isNull } from 'drizzle-orm';
import { autoRange, fillHours, summarise, type Point, type Span } from '../chart';
import { formatVoltage } from '../views';
import { baselines, devices, events, issues, samples, samplesHourly } from './db/schema';
import type { Db } from './db';
import type { Settings } from './settings';
import { hourStart } from './trends/rollup';

const H = 3_600_000;
export const RANGES = { '24h': 24 * H, '7d': 168 * H, '30d': 720 * H } as const;
export type Range = keyof typeof RANGES;
export type ChartProps = {
	t0: number; t1: number; maxGapMs: number; gaps: Span[]; title: string; unit: string; points: Point[]; y0: number; y1: number;
	refs: { y: number; label: string }[]; latest: string | undefined; summary: string; integer?: boolean;
};

type SpanInput = { avail: { ts: number; to: string }[]; outages: { from: number; to: number | null }[];
	rolledHours: number[]; firstRolledHour: number | null; currentHour: number };

/** Merged, sorted spans in [t0, t1] where MeshPulse has no data for a device: offline, network outage, or MeshPulse not running. */
export function noDataSpans(i: SpanInput, t0: number, t1: number, minMs = 0): Span[] {
	const all: Span[] = [];
	let off: number | null = null;
	for (const e of [...i.avail].sort((a, b) => a.ts - b.ts)) {
		if (e.to === 'offline') off ??= e.ts;
		else if (e.to === 'online' && off !== null) { all.push({ from: off, to: e.ts }); off = null; }
	}
	if (off !== null) all.push({ from: off, to: t1 });
	for (const o of i.outages) all.push({ from: o.from, to: o.to ?? t1 });
	if (i.firstRolledHour !== null) {
		const rolled = new Set(i.rolledHours);
		for (let h = Math.max(hourStart(t0), i.firstRolledHour); h < i.currentHour - H && // the previous hour is rolled up ~1 min late
			 h < t1; h += H) if (!rolled.has(h)) all.push({ from: h, to: h + H });
	}
	const out: Span[] = [];
	for (const s of all.map((s) => ({ from: Math.max(s.from, t0), to: Math.min(s.to, t1) })).filter((s) => s.to > s.from).sort((a, b) => a.from - b.from)) {
		const l = out[out.length - 1];
		if (l && s.from <= l.to) l.to = Math.max(l.to, s.to); else out.push(s);
	}
	return out.filter((s) => s.to - s.from >= minMs);
}

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

	const inWin = db.select().from(events).where(and(eq(events.ieee, ieee), eq(events.kind, 'availability'), gte(events.ts, t0)))
		.orderBy(asc(events.ts)).all();
	const to = (e: { detail: unknown }) => String((e.detail as { to?: unknown } | null)?.to);
	// state at t0 without a backwards scan: the first in-window event's predecessor state, else the device's current state
	const offlineAtT0 = inWin.length ? to(inWin[0]) === 'online' : d?.availability === 'offline';
	const rolled = db.selectDistinct({ hour: samplesHourly.hour }).from(samplesHourly).where(gte(samplesHourly.hour, hourStart(t0))).all().map((r) => r.hour);
	const first = db.select({ m: min(samplesHourly.hour) }).from(samplesHourly).get()?.m ?? null;
	const outages = db.select().from(issues).where(and(inArray(issues.rule, ['bridge.offline', 'monitor.mqtt_lost']),
		lt(issues.openedAt, t1), or(isNull(issues.resolvedAt), gte(issues.resolvedAt, t0)))).all();
	const gaps = noDataSpans({
		avail: [...(offlineAtT0 ? [{ ts: t0, to: 'offline' }] : []), ...inWin.map((e) => ({ ts: e.ts, to: to(e) }))],
		outages: outages.map((o) => ({ from: o.openedAt, to: o.resolvedAt })),
		rolledHours: rolled, firstRolledHour: first, currentHour: hourStart(t1)
	}, t0, t1, settings.graceMin * 60_000);

	// hours with no row inside a no-data span are unknown, not zero
	const have = new Set(hourly.map((h) => h.hour));
	const msgsAt = (f: (n: number) => number) => fillHours(hourly.map((h) => ({ t: h.hour, v: f(h.msgCount) })), hourStart(t1) - H)
		.map((p) => !have.has(p.t) && gaps.some((s) => s.from < p.t + H && s.to > p.t) ? { ...p, v: null } : p);

	const lqiMean = db.select().from(baselines).where(and(eq(baselines.ieee, ieee), eq(baselines.metric, 'lqi_mean'))).get()?.value ?? null;
	const g = { t0, t1 };
	const latest = (points: Point[], f: (v: number) => string) => {
		const v = points.findLast((p) => p.v !== null && Number.isFinite(p.v))?.v;
		return v == null ? undefined : f(v);
	};
	const round = (v: number) => String(Math.round(v));
	const chart = (title: string, unit: string, points: Point[], y0: number, y1: number, f = round, maxGapMs = Infinity, spans: Span[] = [],
		refs: { y: number; label: string }[] = []): ChartProps =>
		({ ...g, maxGapMs, gaps: spans, title, unit, points, y0, y1, refs, latest: latest(points, f), summary: summarise(title, unit, points) });
	const [v0, v1] = autoRange(voltage.some((p) => p.v !== null) ? [...voltage.map((p) => p.v), settings.voltageLow] : []); // keep the low line on the plot
	batteryPowered ??= d?.powerSource === 'Battery' || (last?.battery ?? null) !== null || (last?.voltage ?? null) !== null;
	const perHour = msgsAt((n) => n);
	const perMin = msgsAt((n) => n / 60);
	const top = (ps: Point[]) => Math.max(1, ...ps.map((p) => p.v ?? 0));

	return {
		lqi: chart('Link quality', '', lqi, 0, 255, round, Infinity, gaps, [
			...(lqiMean !== null ? [{ y: lqiMean, label: `baseline ${Math.round(lqiMean)}` }] : []),
			{ y: settings.lqiWeak, label: `weak ${settings.lqiWeak}` }
		]),
		battery: batteryPowered ? chart('Battery', '%', battery, 0, 100, round, Infinity, gaps, [
			{ y: settings.batteryLowPct, label: `Low ${settings.batteryLowPct} %` }, { y: settings.batteryCriticalPct, label: `Critical ${settings.batteryCriticalPct} %` }]) : null,
		voltage: batteryPowered ? chart('Voltage', 'V', voltage, v0, v1, formatVoltage, Infinity, gaps,
			voltage.some((p) => p.v !== null) ? [{ y: settings.voltageLow, label: `Coin cell low ${settings.voltageLow} V` }] : []) : null,
		msgs: chart('Messages per minute', '/min', perMin, 0, top(perMin), (v) => v.toFixed(1), Infinity, gaps),
		msgsHour: { ...chart('Messages per hour', '', perHour, 0, top(perHour), round, Infinity, gaps), integer: true }
	};
}
