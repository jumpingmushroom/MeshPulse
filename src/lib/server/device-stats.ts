import { and, avg, gte, lt } from 'drizzle-orm';
import { baselines, samplesHourly } from './db/schema';
import type { Db } from './db';

const H = 3_600_000;
export type DeviceStat = { lqi24: number | null; lqiBase: number | null; msgH: number | null };

/** Per device: mean LQI and messages per hour over the last 24 full hours, plus the LQI baseline. */
export function deviceStats(db: Db, now: number): Map<string, DeviceStat> {
	const end = Math.floor(now / H) * H;
	const out = new Map<string, DeviceStat>();
	const at = (ieee: string) => out.get(ieee) ?? out.set(ieee, { lqi24: null, lqiBase: null, msgH: null }).get(ieee)!;
	const rows = db.select({ ieee: samplesHourly.ieee, lqi: avg(samplesHourly.lqiAvg), msg: avg(samplesHourly.msgCount) }).from(samplesHourly)
		.where(and(gte(samplesHourly.hour, end - 24 * H), lt(samplesHourly.hour, end))).groupBy(samplesHourly.ieee).all();
	for (const r of rows) Object.assign(at(r.ieee), { lqi24: r.lqi === null ? null : Number(r.lqi), msgH: r.msg === null ? null : Number(r.msg) });
	for (const b of db.select().from(baselines).all()) if (b.metric === 'lqi_mean' && b.ieee) at(b.ieee).lqiBase = b.value;
	return out;
}
