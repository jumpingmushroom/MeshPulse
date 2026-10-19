import { error, fail } from '@sveltejs/kit';
import { and, count, desc, eq, ne } from 'drizzle-orm';
import { EVENT_KINDS } from '../../../lib/server/events-page';
import { deviceScore } from '../../../lib/score';
import { latestParents, parentChanged } from '../../../lib/server/active/parents';
import { deviceCharts, type Range } from '../../../lib/server/device-history';
import { baselines, devices, events, issues, wifiAreas } from '../../../lib/server/db/schema';
import { getRuntime } from '../../../lib/server/runtime';
import { getSettings } from '../../../lib/server/settings';
import { areaOf } from '../../../lib/server/wifi/areas';
import { loadWifiSnapshot } from '../../../lib/server/wifi/snapshot';
import { muteUntil, setTag } from '../../../lib/server/store';
import type { Actions, PageServerLoad } from './$types';

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
	const settings = getSettings(db);

	const baseline = (metric: 'battery_days_left') =>
		db.select().from(baselines).where(and(eq(baselines.ieee, d.ieee), eq(baselines.metric, metric))).get()?.value ?? null;
	const batteryPowered = d.powerSource === 'Battery' || d.battery !== null || d.voltage !== null;
	const c = deviceCharts(db, d.ieee, range, settings, t1, batteryPowered);

	const openIssues = db.select().from(issues).where(and(eq(issues.ieee, d.ieee), ne(issues.state, 'resolved'))).all()
		.map((i) => ({ ...i, deviceName: d.friendlyName }));

	const { state } = getRuntime();
	const scan = latestParents(db, (i) => state.devices.get(i)?.type, t1);
	const p = scan?.parents.get(d.ieee);
	const parent = p ? {
		ieee: p.parent, name: state.devices.get(p.parent)?.friendlyName ?? null, lqi: p.lqi,
		changed: parentChanged(scan!.parents, scan!.previous, d.ieee)
	} : null;
	const routed = scan && d.type === 'Router' ? [...scan.parents.values()].filter((v) => v.parent === d.ieee).length : null;

	// no areas configured (or none matching): "whole network", every AP is nearby
	const mine = areaOf(d.friendlyName, db.select().from(wifiAreas).all());
	const nearbyWifi = settings.wifiEnabled
		? loadWifiSnapshot(db, state, t1).aps.filter((a) => a.channel !== null && (!mine.length || a.area === null || mine.includes(a.area)))
			.map((a) => ({ name: a.name, channel: a.channel!, overlaps: a.overlaps, busy: a.cuTotal === null ? null : Math.round(a.cuTotal) }))
		: [];
	return {
		range,
		nearbyWifi,
		parent, routed,
		device: {
			ieee: d.ieee, name: d.friendlyName, type: d.type, model: d.model, vendor: d.vendor, powerSource: d.powerSource,
			availability: d.availability, lastSeenAt: d.lastSeenAt, mutedUntil: d.mutedUntil, ignored: d.tags.includes('ignore'), chatty: d.tags.includes('chatty'), batteryPowered, battery: d.battery, voltage: d.voltage
		},
		charts: [c.lqi, ...(batteryPowered && c.battery && c.voltage ? [c.battery, c.voltage] : []), c.msgsHour],
		daysLeft: baseline('battery_days_left'),
		targetPct: settings.forecastTargetPct,
		lastSwapAt: db.select({ ts: events.ts }).from(events).where(and(eq(events.ieee, d.ieee), eq(events.kind, 'battery_swap')))
			.orderBy(desc(events.ts)).limit(1).get()?.ts ?? null,
		issues: openIssues,
		score: deviceScore(openIssues),
		eventCount: db.select({ n: count() }).from(events).where(eq(events.ieee, d.ieee)).get()?.n ?? 0,
		events: db.select().from(events).where(eq(events.ieee, d.ieee)).orderBy(desc(events.ts), desc(events.id)).limit(10).all()
			.map((e) => ({ ...e, label: EVENT_KINDS[e.kind as keyof typeof EVENT_KINDS] ?? e.kind.replaceAll('_', ' ') }))
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
		setTag(db, state, getDevice(params.ieee).ieee, 'ignore', on);
	},
	chatty: async ({ params, request }) => {
		const { db, state } = getRuntime();
		const on = (await request.formData()).get('on') === '1';
		setTag(db, state, getDevice(params.ieee).ieee, 'chatty', on);
	}
};
