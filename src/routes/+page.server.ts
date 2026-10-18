import { ne } from 'drizzle-orm';
import { issues } from '../lib/server/db/schema';
import { checkPrereqs } from '../lib/server/prereqs';
import { getRuntime } from '../lib/server/runtime';
import { getSettings } from '../lib/server/settings';
import { buildSeries, summarise } from '../lib/chart';
import { networkScore } from '../lib/score';
import { networkMsgPerMin } from '../lib/server/trends/rollup';
import { counters, formatDuration, sortIssues } from '../lib/views';
import type { PageServerLoad } from './$types';

const H = 3_600_000;
const SPARK = { w: 160, h: 32 };

export const load: PageServerLoad = () => {
	const { db, state } = getRuntime();
	const open = sortIssues(db.select().from(issues).where(ne(issues.state, 'resolved')).all());
	const ids = new Set(open.map((i) => i.id)); // a child whose parent is not open shows at top level
	const now = Date.now();
	const msgs = networkMsgPerMin(db, now);
	const box = { ...SPARK, t0: now - 24 * H, t1: now, y0: 0, y1: Math.max(1, ...msgs.map((p) => p.v)) };
	const { bridge } = state;
	const info = bridge.info;
	return {
		...networkScore(open),
		topLevel: open.filter((i) => i.parentIssueId === null).length,
		spark: { w: SPARK.w, h: SPARK.h, d: msgs.length >= 2 ? buildSeries(msgs, box, 3 * H).line : '', summary: summarise('Messages per minute, 24 h', '/min', msgs) },
		issues: open.filter((i) => i.parentIssueId === null || !ids.has(i.parentIssueId)).map(({ id, severity, state, summary, openedAt }) =>
			({ id, severity, state, summary, openedAt, children: open.filter((c) => c.parentIssueId === id).map(({ id, summary }) => ({ id, summary })) })),
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
