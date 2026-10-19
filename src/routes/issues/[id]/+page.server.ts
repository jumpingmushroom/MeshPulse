import { error, fail } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { devices, events, issues } from '../../../lib/server/db/schema';
import { getRuntime } from '../../../lib/server/runtime';
import { deviceCharts } from '../../../lib/server/device-history';
import { getSettings } from '../../../lib/server/settings';
import { muteUntil } from '../../../lib/server/store';
import { chartFor, liveDevice } from '../../../lib/views';
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
	const charts = which && device ? deviceCharts(db, device.ieee, '7d', getSettings(db), Date.now(), device.powerSource === 'Battery' || device.battery !== null || device.voltage !== null) : null;
	return {
		issue,
		byName: Object.fromEntries([...state.devices.values()].filter((d) => d.removedAt === null).map((d) => [d.friendlyName, d.ieee])),
		chart: (which && charts?.[which]) || null,
		parent: issue.parentIssueId === null ? null
			: db.select({ id: issues.id, summary: issues.summary }).from(issues).where(eq(issues.id, issue.parentIssueId)).get() ?? null,
		children: db.select({ id: issues.id, summary: issues.summary, state: issues.state }).from(issues).where(eq(issues.parentIssueId, issue.id)).all(),
		device: device ? { name: device.friendlyName, ieee: device.ieee, mutedUntil: device.mutedUntil } : null,
		events: issue.ieee ? db.select().from(events).where(eq(events.ieee, issue.ieee)).orderBy(desc(events.ts), desc(events.id)).limit(50).all() : []
	};
};

export const actions: Actions = {
	acknowledge: ({ params }) => {
		const { db } = getRuntime();
		db.update(issues).set({ state: 'acknowledged', updatedAt: Date.now() })
			.where(and(eq(issues.id, getIssue(params.id).id), eq(issues.state, 'open'))).run();
	},
	mute: async ({ params, request }) => {
		const { db, state } = getRuntime();
		const issue = getIssue(params.id);
		const duration = String((await request.formData()).get('duration'));
		const device = issue.ieee ? state.devices.get(issue.ieee) : undefined;
		const mutedUntil = muteUntil(duration, Date.now());
		if (!device || mutedUntil === undefined) return fail(400, { error: 'Cannot mute: unknown device or duration.' });
		db.update(devices).set({ mutedUntil }).where(eq(devices.ieee, device.ieee)).run();
		device.mutedUntil = mutedUntil; // the lifecycle reads memory, not the DB
	}
};
