import { error, fail } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { devices, events, issues } from '../../../lib/server/db/schema';
import { getRuntime } from '../../../lib/server/runtime';
import type { Actions, PageServerLoad } from './$types';

const H = 3_600_000;
const FOREVER = 253402300799000; // 9999-12-31
const MUTE: Record<string, number | null> = { '1h': H, '24h': 24 * H, '7d': 168 * H, forever: FOREVER, unmute: null };

function getIssue(id: string) {
	const issue = getRuntime().db.select().from(issues).where(eq(issues.id, Number(id))).get();
	if (!issue) error(404, 'Issue not found');
	return issue;
}

export const load: PageServerLoad = ({ params }) => {
	const { db, state } = getRuntime();
	const issue = getIssue(params.id);
	const device = issue.ieee ? state.devices.get(issue.ieee) : undefined;
	return {
		issue,
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
		if (!device || !(duration in MUTE)) return fail(400, { error: 'Cannot mute: unknown device or duration.' });
		const ms = MUTE[duration];
		const mutedUntil = ms === null ? null : ms === FOREVER ? FOREVER : Date.now() + ms;
		db.update(devices).set({ mutedUntil }).where(eq(devices.ieee, device.ieee)).run();
		device.mutedUntil = mutedUntil; // the lifecycle reads memory, not the DB
	}
};
