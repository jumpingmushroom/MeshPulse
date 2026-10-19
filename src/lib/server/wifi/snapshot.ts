import { and, desc, eq, gte, max } from 'drizzle-orm';
import type { Db } from '../db/index';
import { events, wifiAps, wifiSamples } from '../db/schema';
import { getSettings } from '../settings';
import type { AppState } from '../types';
import { overlaps } from './overlap';

const MIN = 60_000;
export const FRESH_MS = 30 * MIN;

export interface WifiApSnap {
	mac: string; name: string; area: string | null; channel: number | null; width: number; overlaps: boolean;
	cuTotal: number | null; cuMaxHour: number | null; busyFor: number; clearFor: number; changedAt: number | null;
}
/** `lastZigbeeChannel`: the channel last seen in this process, used to hold issues while bridge/info is missing. */
export interface WifiSnapshot { zigbeeChannel: number | null; lastZigbeeChannel: number | null; fresh: boolean; aps: WifiApSnap[] }

const GAP_MS = 10 * MIN; // twice the poll interval: a longer gap is an outage, not a continuous run
const lastChannel = new WeakMap<AppState, number>();

/** Minutes the newest samples have continuously satisfied `test` (newest first in `rows`). */
function runMinutes(rows: { ts: number; cuTotal: number | null }[], test: (cu: number) => boolean): number {
	let oldest = rows[0]?.ts ?? 0;
	let n = 0;
	for (const r of rows) {
		if (r.cuTotal === null || !test(r.cuTotal) || (n > 0 && oldest - r.ts > GAP_MS)) break;
		oldest = r.ts;
		n++;
	}
	return n === 0 ? 0 : (rows[0].ts - oldest) / MIN;
}

/**
 * The APs of the latest successful poll with the values from it. When polling has stopped (`fresh: false`)
 * the last values stay, so the rules hold rather than judge missing data.
 */
export function loadWifiSnapshot(db: Db, state: AppState, now: number): WifiSnapshot {
	const zc = Number(state.bridge.info?.network?.channel);
	const zigbeeChannel = Number.isInteger(zc) && zc >= 11 && zc <= 26 ? zc : null;
	if (zigbeeChannel !== null) lastChannel.set(state, zigbeeChannel);
	const lastZigbeeChannel = lastChannel.get(state) ?? null;
	const fresh = state.wifi.lastOkAt !== null && now - state.wifi.lastOkAt <= FRESH_MS;
	const { wifiEnabled, wifiBusyPct, wifiClearPct } = getSettings(db);
	const last = wifiEnabled ? db.select({ t: max(wifiAps.lastSeen) }).from(wifiAps).get()?.t ?? null : null;
	// a successful poll newer than every lastSeen returned no APs at all
	if (last === null || (state.wifi.lastOkAt !== null && state.wifi.lastOkAt > last)) return { zigbeeChannel, lastZigbeeChannel, fresh, aps: [] };
	const zc2 = zigbeeChannel ?? lastZigbeeChannel;
	const changes = db.select().from(events).where(and(eq(events.kind, 'wifi_channel'), gte(events.ts, now - 24 * 60 * MIN))).all();
	return {
		zigbeeChannel, lastZigbeeChannel, fresh,
		aps: db.select().from(wifiAps).where(eq(wifiAps.lastSeen, last)).all().map((ap) => {
			const rows = db.select().from(wifiSamples).where(and(eq(wifiSamples.mac, ap.mac), gte(wifiSamples.ts, last - 2 * 60 * MIN))).orderBy(desc(wifiSamples.ts)).all();
			const cur = rows[0]?.ts === last ? rows[0] : null; // no sample in the latest poll: no 2.4 GHz radio now
			const hour = rows.filter((s) => s.ts > last - 60 * MIN && s.cuTotal !== null);
			return {
				mac: ap.mac, name: ap.name, area: ap.area,
				channel: cur?.channel ?? null, width: cur?.width ?? 20,
				overlaps: !!cur && zc2 !== null && overlaps(zc2, cur.channel, cur.width),
				cuTotal: cur?.cuTotal ?? null,
				cuMaxHour: hour.length ? Math.max(...hour.map((s) => s.cuTotal!)) : null,
				busyFor: cur ? runMinutes(rows, (c) => c >= wifiBusyPct) : 0,
				clearFor: cur ? runMinutes(rows, (c) => c < wifiClearPct) : 0,
				changedAt: changes.filter((e) => e.detail?.mac === ap.mac).reduce<number | null>((t, e) => Math.max(t ?? 0, e.ts), null)
			};
		})
	};
}
