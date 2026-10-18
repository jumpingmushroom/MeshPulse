import { gte } from 'drizzle-orm';
import type { Db } from '../db/index';
import { baselines, samplesHourly, type BaselineMetric } from '../db/schema';
import { hourStart } from './rollup';

const H = 3_600_000;

export interface HourlyRow {
	hour: number;
	lqiMin: number | null;
	lqiAvg: number | null;
	lqiMax: number | null;
	batteryMin: number | null;
	voltageMin: number | null;
	msgCount: number;
}

export interface History {
	/** last 24 complete hours per device, ascending */
	hourly: Map<string, HourlyRow[]>;
	/** keyed `${ieee}|${metric}`; network rows have ieee '' */
	baselines: Map<string, { value: number; days: number }>;
}

export function loadHistory(db: Db, now: number): History {
	const hourly = new Map<string, HourlyRow[]>();
	const rows = db.select().from(samplesHourly).where(gte(samplesHourly.hour, hourStart(now) - 24 * H)).orderBy(samplesHourly.hour).all();
	for (const { ieee, ...r } of rows) hourly.set(ieee, [...(hourly.get(ieee) ?? []), r]);
	const b = db.select().from(baselines).all();
	return { hourly, baselines: new Map(b.map((r) => [`${r.ieee}|${r.metric}`, { value: r.value, days: r.days }])) };
}

export const baselineOf = (h: History, ieee: string, metric: BaselineMetric) => h.baselines.get(`${ieee}|${metric}`);
