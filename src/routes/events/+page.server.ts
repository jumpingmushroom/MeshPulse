import { count, gte } from 'drizzle-orm';
import { events } from '../../lib/server/db/schema';
import { EVENT_KINDS, queryEvents } from '../../lib/server/events-page';
import { getRuntime } from '../../lib/server/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const { db, state } = getRuntime();
	const names = new Map([...state.devices.values()].map((d) => [d.ieee, d.friendlyName]));
	const now = Date.now();
	return {
		...queryEvents(db, new Set(names.keys()), url.searchParams, now),
		total: db.select({ n: count() }).from(events).where(gte(events.ts, now - 90 * 86_400_000)).get()?.n ?? 0,
		kinds: Object.entries(EVENT_KINDS),
		devices: [...names].sort((a, b) => a[1].localeCompare(b[1])),
		names: Object.fromEntries(names)
	};
};
