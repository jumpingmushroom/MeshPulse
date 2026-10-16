import { describe, expect, it } from 'vitest';
import type { MqttMsg } from '../src/lib/server/types';
import { loadFixture } from './helpers/fixtures';
import { simulate } from './helpers/simulate';

const T = 1760000000000;
const S = 1000;
const MIN = 60 * S;
const TEMP = '0x00124b0000000005';
const DOOR = '0x00124b0000000004';
const DEVICE_RULES = ['device.offline', 'device.flapping', 'battery.low'];

type Sim = ReturnType<typeof simulate>;
const rules = (r: Sim) => r.issues.map((i) => i.rule);
const kinds = (r: Sim) => r.notifies.map((n) => `${n.key}:${n.kind}:${n.severity}`);

/** The fixture is offline 40 s; a longer `offlineMs` moves the restart burst later and drops health Z2M couldn't send. */
function z2mRestart(offlineMs: number) {
	const off = T + 19 * MIN + 50 * S;
	const on = off + 40 * S;
	const msgs = loadFixture('z2m-restart').flatMap((m) => {
		const health = m.topic.endsWith('bridge/health');
		if (!health && m.ts >= on && m.ts < on + 5 * S) return [{ ...m, ts: m.ts - 40 * S + offlineMs }];
		return health && m.ts > off && m.ts < off + offlineMs ? [] : [m];
	});
	return simulate(msgs, { until: T + 90 * MIN });
}

const batterySwap = () => {
	const [devices, low, swap] = loadFixture('battery-swap');
	return simulate([devices, { ...low, payload: { battery: 15, voltage: 2550 } }, { ...swap, ts: T + 10 * MIN }],
		{ until: T + 14 * MIN }); // stop before grace ends: the fixture has no bridge traffic
};

const renamed = () => {
	const [devices, , rename, after] = loadFixture('rename');
	const low: MqttMsg = { ts: T + S, topic: 'zigbee2mqtt/door_sensor', payload: { battery: 20 }, retain: false };
	return simulate([devices, low, { ...rename, ts: T + 5 * MIN }, { ...after, ts: T + 5 * MIN + S }], { until: T + 14 * MIN });
};

const mqttLost = () =>
	simulate(loadFixture('mqtt-lost'), {
		until: T + 40 * MIN,
		hooks: {
			[T + 19 * MIN + 59 * S]: (s) => Object.assign(s.monitor, { connected: false, downSince: T + 19 * MIN + 59 * S }),
			[T + 24 * MIN]: (s) => Object.assign(s.monitor, { connected: true, downSince: null, connectedAt: T + 24 * MIN })
		}
	});

const massReconnect = () => simulate(loadFixture('mass-reconnect'), { until: T + 90 * MIN });

describe('scenarios', () => {
	it('Z2M restart', () => {
		const r = z2mRestart(40 * S);
		expect(r.issues.map((i) => [i.rule, i.severity])).toEqual([['bridge.restarted', 'info']]);
		expect(kinds(r)).toEqual(['bridge.restarted|:open:info', 'bridge.restarted|:resolved:info']);
	});

	it('Z2M restart, offline 3 min', () => {
		const r = z2mRestart(3 * MIN);
		expect(rules(r).filter((x) => x === 'bridge.offline')).toHaveLength(1);
		expect(kinds(r).filter((k) => k.startsWith('bridge.offline'))).toEqual(['bridge.offline|:open:critical', 'bridge.offline|:resolved:critical']);
		expect(rules(r).filter((x) => DEVICE_RULES.includes(x))).toEqual([]);
	});

	it('mass reconnect after restart', () => {
		const r = massReconnect();
		expect(rules(r).filter((x) => DEVICE_RULES.includes(x))).toEqual([]);
		expect(r.notifies.filter((n) => n.key.startsWith('device.'))).toEqual([]);
		// control: the same flaps without the Z2M restart (no state flip, monotonic uptime) do open flapping
		const noRestart = loadFixture('mass-reconnect')
			.filter((m) => !m.topic.endsWith('bridge/state') || m.ts === T)
			.map((m) => (m.topic.endsWith('bridge/health') ? { ...m, payload: { process: { uptime_sec: (m.ts - T) / S + 5000 } } } : m));
		const control = simulate(noRestart, { until: T + 90 * MIN });
		expect(rules(control).filter((x) => x === 'device.flapping')).toHaveLength(20);
		expect(rules(control).filter((x) => x !== 'device.flapping')).toEqual([]);
	});

	it('battery swap', () => {
		const r = batterySwap();
		expect(r.events.filter((e) => e.kind === 'battery_swap')).toHaveLength(1);
		expect(r.issues.map((i) => [i.rule, i.ieee, i.state])).toEqual([['battery.low', TEMP, 'resolved']]);
		expect(kinds(r)).toEqual([`battery.low|${TEMP}:open:critical`, `battery.low|${TEMP}:resolved:critical`]);
	});

	it('renamed device', () => {
		const r = renamed();
		expect(r.issues).toHaveLength(1);
		expect(r.issues[0]).toMatchObject({ rule: 'battery.low', ieee: DOOR, state: 'open' });
		expect(r.issues[0].summary).toContain('front_door');
		expect(kinds(r)).toEqual([`battery.low|${DOOR}:open:warning`]);
	});

	it('MQTT lost', () => {
		const r = mqttLost();
		const lost = r.issues.filter((i) => i.rule === 'monitor.mqtt_lost');
		expect(lost).toMatchObject([{ severity: 'critical', state: 'resolved', openedAt: T + 21 * MIN }]);
		expect(kinds(r)).toEqual(['monitor.mqtt_lost|:open:critical', 'monitor.mqtt_lost|:resolved:critical']);
		expect(rules(r).filter((x) => DEVICE_RULES.includes(x))).toEqual([]);
		// without the outage the same door_sensor drop does open
		const control = simulate(loadFixture('mqtt-lost'), { until: T + 40 * MIN });
		expect(rules(control)).toEqual(['device.offline']);
	});

	it('no duplicate notifies', () => {
		const all = [z2mRestart(40 * S), z2mRestart(3 * MIN), massReconnect(), batterySwap(), renamed(), mqttLost()];
		for (const r of all) {
			const ks = r.notifies.filter((n) => n.kind !== 'reminder').map((n) => `${n.key}:${n.kind}:${n.severity}`);
			expect(new Set(ks).size).toBe(ks.length);
		}
	});
});
