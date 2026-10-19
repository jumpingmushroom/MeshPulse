import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/index';
import { events, wifiAps, wifiSamples } from '../db/schema';
import { getSettings } from '../settings';
import type { AppState } from '../types';
import { getWifiConfig, getWifiForm, type WifiConfig } from './config';
import { createUnifi, type WifiAp } from './unifi';

export interface WifiClient { devices(): Promise<WifiAp[]>; describe(): string; logout(): Promise<void> }
export interface PollDeps { db: Db; state: AppState; client: WifiClient }

/** One poll: exactly one `devices()` call, never a retry (a wrong password must not hammer the controller). */
export async function pollWifi(deps: PollDeps, now: number): Promise<{ ok: true; aps: number } | { ok: false; error: string }> {
	const { db, state, client } = deps;
	let aps: WifiAp[];
	try {
		aps = await client.devices();
	} catch (e) {
		state.wifi.failures++;
		state.wifi.lastError = e instanceof Error ? e.message : String(e);
		return { ok: false, error: state.wifi.lastError };
	}
	db.transaction((tx) => {
	for (const ap of aps) {
		// never touches `area`: it is the user's
		tx.insert(wifiAps).values({ mac: ap.mac, name: ap.name, model: ap.model, lastSeen: now })
			.onConflictDoUpdate({ target: wifiAps.mac, set: { name: ap.name, model: ap.model, lastSeen: now } }).run();
		const r = ap.radio24;
		if (!r) continue;
		const prev = tx.select().from(wifiSamples).where(eq(wifiSamples.mac, ap.mac)).orderBy(desc(wifiSamples.ts)).limit(1).get();
		tx.insert(wifiSamples).values({ ts: now, mac: ap.mac, channel: r.channel, width: r.width, cuTotal: r.cuTotal, cuSelfRx: r.cuSelfRx, cuSelfTx: r.cuSelfTx, numSta: r.numSta, txPower: r.txPower }).run();
		if (prev && (prev.channel !== r.channel || prev.width !== r.width))
			tx.insert(events).values({ ts: now, ieee: null, kind: 'wifi_channel', detail: { ap: ap.name, mac: ap.mac, from: prev.channel, to: r.channel, widthFrom: prev.width, widthTo: r.width } }).run();
	}
	});
	state.wifi = { lastOkAt: now, failures: 0, lastError: null };
	return { ok: true, aps: aps.length };
}

let busy = false;
/** One UniFi job at a time (poll or Test connection); null when another one is running. */
export async function exclusive<T>(fn: () => Promise<T>): Promise<T | null> {
	if (busy) return null;
	busy = true;
	try {
		return await fn();
	} finally {
		busy = false;
	}
}

const UNREADABLE = 'Stored password can no longer be decrypted — re-enter it in Settings';
const IDLE = { lastOkAt: null, failures: 0, lastError: null };

export interface WifiLoopDeps { db: Db; state: AppState; secretKey: string; create?: (c: WifiConfig) => WifiClient }

export function startWifi(deps: WifiLoopDeps): { stop(): Promise<void> } {
	const { db, state, secretKey, create = (c) => createUnifi(c) } = deps;
	let client: { key: string; c: WifiClient } | null = null;
	let current: Promise<unknown> = Promise.resolve();
	const drop = async () => {
		const old = client;
		client = null;
		if (old) await old.c.logout().catch(() => {});
	};
	const tick = async () => {
		try {
			const enabled = getSettings(db).wifiEnabled;
			const cfg = enabled ? getWifiConfig(db, secretKey) : null;
			if (!cfg) {
				await drop(); // disabled: re-enabling builds a fresh client
				if (!enabled) state.wifi = { ...IDLE };
				else if (getWifiForm(db).passwordSet) { state.wifi.failures++; state.wifi.lastError = UNREADABLE; } // no login attempt
				return;
			}
			const key = JSON.stringify(cfg);
			if (client && client.key !== key) await drop();
			client ??= { key, c: create(cfg) };
			await pollWifi({ db, state, client: client.c }, Date.now());
		} catch (e) {
			console.error('wifi: poll failed', e);
		}
	};
	const run = () => {
		if (busy) return; // a poll or a connection test is running
		current = exclusive(tick);
	};
	run();
	const timer = setInterval(run, 300_000);
	return {
		async stop() {
			clearInterval(timer);
			await Promise.race([current.then(drop), new Promise((r) => setTimeout(r, 5000))]);
		}
	};
}
