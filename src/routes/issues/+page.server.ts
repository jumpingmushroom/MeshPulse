import { desc, eq } from 'drizzle-orm';
import { issues } from '../../lib/server/db/schema';
import { getRuntime } from '../../lib/server/runtime';
import { sortIssues } from '../../lib/views';
import type { PageServerLoad } from './$types';

const TABS = ['open', 'acknowledged', 'resolved'] as const;

export const load: PageServerLoad = ({ url }) => {
	const { db, state } = getRuntime();
	const tab = TABS.find((t) => t === url.searchParams.get('state')) ?? 'open';
	// shortcut: resolved shows the latest 200 only, add paging if history matters
	const rows = tab === 'resolved'
		? db.select().from(issues).where(eq(issues.state, tab)).orderBy(desc(issues.resolvedAt)).limit(200).all()
		: sortIssues(db.select().from(issues).where(eq(issues.state, tab)).all());
	return {
		tab, tabs: TABS,
		issues: rows.map(({ id, severity, summary, openedAt, resolvedAt, ieee }) =>
			({ id, severity, summary, openedAt, resolvedAt, device: (ieee && state.devices.get(ieee)?.friendlyName) || null }))
	};
};
