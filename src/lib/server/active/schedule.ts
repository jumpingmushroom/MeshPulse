import { eq } from 'drizzle-orm';
import type { Db } from '../db/index';
import { settings } from '../db/schema';
import { issueKey } from '../rules/types';
import type { AppState } from '../types';

const HOUR = 3_600_000;
const OUTAGES = ['bridge.offline', 'monitor.mqtt_lost', 'network.mass_offline', 'network.storm'];

/** Local day `YYYY-MM-DD` to run for, or null. Compares local wall-clock time, so a DST change cannot repeat or skip a run. */
export function due(now: number, at: '03:30' | '04:00', lastDay: string, tz: string): string | null {
	const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
		.formatToParts(now).map((x) => [x.type, x.value]));
	const day = `${p.year}-${p.month}-${p.day}`;
	return `${p.hour}:${p.minute}` >= at && day !== lastDay ? day : null;
}

/** Why an active request must not run now, or null. */
export function activeGuard(state: AppState, open: Set<string>, now: number, busy: boolean): string | null {
	if (!state.monitor.connected) return 'MQTT is disconnected';
	if (state.bridge.state !== 'online') return 'Zigbee2MQTT bridge is not online';
	const rule = OUTAGES.find((r) => open.has(issueKey(r, null)));
	if (rule) return `An outage is open (${rule})`;
	if (now - Math.max(state.monitor.startedAt, state.bridge.restartedAt ?? 0) < HOUR) return 'Zigbee2MQTT or MeshPulse restarted less than an hour ago';
	if (busy) return 'A request is already running';
	return null;
}

// not DEFAULT_SETTINGS keys: raw rows, so the settings form never validates or overwrites them
export const DAY_KEY = { coordinator_check: 'activeCheckDay', networkmap: 'activeScanDay' } as const;

export function lastDay(db: Db, kind: keyof typeof DAY_KEY): string {
	const v = db.select().from(settings).where(eq(settings.key, DAY_KEY[kind])).get()?.value;
	return typeof v === 'string' ? v : '';
}

export function setLastDay(db: Db, kind: keyof typeof DAY_KEY, day: string): void {
	db.insert(settings).values({ key: DAY_KEY[kind], value: day }).onConflictDoUpdate({ target: settings.key, set: { value: day } }).run();
}
