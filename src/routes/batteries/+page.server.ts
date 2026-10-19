import { and, eq, gte, isNotNull, max } from 'drizzle-orm';
import { buildSeries, type Point } from '../../lib/chart';
import { baselines, events, samplesHourly } from '../../lib/server/db/schema';
import { getRuntime } from '../../lib/server/runtime';
import { getSettings } from '../../lib/server/settings';
import { batteryRows, splitBatteries } from '../../lib/views';
import type { PageServerLoad } from './$types';

const H = 3_600_000;
const SPARK = { w: 120, h: 24 };

export const load: PageServerLoad = () => {
	const { db, state } = getRuntime();
	const t1 = Date.now();
	const t0 = t1 - 720 * H;
	const daysLeft = new Map(db.select().from(baselines).where(eq(baselines.metric, 'battery_days_left')).all().map((b) => [b.ieee, b.value]));
	const swaps = new Map(db.select({ ieee: events.ieee, ts: max(events.ts) }).from(events).where(eq(events.kind, 'battery_swap'))
		.groupBy(events.ieee).all().flatMap((e): [string, number][] => (e.ieee && e.ts !== null ? [[e.ieee, e.ts]] : [])));
	const hourly = new Map<string, Point[]>();
	for (const h of db.select().from(samplesHourly).where(and(gte(samplesHourly.hour, t0), isNotNull(samplesHourly.batteryMin))).orderBy(samplesHourly.hour).all()) {
		const list = hourly.get(h.ieee) ?? [];
		list.push({ t: h.hour, v: h.batteryMin });
		hourly.set(h.ieee, list);
	}
	const box = { ...SPARK, t0, t1, y0: 0, y1: 100 };
	const trends = new Map<string, string>();
	for (const [ieee, pts] of hourly) if (pts.length >= 2) trends.set(ieee, buildSeries(pts, box, 3 * H).line);
	const rows = batteryRows([...state.devices.values()], daysLeft, swaps, getSettings(db).batteryLowPct, trends);
	return { ...splitBatteries(rows), total: rows.length, spark: SPARK, anyForecast: daysLeft.size > 0 };
};
