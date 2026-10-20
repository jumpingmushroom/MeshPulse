import { ne } from 'drizzle-orm';
import { issues } from '../lib/server/db/schema';
import { isAddon } from '../lib/server/addon';
import { getRuntime } from '../lib/server/runtime';
import { getSettings } from '../lib/server/settings';
import { navSummary } from '../lib/views';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	const { config, db, state } = getRuntime();
	// signed-out visitors (/login) get no issue data
	if (!locals.user) return { tz: config.tz, user: null, now: Date.now(), nav: navSummary([], { connected: true, downSince: null, startedAt: 0 }), lastMessageAt: null, wifi: false, addon: isAddon() };
	const open = db.select({ severity: issues.severity, parentIssueId: issues.parentIssueId }).from(issues).where(ne(issues.state, 'resolved')).all();
	return {
		tz: config.tz, user: locals.user?.email ?? null, now: Date.now(),
		nav: navSummary(open, state.monitor), lastMessageAt: state.bridge.lastLiveAt, wifi: getSettings(db).wifiEnabled, addon: isAddon()
	};
};
