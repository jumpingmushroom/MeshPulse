import { and, eq, gte, isNotNull, max } from 'drizzle-orm';
import { batteryTrend, type Point } from '../../lib/chart';
import { baselines, events, samplesHourly } from '../../lib/server/db/schema';
import { getRuntime } from '../../lib/server/runtime';
import { isBatteryLow } from '../../lib/server/rules/battery';
import { getSettings } from '../../lib/server/settings';
import { batteryRows, shoppingList, splitBatteries } from '../../lib/views';
import type { PageServerLoad } from './$types';

const H = 3_600_000;
const SPARK = { w: 96, h: 22 };

export const load: PageServerLoad = () => {
	const { db, state } = getRuntime();
	const t1 = Date.now();
	const t0 = t1 - 720 * H;
	const daysLeft = new Map(db.select().from(baselines).where(eq(baselines.metric, 'battery_days_left')).all().map((b) => [b.ieee, b.value]));
	const swaps = new Map(db.select({ ieee: events.ieee, ts: max(events.ts) }).from(events).where(eq(events.kind, 'battery_swap'))
		.groupBy(events.ieee).all().flatMap((e): [string, number][] => (e.ieee && e.ts !== null ? [[e.ieee, e.ts]] : [])));
	const hourly = new Map<string, Point[]>();
	for (const h of db.select({ ieee: samplesHourly.ieee, hour: samplesHourly.hour, batteryMin: samplesHourly.batteryMin }).from(samplesHourly).where(and(gte(samplesHourly.hour, t0), isNotNull(samplesHourly.batteryMin))).orderBy(samplesHourly.hour).all()) {
		const list = hourly.get(h.ieee) ?? [];
		list.push({ t: h.hour, v: h.batteryMin });
		hourly.set(h.ieee, list);
	}
	const trends = new Map<string, string>();
	const labels: Record<string, string> = {};
	for (const [ieee, pts] of hourly) {
		if (pts.length < 2) continue;
		const vs = pts.map((p) => p.v as number);
		trends.set(ieee, batteryTrend(pts, SPARK.w, SPARK.h, 3 * H));
		labels[ieee] = `30-day battery trend, ${Math.round(vs[0])} % to ${Math.round(vs[vs.length - 1])} %`;
	}
	const settings = getSettings(db);
	const rows = batteryRows([...state.devices.values()], daysLeft, swaps, (d) => isBatteryLow(d, settings), trends);
	return { ...splitBatteries(rows), shopping: shoppingList(rows), total: rows.length, spark: SPARK, labels, anyForecast: daysLeft.size > 0 };
};
