import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../db/index';
import { events, wifiAps, wifiSamples } from '../db/schema';
import { saveSettings } from '../settings';
import { createState } from '../types';
import { saveWifiConfig } from './config';
import { exclusive, pollWifi, startWifi, type WifiClient } from './poller';
import type { WifiAp } from './unifi';

const radio = (channel: number, width = 20) => ({ channel, width, cuTotal: 30, cuSelfRx: 5, cuSelfTx: 2, numSta: 4, txPower: 17 });
const ap = (channel: number | null, name = 'Kitchen AP'): WifiAp => ({ mac: 'aa:bb', name, model: 'U6', radio24: channel === null ? null : radio(channel) });
const client = (batches: WifiAp[][]): WifiClient => ({ devices: async () => batches.shift() ?? [], describe: () => '', logout: async () => {} });

describe('pollWifi', () => {
	it('writes APs and samples, and an event only when the channel changes', async () => {
		const db = openDb(':memory:');
		const state = createState(0);
		const c = client([[ap(1)], [ap(1)], [ap(6, 'Kitchen')]]);
		expect(await pollWifi({ db, state, client: c }, 1000)).toEqual({ ok: true, aps: 1 });
		db.update(wifiAps).set({ area: 'Kitchen' }).run();
		await pollWifi({ db, state, client: c }, 2000);
		expect(db.select().from(events).all()).toHaveLength(0);
		await pollWifi({ db, state, client: c }, 3000);
		expect(db.select().from(wifiSamples).all()).toHaveLength(3);
		const row = db.select().from(wifiAps).get()!;
		expect(row).toMatchObject({ name: 'Kitchen', area: 'Kitchen', lastSeen: 3000 }); // area untouched
		const ev = db.select().from(events).all();
		expect(ev).toHaveLength(1);
		expect(ev[0]).toMatchObject({ kind: 'wifi_channel', ieee: null, detail: { from: 1, to: 6, ap: 'Kitchen' } });
		expect(state.wifi).toEqual({ lastOkAt: 3000, failures: 0, lastError: null });
	});
	it('lists an AP without a 2.4 GHz radio but samples nothing', async () => {
		const db = openDb(':memory:');
		await pollWifi({ db, state: createState(0), client: client([[ap(null)]]) }, 1);
		expect(db.select().from(wifiAps).all()).toHaveLength(1);
		expect(db.select().from(wifiSamples).all()).toHaveLength(0);
	});
	it('a failing controller gets one attempt per poll and failures count up (12 polls = 12 calls)', async () => {
		const db = openDb(':memory:');
		const state = createState(0);
		const devices = vi.fn().mockRejectedValue(new Error('Wrong user or password'));
		for (let i = 0; i < 12; i++) expect(await pollWifi({ db, state, client: { devices, describe: () => '', logout: async () => {} } }, i)).toEqual({ ok: false, error: 'Wrong user or password' });
		expect(devices).toHaveBeenCalledTimes(12);
		expect(state.wifi).toEqual({ lastOkAt: null, failures: 12, lastError: 'Wrong user or password' });
	});
});

describe('startWifi', () => {
	it('polls only while enabled and builds a fresh client after re-enabling', async () => {
		vi.useFakeTimers();
		try {
			const db = openDb(':memory:');
			saveWifiConfig(db, 'k', { url: 'https://c', site: 'default', user: 'u', password: 'p' });
			const logout = vi.fn(async () => {});
			const create = vi.fn(() => ({ devices: async () => [ap(1)], describe: () => '', logout }));
			const state = createState(0);
			const loop = startWifi({ db, state, secretKey: 'k', create });
			await vi.advanceTimersByTimeAsync(300_000);
			expect(create).not.toHaveBeenCalled(); // off by default
			saveSettings(db, { wifiEnabled: true });
			await vi.advanceTimersByTimeAsync(300_000);
			await vi.advanceTimersByTimeAsync(300_000);
			expect(create).toHaveBeenCalledTimes(1);
			expect(db.select().from(wifiSamples).all()).toHaveLength(2);
			saveSettings(db, { wifiEnabled: false });
			await vi.advanceTimersByTimeAsync(300_000);
			expect(logout).toHaveBeenCalledTimes(1);
			saveSettings(db, { wifiEnabled: true });
			await vi.advanceTimersByTimeAsync(300_000);
			expect(create).toHaveBeenCalledTimes(2);
			loop.stop();
		} finally {
			vi.useRealTimers();
		}
	});

	it('an unreadable stored password is reported as a failure and makes no login', async () => {
		vi.useFakeTimers();
		try {
			const db = openDb(':memory:');
			saveWifiConfig(db, 'old-key', { url: 'https://c', site: 'default', user: 'u', password: 'p' });
			saveSettings(db, { wifiEnabled: true });
			const create = vi.fn();
			const state = createState(0);
			const loop = startWifi({ db, state, secretKey: 'new-key', create });
			await vi.advanceTimersByTimeAsync(300_000);
			expect(create).not.toHaveBeenCalled();
			expect(state.wifi.lastError).toBe('Stored password can no longer be decrypted — re-enter it in Settings');
			expect(state.wifi.failures).toBeGreaterThanOrEqual(2);
			await loop.stop();
		} finally {
			vi.useRealTimers();
		}
	});

	it('disabling resets the status; stop waits for an in-flight poll, then logs out', async () => {
		vi.useFakeTimers();
		try {
			const db = openDb(':memory:');
			saveWifiConfig(db, 'k', { url: 'https://c', site: 'default', user: 'u', password: 'p' });
			saveSettings(db, { wifiEnabled: true });
			const order: string[] = [];
			let release!: () => void;
			const gate = new Promise<void>((r) => (release = r));
			const create = () => ({ devices: async () => { await gate; order.push('devices'); return [ap(1)]; }, describe: () => '', logout: async () => { order.push('logout'); } });
			const state = createState(0);
			state.wifi = { lastOkAt: 5, failures: 2, lastError: 'x' };
			const loop = startWifi({ db, state, secretKey: 'k', create });
			await vi.advanceTimersByTimeAsync(0);
			const stopped = loop.stop();
			release();
			await stopped;
			expect(order).toEqual(['devices', 'logout']);
			const off = openDb(':memory:');
			const st2 = createState(0);
			st2.wifi = { lastOkAt: 5, failures: 2, lastError: 'x' };
			const l2 = startWifi({ db: off, state: st2, secretKey: 'k', create });
			await vi.advanceTimersByTimeAsync(0);
			expect(st2.wifi).toEqual({ lastOkAt: null, failures: 0, lastError: null });
			await l2.stop();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('exclusive', () => {
	it('refuses a second job while one runs', async () => {
		let release!: () => void;
		const first = exclusive(() => new Promise<string>((r) => (release = () => r('a'))));
		expect(await exclusive(async () => 'b')).toBeNull();
		release();
		expect(await first).toBe('a');
		expect(await exclusive(async () => 'c')).toBe('c');
	});
});
