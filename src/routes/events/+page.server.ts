import { EVENT_KINDS, queryEvents } from '../../lib/server/events-page';
import { getRuntime } from '../../lib/server/runtime';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const { db, state } = getRuntime();
	const names = new Map([...state.devices.values()].map((d) => [d.ieee, d.friendlyName]));
	return {
		...queryEvents(db, new Set(names.keys()), url.searchParams, Date.now()),
		kinds: Object.entries(EVENT_KINDS),
		devices: [...names].sort((a, b) => a[1].localeCompare(b[1])),
		names: Object.fromEntries(names)
	};
};
