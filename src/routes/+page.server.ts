import { ne } from 'drizzle-orm';
import { issues } from '../lib/server/db/schema';
import { checkPrereqs } from '../lib/server/prereqs';
import { getRuntime } from '../lib/server/runtime';
import { getSettings } from '../lib/server/settings';
import { counters, formatDuration, overallStatus, sortIssues } from '../lib/views';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const { db, state } = getRuntime();
	const open = sortIssues(db.select().from(issues).where(ne(issues.state, 'resolved')).all());
	const ids = new Set(open.map((i) => i.id)); // a child whose parent is not open shows at top level
	const { bridge } = state;
	const info = bridge.info;
	return {
		status: overallStatus(open),
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
