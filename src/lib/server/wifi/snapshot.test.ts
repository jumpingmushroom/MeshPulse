import { describe, expect, it } from 'vitest';
import { openDb } from '../db/index';
import { wifiAps } from '../db/schema';
import { saveSettings } from '../settings';
import { createState } from '../types';
import { pollWifi, type WifiClient } from './poller';
import { loadWifiSnapshot } from './snapshot';
import type { WifiAp } from './unifi';

const MIN = 60_000;
const ap = (channel: number | null, cu: number | null, name = 'Kitchen AP'): WifiAp => ({ mac: 'aa', name, model: 'U6',
	radio24: channel === null ? null : { channel, width: 20, cuTotal: cu, cuSelfRx: 0, cuSelfTx: 0, numSta: 1, txPower: 10 } });
const setup = () => {
	const db = openDb(':memory:');
	const state = createState(0);
	state.bridge.info = { network: { channel: 11 } };
	const poll = async (aps: WifiAp[], now: number) => pollWifi({ db, state, client: { devices: async () => aps } as unknown as WifiClient }, now);
	return { db, state, poll };
};

describe('loadWifiSnapshot', () => {
	it('computes overlap, busy and clear minutes from the samples', async () => {
		const { db, state, poll } = setup();
		saveSettings(db, { wifiBusyPct: 60, wifiClearPct: 40 });
		for (let i = 0; i < 5; i++) await poll([ap(1, 20)], i * 5 * MIN);
		for (let i = 5; i < 9; i++) await poll([ap(1, 70)], i * 5 * MIN);
		const s = loadWifiSnapshot(db, state, 40 * MIN);
		expect(s).toMatchObject({ zigbeeChannel: 11, fresh: true });
		expect(s.aps[0]).toMatchObject({ channel: 1, overlaps: true, cuTotal: 70, cuMaxHour: 70, busyFor: 15, clearFor: 0 });
		await poll([ap(1, 20)], 45 * MIN);
		expect(loadWifiSnapshot(db, state, 45 * MIN).aps[0]).toMatchObject({ busyFor: 0, clearFor: 0 });
	});
	it('is stale after 30 minutes but keeps the last values', async () => {
		const { db, state, poll } = setup();
		await poll([ap(1, 20)], 0);
		const s = loadWifiSnapshot(db, state, 31 * MIN);
		expect(s.fresh).toBe(false);
		expect(s.aps[0]).toMatchObject({ channel: 1, overlaps: true });
	});
	it('has no overlap without a Zigbee channel, nor for an AP without a 2.4 GHz radio', async () => {
		const { db, state, poll } = setup();
		await poll([ap(1, 20), { ...ap(null, null), mac: 'bb' }], 0);
		state.bridge.info = null;
		expect(loadWifiSnapshot(db, state, 0)).toMatchObject({ zigbeeChannel: null, aps: [{ overlaps: false }, { overlaps: false }] });
		state.bridge.info = { network: { channel: 11 } };
		expect(loadWifiSnapshot(db, state, 0).aps.find((a) => a.mac === 'bb')).toMatchObject({ channel: null, overlaps: false });
	});
	it('drops an AP missing from the latest poll and keeps its area across a rename', async () => {
		const { db, state, poll } = setup();
		await poll([ap(1, 20), { ...ap(6, 20), mac: 'bb' }], 0);
		db.update(wifiAps).set({ area: 'Kitchen' }).run();
		await poll([ap(1, 20, 'Renamed')], 5 * MIN);
		const s = loadWifiSnapshot(db, state, 5 * MIN);
		expect(s.aps).toHaveLength(1);
		expect(s.aps[0]).toMatchObject({ name: 'Renamed', area: 'Kitchen' });
	});
});
