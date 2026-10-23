import { error, fail } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { events, issues } from '../../../lib/server/db/schema';
import { EVENT_KINDS } from '../../../lib/server/events-page';
import { getRuntime } from '../../../lib/server/runtime';
import { deviceCharts } from '../../../lib/server/device-history';
import { getSettings } from '../../../lib/server/settings';
import { setIgnoredRule } from '../../../lib/server/store';
import { muteDevice } from '../../../lib/server/mute';
import { canIgnore } from '../../../lib/server/rules/index';
import { chartFor, liveDevice } from '../../../lib/views';
import { isBatteryPowered } from '../../../lib/battery-types';
import type { Actions, PageServerLoad } from './$types';

function getIssue(id: string) {
	const issue = getRuntime().db.select().from(issues).where(eq(issues.id, Number(id))).get();
	if (!issue) error(404, 'Issue not found');
	return issue;
}

export const load: PageServerLoad = ({ params }) => {
	const { db, state } = getRuntime();
	const issue = getIssue(params.id);
	const device = liveDevice(state.devices, issue.ieee);
	const which = chartFor(issue.rule);
	const charts = which && device ? deviceCharts(db, device.ieee, '7d', getSettings(db), Date.now(), isBatteryPowered(device)) : null;
	return {
		issue,
		byName: Object.fromEntries([...state.devices.values()].filter((d) => d.removedAt === null).map((d) => [d.friendlyName, d.ieee])),
		chart: (which && charts?.[which]) || null,
		parent: issue.parentIssueId === null ? null
			: db.select({ id: issues.id, summary: issues.summary }).from(issues).where(eq(issues.id, issue.parentIssueId)).get() ?? null,
		children: db.select({ id: issues.id, summary: issues.summary, state: issues.state }).from(issues).where(eq(issues.parentIssueId, issue.id)).all(),
		device: device ? { name: device.friendlyName, ieee: device.ieee, mutedUntil: device.mutedUntil } : null,
		canTurnOff: !!device && canIgnore(device, issue.rule) && !device.ignoreRules.includes(issue.rule),
		events: (issue.ieee ? db.select().from(events).where(eq(events.ieee, issue.ieee)).orderBy(desc(events.ts), desc(events.id)).limit(50).all() : [])
			.map((e) => ({ ...e, label: EVENT_KINDS[e.kind as keyof typeof EVENT_KINDS] ?? e.kind.replaceAll('_', ' ') }))
	};
};

export const actions: Actions = {
	acknowledge: ({ params }) => {
		const { db } = getRuntime();
		db.update(issues).set({ state: 'acknowledged', updatedAt: Date.now() })
			.where(and(eq(issues.id, getIssue(params.id).id), eq(issues.state, 'open'))).run();
	},
	mute: ({ params, request }) => {
		const issue = getIssue(params.id);
		return muteDevice(issue.ieee ? getRuntime().state.devices.get(issue.ieee) : undefined, request);
	},
	ignoreRule: ({ params }) => {
		const { db, state } = getRuntime();
		const issue = getIssue(params.id);
		const device = issue.ieee ? state.devices.get(issue.ieee) : undefined;
		if (!device || !canIgnore(device, issue.rule)) return fail(400, { error: 'This rule cannot be turned off for this device.' });
		setIgnoredRule(db, state, device.ieee, issue.rule, true);
	}
};
