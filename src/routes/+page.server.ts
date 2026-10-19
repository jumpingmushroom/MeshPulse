import { and, eq, lte, min, ne } from 'drizzle-orm';
import { baselines, issues, samplesHourly } from '../lib/server/db/schema';
import { checkPrereqs } from '../lib/server/prereqs';
import { getRuntime } from '../lib/server/runtime';
import { getSettings } from '../lib/server/settings';
import { buildSeries, summarise } from '../lib/chart';
import { networkScore } from '../lib/score';
import { networkMsgPerMin } from '../lib/server/trends/rollup';
import { banner, counters, learning, peakQuiet, formatDuration, sortIssues } from '../lib/views';
import type { PageServerLoad } from './$types';

const H = 3_600_000;
const SPARK = { w: 160, h: 32 };

export const load: PageServerLoad = () => {
	const { db, state, config } = getRuntime();
	const open = sortIssues(db.select().from(issues).where(ne(issues.state, 'resolved')).all());
	const ids = new Set(open.map((i) => i.id)); // a child whose parent is not open shows at top level
	const list = open.filter((i) => i.parentIssueId === null || !ids.has(i.parentIssueId));
	const now = Date.now();
	const msgs = networkMsgPerMin(db, now);
	const box = { ...SPARK, t0: now - 24 * H, t1: now, y0: 0, y1: Math.max(1, ...msgs.map((p) => p.v)) };
	const { bridge } = state;
	const info = bridge.info;
	const watched = [...state.devices.values()].filter((d) => d.removedAt === null && d.type !== 'Coordinator');
	const name = (ieee: string | null) => (ieee && state.devices.get(ieee)?.friendlyName) || undefined;
	const soonest = db.select({ ieee: baselines.ieee, days: baselines.value }).from(baselines)
		.where(and(eq(baselines.metric, 'battery_days_left'), lte(baselines.value, 30))).orderBy(baselines.value).limit(1).get();
	const first = db.select({ h: min(samplesHourly.hour) }).from(samplesHourly).get()?.h ?? null;
	return {
		...networkScore(open),
		banner: banner(list),
		learning: learning(first, now),
		peakQuiet: peakQuiet(msgs, config.tz),
		offline: watched.filter((d) => d.availability === 'offline').length,
		unknown: watched.filter((d) => d.availability !== 'online' && d.availability !== 'offline').length,
		nextBattery: soonest ? { name: name(soonest.ieee) ?? soonest.ieee, days: Math.round(soonest.days) } : null,
		topLevel: list.length,
		spark: { w: SPARK.w, h: SPARK.h, d: msgs.length >= 2 ? buildSeries(msgs, box, 3 * H).line : '', summary: summarise('Messages per minute, 24 h', '/min', msgs) },
		issues: list.map(({ id, severity, state, summary, action, rule, ieee, openedAt }) =>
			({ id, severity, state, summary, action, rule, ieee, deviceName: name(ieee), openedAt,
				children: open.filter((c) => c.parentIssueId === id).map(({ id, summary, rule }) => ({ id, summary, rule })) })),
		counters: counters(state, getSettings(db).batteryLowPct),
		prereqs: checkPrereqs(info).filter((p) => !p.ok),
		bridge: {
			state: bridge.state,
			version: bridge.version ?? info?.version ?? null,
			uptime: bridge.lastUptimeSec === null ? null : formatDuration(bridge.lastUptimeSec * 1000),
			channel: info?.network?.channel ?? null,
			coordinator: info?.coordinator?.type ?? null
		}
	};
};
