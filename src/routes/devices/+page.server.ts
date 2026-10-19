import { ne } from 'drizzle-orm';
import { issues } from '../../lib/server/db/schema';
import { deviceStats } from '../../lib/server/device-stats';
import { getSettings } from '../../lib/server/settings';
import { getRuntime } from '../../lib/server/runtime';
import { deviceRows, filterRows, sortRows, type SortKey } from '../../lib/views';
import type { PageServerLoad } from './$types';

const KEYS: SortKey[] = ['name', 'type', 'availability', 'lastSeenAt', 'lqi', 'battery', 'voltage', 'openIssues', 'score', 'msgH'];

export const load: PageServerLoad = ({ url }) => {
	const { db, state, config } = getRuntime();
	const now = Date.now();
	const p = url.searchParams;
	const sort = KEYS.find((k) => k === p.get('sort')) ?? 'name';
	const asc = p.get('dir') !== 'desc';
	const f = { q: p.get('q') ?? '', routers: p.has('routers'), battery: p.has('battery'), offline: p.has('offline'), issues: p.has('issues') };
	const all = deviceRows(state, db.select({ ieee: issues.ieee, severity: issues.severity }).from(issues).where(ne(issues.state, 'resolved')).all(), deviceStats(db, now));
	const rows = sortRows(filterRows(all, f), sort, asc);
	return {
		rows, f, sort, lqiWeak: getSettings(db).lqiWeak, asc, comfortable: p.get('density') === 'comfortable', now, tz: config.tz,
		counts: { total: all.length, routers: all.filter((r) => r.type === 'Router').length, battery: all.filter((r) => r.batteryPowered).length,
			offline: all.filter((r) => r.availability === 'offline').length, issues: all.filter((r) => r.openIssues > 0).length }
	};
};
