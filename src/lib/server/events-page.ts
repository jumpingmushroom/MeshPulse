import { and, desc, eq, gte } from 'drizzle-orm';
import type { Db } from './db';
import { events } from './db/schema';
import type { EventKind } from './types';

export const PAGE_SIZE = 100;
const DAYS_90 = 90 * 86_400_000;

export const EVENT_KINDS: Record<EventKind, string> = {
	availability: 'Availability',
	bridge_state: 'Bridge state',
	bridge_restart: 'Bridge restart',
	bridge_version: 'Bridge version',
	device_joined: 'Device joined',
	device_leave: 'Device left',
	device_announce: 'Device announce',
	device_interview: 'Device interview',
	battery_swap: 'Battery swap',
	route_error: 'Route error',
	leave_count_up: 'Leave count up',
	address_changed: 'Address changed'
};

export function queryEvents(db: Db, knownIeees: ReadonlySet<string>, params: URLSearchParams, now: number) {
	const kind = params.get('kind') || null;
	const device = params.get('device') || null;
	const n = Number(params.get('page'));
	const page = Number.isInteger(n) && n >= 1 ? n : 1;
	const unknown = (kind !== null && !(kind in EVENT_KINDS)) || (device !== null && !knownIeees.has(device));
	const base = { kind, device, page, unknown };
	if (unknown) return { ...base, rows: [], hasNext: false };
	const rows = db.select().from(events)
		.where(and(
			gte(events.ts, now - DAYS_90),
			kind ? eq(events.kind, kind) : undefined,
			device ? eq(events.ieee, device) : undefined
		))
		.orderBy(desc(events.ts), desc(events.id))
		.limit(PAGE_SIZE + 1).offset((page - 1) * PAGE_SIZE).all(); // one extra row tells us if a next page exists
	return { ...base, rows: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE };
}
