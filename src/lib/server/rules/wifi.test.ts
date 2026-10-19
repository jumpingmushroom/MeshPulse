import { describe, expect, it } from 'vitest';
import { ctx } from '../../../../tests/helpers/ctx';
import { evaluateRules, issueKey, RULE_DEFAULTS } from './index';
import { wifiBusyAir, wifiChannelOverlap, wifiUnreachable } from './wifi';
import type { WifiApSnap } from '../wifi/snapshot';

const AP: WifiApSnap = { mac: 'aa', name: 'Kitchen AP', area: 'Kitchen', channel: 1, width: 20, overlaps: true, cuTotal: 70, cuMaxHour: 70, busyFor: 0, clearFor: 0, changedAt: null };
const withWifi = (aps: Partial<WifiApSnap>[], over: Record<string, unknown> = {}) => {
	const c = ctx();
	c.wifi = { zigbeeChannel: 11, lastZigbeeChannel: 11, fresh: true, enabled: true, failures: 0, lastError: null, aps: aps.map((a) => ({ ...AP, ...a })), ...over };
	return c;
};

describe('wifi rules', () => {
	it('flags an overlapping AP with the free channels', () => {
		const [f] = wifiChannelOverlap(withWifi([{}]));
		expect(f).toMatchObject({ rule: 'wifi.channel_overlap', ieee: 'wifi:aa', severity: 'warning',
			summary: 'Kitchen AP uses Wi-Fi channel 1, which overlaps Zigbee channel 11', action: "Move the AP's 2.4 GHz radio to channel 6 or 11 in UniFi" });
	});
	it('is silent when off, without a Zigbee channel, for non-overlapping APs and APs without a radio', () => {
		expect(wifiChannelOverlap(withWifi([{}], { enabled: false }))).toEqual([]);
		expect(wifiChannelOverlap(withWifi([{}], { zigbeeChannel: null }))).toEqual([]);
		expect(wifiBusyAir(withWifi([{ busyFor: 30 }], { zigbeeChannel: null }))).toEqual([]);
		expect(wifiChannelOverlap(withWifi([{ overlaps: false }]))).toEqual([]);
		expect(wifiChannelOverlap(withWifi([{ channel: null, overlaps: false }]))).toEqual([]);
		expect(wifiChannelOverlap(withWifi([]))).toEqual([]); // AP absent from the latest poll: resolves
	});
	it('holds on stale values and resolves once the channel moves', () => {
		const stale = withWifi([{}], { fresh: false });
		expect(wifiChannelOverlap(stale)).toEqual([]); // stale data never opens an issue
		stale.open.add(issueKey('wifi.channel_overlap', 'wifi:aa'));
		expect(wifiChannelOverlap(stale)).toHaveLength(1);
		expect(wifiChannelOverlap(withWifi([{ channel: 6, overlaps: false }]))).toEqual([]);
	});
	it('busy air fires at 15 min and holds until 30 min clear', () => {
		expect(wifiBusyAir(withWifi([{ busyFor: 10 }]))).toEqual([]);
		expect(wifiBusyAir(withWifi([{ busyFor: 15 }]))).toHaveLength(1);
		const open = withWifi([{ clearFor: 20 }]);
		open.open.add(issueKey('wifi.busy_air', 'wifi:aa'));
		expect(wifiBusyAir(open)).toHaveLength(1);
		open.wifi!.aps[0].clearFor = 30;
		expect(wifiBusyAir(open)).toEqual([]);
	});
	it('holds open issues, and opens none, while the Zigbee channel is missing', () => {
		const c = withWifi([{}, { mac: 'bb', name: 'Hall' }], { zigbeeChannel: null });
		expect(wifiChannelOverlap(c)).toEqual([]);
		c.open.add(issueKey('wifi.channel_overlap', 'wifi:aa'));
		expect(wifiChannelOverlap(c).map((f) => f.ieee)).toEqual(['wifi:aa']);
		const none = withWifi([{}], { zigbeeChannel: null, lastZigbeeChannel: null });
		none.open.add(issueKey('wifi.channel_overlap', 'wifi:aa'));
		expect(wifiChannelOverlap(none)).toEqual([]); // never knew a channel
	});
	it('unreachable after 3 failures, only when enabled', () => {
		expect(wifiUnreachable(withWifi([], { failures: 2 }))).toEqual([]);
		expect(wifiUnreachable(withWifi([], { failures: 3, lastError: 'x' }))).toHaveLength(1);
		expect(wifiUnreachable(withWifi([], { failures: 3, enabled: false }))).toEqual([]);
	});
	it('wifi findings are not device-level and survive evaluateRules', () => {
		for (const r of ['wifi.channel_overlap', 'wifi.busy_air', 'wifi.unreachable'] as const) expect(RULE_DEFAULTS[r].deviceLevel).toBe(false);
		expect(evaluateRules(withWifi([{}])).map((f) => f.rule)).toEqual(['wifi.channel_overlap']);
	});
});
