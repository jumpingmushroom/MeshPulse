import { ne } from 'drizzle-orm';
import { issues } from '../lib/server/db/schema';
import { formatDuration } from '../lib/server/notify/channel';
import { checkPrereqs } from '../lib/server/prereqs';
import { getRuntime } from '../lib/server/runtime';
import { getSettings } from '../lib/server/settings';
import { counters, overallStatus, sortIssues } from '../lib/views';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const { db, state } = getRuntime();
	const open = sortIssues(db.select().from(issues).where(ne(issues.state, 'resolved')).all());
	const { bridge } = state;
	const info = bridge.info;
	return {
		status: overallStatus(open),
		issues: open.map(({ id, severity, state, summary, openedAt }) => ({ id, severity, state, summary, openedAt })),
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
