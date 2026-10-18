import { error, fail } from '@sveltejs/kit';
import { and, asc, desc, eq, gte, ne } from 'drizzle-orm';
import { autoRange, fillHours, summarise, type Point } from '../../../lib/chart';
import { formatVoltage } from '../../../lib/views';
import { baselines, devices, events, issues, samples, samplesHourly } from '../../../lib/server/db/schema';
import { getRuntime } from '../../../lib/server/runtime';
import { getSettings } from '../../../lib/server/settings';
import { hourStart } from '../../../lib/server/trends/rollup';
import { muteUntil, setIgnored } from '../../../lib/server/store';
import type { Actions, PageServerLoad } from './$types';

const H = 3_600_000;
const RANGES = { '24h': 24 * H, '7d': 168 * H, '30d': 720 * H } as const;
type Range = keyof typeof RANGES;

function getDevice(ieee: string) {
	const d = getRuntime().state.devices.get(ieee);
	if (!d) error(404, 'Device not found');
	return d;
}

export const load: PageServerLoad = ({ params, url }) => {
	const { db } = getRuntime();
	const d = getDevice(params.ieee);
	const q = url.searchParams.get('range');
	const range: Range = q === '7d' || q === '30d' ? q : '24h';
	const t1 = Date.now();
	const t0 = t1 - RANGES[range];
	const settings = getSettings(db);

	const hourly = db.select().from(samplesHourly).where(and(eq(samplesHourly.ieee, d.ieee), gte(samplesHourly.hour, t0)))
		.orderBy(asc(samplesHourly.hour)).all();
	const raw = range === '24h'
		? db.select().from(samples).where(and(eq(samples.ieee, d.ieee), gte(samples.ts, t0))).orderBy(asc(samples.ts)).all()
		: [];
	const fromRaw = range === '24h';
	const lqi: Point[] = fromRaw ? raw.map((s) => ({ t: s.ts, v: s.lqi }))
		: hourly.map((h) => ({ t: h.hour, v: h.lqiAvg, lo: h.lqiMin, hi: h.lqiMax }));
	const battery: Point[] = fromRaw ? raw.map((s) => ({ t: s.ts, v: s.battery })) : hourly.map((h) => ({ t: h.hour, v: h.batteryMin }));
	const voltage: Point[] = fromRaw ? raw.map((s) => ({ t: s.ts, v: s.voltage })) : hourly.map((h) => ({ t: h.hour, v: h.voltageMin }));
	const messages = fillHours(hourly.map((h) => ({ t: h.hour, v: h.msgCount })), hourStart(t1) - H);

	const baseline = (metric: 'lqi_mean' | 'battery_days_left') =>
		db.select().from(baselines).where(and(eq(baselines.ieee, d.ieee), eq(baselines.metric, metric))).get()?.value ?? null;
	const lqiMean = baseline('lqi_mean');
	// sleepy sensors report less often than the default gap; don't break their line between normal reports
	const gap = (min: number) => Math.max(min, 3 * (d.typicalGapMs ?? 0));
	const g = { t0, t1, maxGapMs: gap(fromRaw ? 30 * 60_000 : 3 * H) };
	const latest = (points: Point[], f: (v: number) => string) => {
		const v = points.findLast((p) => p.v !== null && Number.isFinite(p.v))?.v;
		return v == null ? undefined : f(v);
	};
	const round = (v: number) => String(Math.round(v));
	const chart = (title: string, unit: string, points: Point[], y0: number, y1: number, f = round, maxGapMs = g.maxGapMs,
		refs: { y: number; label: string }[] = []) =>
		({ ...g, maxGapMs, title, unit, points, y0, y1, refs, latest: latest(points, f), summary: summarise(title, unit, points) });
	const [v0, v1] = autoRange(voltage.map((p) => p.v));
	const batteryPowered = d.powerSource === 'Battery' || d.battery !== null || d.voltage !== null;

	return {
		range,
		device: {
			ieee: d.ieee, name: d.friendlyName, type: d.type, model: d.model, vendor: d.vendor, powerSource: d.powerSource,
			availability: d.availability, lastSeenAt: d.lastSeenAt, mutedUntil: d.mutedUntil, ignored: d.tags.includes('ignore'), batteryPowered
		},
		charts: [
			chart('Link quality', '', lqi, 0, 255, round, g.maxGapMs, [
				...(lqiMean !== null ? [{ y: lqiMean, label: `baseline ${Math.round(lqiMean)}` }] : []),
				{ y: settings.lqiWeak, label: `weak ${settings.lqiWeak}` }
			]),
			...(batteryPowered ? [chart('Battery', '%', battery, 0, 100), chart('Voltage', 'V', voltage, v0, v1, formatVoltage)] : []),
			{ ...chart('Messages per hour', '', messages, 0, Math.max(1, ...messages.map((p) => p.v ?? 0)), round, gap(3 * H)), integer: true }
		],
		daysLeft: baseline('battery_days_left'),
		targetPct: settings.forecastTargetPct,
		lastSwapAt: db.select({ ts: events.ts }).from(events).where(and(eq(events.ieee, d.ieee), eq(events.kind, 'battery_swap')))
			.orderBy(desc(events.ts)).limit(1).get()?.ts ?? null,
		issues: db.select({ id: issues.id, severity: issues.severity, summary: issues.summary }).from(issues)
			.where(and(eq(issues.ieee, d.ieee), ne(issues.state, 'resolved'))).all(),
		events: db.select().from(events).where(eq(events.ieee, d.ieee)).orderBy(desc(events.ts), desc(events.id)).limit(50).all()
	};
};

export const actions: Actions = {
	mute: async ({ params, request }) => {
		const { db } = getRuntime();
		const device = getDevice(params.ieee);
		const mutedUntil = muteUntil(String((await request.formData()).get('duration')), Date.now());
		if (mutedUntil === undefined) return fail(400, { error: 'Cannot mute: unknown duration.' });
		db.update(devices).set({ mutedUntil }).where(eq(devices.ieee, device.ieee)).run();
		device.mutedUntil = mutedUntil; // the lifecycle reads memory, not the DB
	},
	ignore: async ({ params, request }) => {
		const { db, state } = getRuntime();
		const on = (await request.formData()).get('on') === '1';
		setIgnored(db, state, getDevice(params.ieee).ieee, on);
	}
};
