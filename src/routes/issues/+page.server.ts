import { count, desc, eq } from 'drizzle-orm';
import { issues } from '../../lib/server/db/schema';
import { getRuntime } from '../../lib/server/runtime';
import { RULE_LABELS, sortIssues } from '../../lib/views';
import type { PageServerLoad } from './$types';

const TABS = ['open', 'acknowledged', 'resolved'] as const;
const SEVS = ['critical', 'warning', 'info'] as const;

export const load: PageServerLoad = ({ url }) => {
	const { db, state } = getRuntime();
	const q = url.searchParams;
	const tab = TABS.find((t) => t === q.get('tab')) ?? 'open';
	const rule = Object.keys(RULE_LABELS).find((r) => r === q.get('rule')) ?? 'all';
	const sev = SEVS.find((s) => s === q.get('sev')) ?? 'all';
	const counts = Object.fromEntries(db.select({ s: issues.state, n: count() }).from(issues).groupBy(issues.state).all().map((r) => [r.s, r.n]));
	// shortcut: resolved shows the latest 200 only, add paging if history matters
	const all = db.select().from(issues).where(eq(issues.state, tab)).orderBy(desc(issues.resolvedAt)).limit(tab === 'resolved' ? 200 : -1).all();
	const match = all.filter((i) => (rule === 'all' || i.rule === rule) && (sev === 'all' || i.severity === sev));
	return {
		tab, rule, sev,
		tabs: TABS.map((t) => ({ key: t, label: t[0].toUpperCase() + t.slice(1), n: counts[t] ?? 0 })),
		rules: Object.entries(RULE_LABELS).map(([key, label]) => ({ key, label })),
		sevs: ['all', ...SEVS],
		issues: (tab === 'resolved' ? match : sortIssues(match)).map(({ id, severity, state: st, summary, openedAt, ieee, rule }) =>
			({ id, severity, state: st, summary, openedAt, ieee, rule, deviceName: (ieee && state.devices.get(ieee)?.friendlyName) || undefined }))
	};
};
