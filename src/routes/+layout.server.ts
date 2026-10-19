import { eq } from 'drizzle-orm';
import { issues } from '../lib/server/db/schema';
import { getRuntime } from '../lib/server/runtime';
import { navSummary } from '../lib/views';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	const { config, db, state } = getRuntime();
	const open = db.select({ severity: issues.severity, parentIssueId: issues.parentIssueId }).from(issues).where(eq(issues.state, 'open')).all();
	return {
		tz: config.tz, user: locals.user?.email ?? null, now: Date.now(),
		nav: navSummary(open, state.monitor), lastMessageAt: state.bridge.lastLiveAt
	};
};
