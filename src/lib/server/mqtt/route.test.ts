import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../../../tests/helpers/fixtures';
import { createState, type AppState, type Effect, type MqttMsg } from '../types';
import { route } from './route';

const B = 'zigbee2mqtt';
const MIN = 60_000;
const T = 1760000000000;
const LAMP = '0x00124b0000000002';
const HALL = '0x00124b0000000003';
const DOOR = '0x00124b0000000004';
const TEMP = '0x00124b0000000005';

const feed = (s: AppState, msgs: MqttMsg[]): Effect[] => msgs.flatMap((m) => route(s, m, B));
const load = (name: string) => {
	const s = createState(T);
	feed(s, loadFixture(name));
	return s;
};
const msg = (ts: number, topic: string, payload: unknown, retain = false): MqttMsg => ({
	ts,
	topic: `${B}/${topic}`,
	payload,
	retain
});
const events = (fx: Effect[]) => fx.flatMap((e) => (e.kind === 'event' ? [e.event] : []));
const withDevices = () => load('devices');

describe('route', () => {
	it('builds inventory from bridge/devices', () => {
		const s = withDevices();
		expect(s.devices.size).toBe(6);
		expect(s.byName.get('living/lamp')).toBe(LAMP);
		expect(s.devices.get(LAMP)!.type).toBe('Router');
		expect(s.devices.get(DOOR)!.type).toBe('EndDevice');
		expect(s.devices.get(TEMP)!.model).toBe('WSDCGQ11LM');
		expect(s.devicesLoaded).toBe(true);
	});

	it('buffers messages for unknown names until bridge/devices', () => {
		const s = createState(T);
		const msgs = loadFixture('startup');
		const before = msgs.findIndex((m) => m.topic.endsWith('/bridge/devices'));
		feed(s, msgs.slice(0, before));
		expect(s.pending.length).toBe(3);
		feed(s, msgs.slice(before));
		expect(s.pending.length).toBe(0);
		expect(s.devices.get(HALL)!.availability).toBe('offline');
		expect(s.devices.get(LAMP)!.availability).toBe('online');
	});

	it('caps pending at 5000, dropping the oldest', () => {
		const s = createState(T);
		for (let i = 0; i < 5002; i++) route(s, msg(T + i, 'ghost', { a: i }), B);
		expect(s.pending.length).toBe(5000);
		expect((s.pending[0].payload as { a: number }).a).toBe(2);
	});

	it('marks devices missing from bridge/devices as removed and clears on return', () => {
		const s = withDevices();
		const all = loadFixture('devices')[0];
		const list = all.payload as { ieee_address: string }[];
		route(s, { ...all, ts: T + 1000, payload: list.filter((d) => d.ieee_address !== DOOR) }, B);
		expect(s.devices.get(DOOR)!.removedAt).toBe(T + 1000);
		expect(s.devices.get(LAMP)!.removedAt).toBeNull();
		route(s, { ...all, ts: T + 2000 }, B);
		expect(s.devices.get(DOOR)!.removedAt).toBeNull();
	});

	it('rename keeps history keyed by IEEE', () => {
		const s = createState(T);
		const msgs = loadFixture('rename');
		feed(s, msgs.slice(0, 2));
		expect(s.devices.get(DOOR)!.recentSeen.length).toBe(1);
		const fx = feed(s, msgs.slice(2, 3));
		expect(fx).toContainEqual({ kind: 'dirty', ieee: DOOR });
		expect(s.byName.has('door_sensor')).toBe(false);
		expect(s.byName.get('front_door')).toBe(DOOR);
		feed(s, msgs.slice(3, 4));
		expect(s.devices.size).toBe(6);
		expect(s.devices.get(DOOR)!.lastSeenAt).toBe(T + 3000);
		expect(s.devices.get(DOOR)!.lqi).toBe(85);
		expect(feed(s, msgs.slice(4))).toEqual([]);
	});

	it('ignores /set, /get, groups and bridge/logging', () => {
		const s = withDevices();
		const snap = JSON.stringify([...s.devices]);
		const fx = feed(s, [
			msg(T + 1000, 'living/lamp/set', { state: 'ON' }),
			msg(T + 1000, 'living/lamp/get', { state: '' }),
			msg(T + 1000, 'living/lamp/set/brightness', 5),
			msg(T + 1000, 'bridge/request/permit_join', { time: 10 }),
			msg(T, 'some_group', { state: 'ON' }),
			msg(T, 'bridge/logging', { level: 'info', message: 'x' }),
			msg(T, 'bridge/response/device/rename', { status: 'ok' })
		]);
		expect(fx).toEqual([]);
		expect(JSON.stringify([...s.devices])).toBe(snap);
		// /set, /get and bridge/request (T+1000) are not live; groups, logging, response (T) are
		expect(s.bridge.lastLiveAt).toBe(T);
	});

	it('only live device payloads set lastDeviceAt and start a device run after a 2 min gap', () => {
		const s = withDevices();
		feed(s, [
			msg(T, 'living/lamp/availability', { state: 'online' }),
			msg(T, 'bridge/health', { process: { uptime_sec: 10 } }),
			msg(T, 'bridge/logging', { level: 'info', message: 'x' }),
			msg(T, 'some_group', { state: 'ON' }),
			msg(T, 'temp_sensor', { battery: 80 }, true)
		]);
		expect(s.bridge.lastLiveAt).toBe(T);
		expect(s.bridge.lastDeviceAt).toBeNull();
		route(s, msg(T + MIN, 'temp_sensor', { battery: 80 }), B);
		route(s, msg(T + 2 * MIN, 'living/lamp', { state: 'ON' }), B);
		expect(s.bridge).toMatchObject({ lastDeviceAt: T + 2 * MIN, deviceSince: T + MIN, silenceEndedAt: null, silenceMs: 0 });
		route(s, msg(T + 4 * MIN, 'living/lamp', { state: 'ON' }), B);
		expect(s.bridge).toMatchObject({ lastDeviceAt: T + 4 * MIN, deviceSince: T + 4 * MIN, silenceEndedAt: T + 4 * MIN, silenceMs: 2 * MIN });
		route(s, msg(T + 5 * MIN, 'living/lamp', { state: 'ON' }), B);
		expect(s.bridge).toMatchObject({ silenceEndedAt: T + 4 * MIN, silenceMs: 2 * MIN });
	});

	it('ignores malformed payloads', () => {
		const s = withDevices();
		for (const p of ['ON', '', '{"a":', null, 5]) {
			expect(route(s, msg(T, 'living/lamp', p), B)).toEqual([]);
		}
		expect(route(s, msg(T, 'bridge/devices', 'garbage'), B)).toEqual([]);
		expect(s.devices.size).toBe(6);
		expect(route(s, msg(T, 'bridge/info', 'x'), B)).toEqual([]);
		expect(route(s, { ts: T, topic: 'other/topic', payload: {}, retain: false }, B)).toEqual([]);
	});

	it('retained device state is not live', () => {
		const s = withDevices();
		route(s, msg(T, 'temp_sensor', { battery: 80 }, true), B);
		const d = s.devices.get(TEMP)!;
		expect(d.battery).toBe(80);
		expect(d.lastSeenAt).toBeNull();
		expect(d.recentSeen).toEqual([]);
		expect(s.bridge.lastLiveAt).toBeNull();
		route(s, msg(T, 'temp_sensor', { battery: 80, last_seen: '2026-10-16T10:00:00.000Z' }, true), B);
		expect(d.lastSeenAt).toBe(Date.parse('2026-10-16T10:00:00.000Z'));
	});

	it('retained garbage last_seen leaves lastSeenAt untouched', () => {
		const s = withDevices();
		route(s, msg(T, 'temp_sensor', { battery: 80, last_seen: 'garbage' }, true), B);
		expect(s.devices.get(TEMP)!.lastSeenAt).toBeNull();
	});

	it('live message updates seen, gaps and samples at most every 5 min', () => {
		const s = withDevices();
		const fx = feed(s, [
			msg(T, 'temp_sensor', { battery: 90, linkquality: 100 }),
			msg(T + MIN, 'temp_sensor', { battery: 90 }),
			msg(T + 6 * MIN, 'temp_sensor', { battery: 89 })
		]);
		const samples = fx.filter((e) => e.kind === 'sample');
		expect(samples.map((e) => e.ts)).toEqual([T, T + 6 * MIN]);
		expect(samples[1]).toMatchObject({ ieee: TEMP, lqi: 100, battery: 89 });
		const d = s.devices.get(TEMP)!;
		expect(d.recentSeen.length).toBe(3);
		expect(d.lastSeenAt).toBe(T + 6 * MIN);
		expect(s.bridge.lastLiveAt).toBe(T + 6 * MIN);
	});

	it('keeps only the last 21 live timestamps', () => {
		const s = withDevices();
		for (let i = 0; i < 30; i++) route(s, msg(T + i * MIN, 'button', { action: 'x' }), B);
		expect(s.devices.get('0x00124b0000000006')!.recentSeen.length).toBe(21);
	});

	it('learns typical gap as median of last 20 gaps once 5 gaps exist', () => {
		const run = (n: number) => {
			const s = withDevices();
			for (let i = 0; i < n; i++) route(s, msg(T + i * 10 * MIN, 'button', { a: 1 }), B);
			return s.devices.get('0x00124b0000000006')!.typicalGapMs;
		};
		expect(run(6)).toBe(600000);
		expect(run(5)).toBeNull();
		// even count: mean of the middle two, rounded
		const s = withDevices();
		[0, 1, 3, 6, 10, 15].forEach((m) => route(s, msg(T + m * MIN, 'button', { a: 1 }), B));
		// gaps 1,2,3,4,5 min -> odd; add one more for even
		route(s, msg(T + 21 * MIN + 1, 'button', { a: 1 }), B);
		// gaps sorted: 1,2,3,4,5,6 min (+1 ms) -> (3+4)/2 min, rounded
		expect(s.devices.get('0x00124b0000000006')!.typicalGapMs).toBe(3.5 * MIN);
	});

	it('bursts within a minute count once towards the typical gap', () => {
		const s = withDevices();
		for (let k = 0; k < 8; k++) for (let i = 0; i < 5; i++) route(s, msg(T + k * 30 * MIN + i * 400, 'button', { action: 'x' }), B);
		const d = s.devices.get('0x00124b0000000006')!;
		expect(d.typicalGapMs).toBe(30 * MIN);
		expect(d.lastSeenAt).toBe(T + 7 * 30 * MIN + 1600);
	});

	it('mains devices ignore voltage (metering plugs report volts)', () => {
		const s = withDevices();
		route(s, msg(T, 'hall_plug', { voltage: 230, power: 5 }), B);
		const d = s.devices.get(HALL)!;
		expect(d.voltage).toBeNull();
		expect(d.maxVoltage).toBeNull();
	});

	it('availability change emits one event', () => {
		const s = withDevices();
		const a = route(s, msg(T, 'hall_plug/availability', { state: 'offline' }), B);
		expect(events(a)).toHaveLength(1);
		expect(s.devices.get(HALL)!.offlineSince).toBe(T);
		expect(route(s, msg(T + 1000, 'hall_plug/availability', 'offline'), B)).toEqual([]);
		expect(s.devices.get(HALL)!.offlineSince).toBe(T);
		const b = route(s, msg(T + 2000, 'hall_plug/availability', 'online'), B);
		expect(events(b)).toMatchObject([{ kind: 'availability', ieee: HALL, detail: { from: 'offline', to: 'online' } }]);
		expect(s.devices.get(HALL)!.offlineSince).toBeNull();
		expect(b).toContainEqual({ kind: 'dirty', ieee: HALL });
	});

	it('bridge offline→online is a restart', () => {
		const s = createState(T);
		const fx = feed(s, loadFixture('restart').slice(0, 4));
		expect(events(fx).filter((e) => e.kind === 'bridge_restart')).toHaveLength(1);
		expect(s.bridge.restartedAt).toBe(T + 3000);
		expect(s.bridge.state).toBe('online');
		// the health sample right after a state restart does not double count
		expect(events(feed(s, loadFixture('restart').slice(4))).filter((e) => e.kind === 'bridge_restart')).toEqual([]);
	});

	it('uptime drop is a restart', () => {
		const s = createState(T);
		const h = (ts: number, up: number) => msg(ts, 'bridge/health', { process: { uptime_sec: up } });
		expect(events(route(s, h(T, 100), B))).toEqual([]);
		expect(events(route(s, h(T + 1000, 200), B))).toEqual([]);
		const fx = route(s, h(T + 2000, 5), B);
		expect(events(fx)).toMatchObject([{ kind: 'bridge_restart' }]);
		expect(s.bridge.restartedAt).toBe(T + 2000);
		expect(s.bridge.lastUptimeSec).toBe(5);
	});

	it('bridge/info tracks permit_join since and version changes', () => {
		const s = createState(T);
		const info = (ts: number, version: string, permit_join: boolean) => msg(ts, 'bridge/info', { version, permit_join });
		expect(route(s, info(T, '2.1.0', false), B)).toEqual([]);
		expect(s.bridge.version).toBe('2.1.0');
		route(s, info(T + 1000, '2.1.0', true), B);
		expect(s.bridge.permitJoin).toBe(true);
		expect(s.bridge.permitJoinSince).toBe(T + 1000);
		route(s, info(T + 2000, '2.1.0', true), B);
		expect(s.bridge.permitJoinSince).toBe(T + 1000);
		const fx = route(s, info(T + 3000, '2.2.0', false), B);
		expect(s.bridge.permitJoinSince).toBeNull();
		expect(events(fx)).toMatchObject([{ kind: 'bridge_version', detail: { from: '2.1.0', to: '2.2.0' } }]);
	});

	it('battery jump > 30 points is a swap', () => {
		const s = createState(T);
		const fx = feed(s, loadFixture('battery-swap'));
		expect(events(fx)).toMatchObject([{ kind: 'battery_swap', ieee: TEMP, detail: { from: 15, to: 100 } }]);
		expect(s.devices.get(TEMP)!.maxVoltage).toBe(3);

		const t = withDevices();
		route(t, msg(T, 'temp_sensor', { battery: 15 }), B);
		expect(events(route(t, msg(T + 1000, 'temp_sensor', { battery: 40 }), B))).toEqual([]);
	});

	it('a one-message dip after a rejoin is not a swap (compares with the last stored reading)', () => {
		const t = withDevices();
		route(t, msg(T, 'temp_sensor', { battery: 78 }), B); // stored as a sample
		route(t, msg(T + 60_000, 'temp_sensor', { battery: 9 }), B); // glitch, inside the 5-minute sample gap
		expect(events(route(t, msg(T + 63_000, 'temp_sensor', { battery: 83 }), B))).toEqual([]);
		expect(t.devices.get(TEMP)!.battery).toBe(83);
	});

	it('a low reading that was stored, then a full one, is still a swap', () => {
		const t = withDevices();
		route(t, msg(T, 'temp_sensor', { battery: 9 }), B);
		route(t, msg(T + 6 * 60_000, 'temp_sensor', { battery: 9 }), B);
		expect(events(route(t, msg(T + 7 * 60_000, 'temp_sensor', { battery: 100 }), B))).toMatchObject([{ kind: 'battery_swap', detail: { from: 9, to: 100 } }]);
	});

	it('bridge/event kinds become events', () => {
		const s = withDevices();
		const ev = (type: string, status?: string) =>
			events(route(s, msg(T, 'bridge/event', { type, data: { friendly_name: 'door_sensor', ieee_address: DOOR, status } }), B));
		expect(ev('device_announce')).toMatchObject([{ kind: 'device_announce', ieee: DOOR }]);
		expect(ev('device_leave')[0].kind).toBe('device_leave');
		expect(ev('device_joined')[0].kind).toBe('device_joined');
		expect(ev('device_interview', 'successful')).toMatchObject([
			{ kind: 'device_interview', detail: { status: 'successful', friendly_name: 'door_sensor' } }
		]);
		expect(ev('something_else')).toEqual([]);
	});

	it('emits dirty once per device per message and not when unchanged', () => {
		const s = withDevices();
		const fx = route(s, msg(T, 'temp_sensor', { battery: 90, voltage: 3000 }), B);
		expect(fx.filter((e) => e.kind === 'dirty')).toEqual([{ kind: 'dirty', ieee: TEMP }]);
		expect(route(s, msg(T, 'bridge/devices', loadFixture('devices')[0].payload), B)).toEqual([]);
	});

	it('counts live device messages per hour', () => {
		const s = withDevices();
		const hour = Math.floor(T / 3_600_000) * 3_600_000;
		feed(s, [msg(T, 'living/lamp', { linkquality: 50 }), msg(T + MIN, 'living/lamp', { linkquality: 51 }),
			msg(T + 2 * MIN, 'living/lamp', { linkquality: 52 }, true)]);
		expect(s.msgCounts.get(`${LAMP}|${hour}`)).toBe(2);
	});
});

describe('route bridge/logging', () => {
	const ping = (name: string, i: number, n: number, ieee = '') =>
		({ level: 'warning', message: `z2m: Failed to ping '${name}' (attempt ${i}/${n}, ${ieee ? `ZCL command ${ieee}/1 ` : ''}genBasic.read(["zclVersion"], {}) failed (Data request failed with error: 'MAC_NO_ACK' (0xe9)))` });
	const log = (s: AppState, p: unknown, retain = false) => events(route(s, msg(T, 'bridge/logging', p, retain), B));

	it('ping retries count once', () => {
		const s = withDevices();
		expect(log(s, ping('living/lamp', 1, 2, LAMP))).toEqual([]);
		expect(log(s, ping('living/lamp', 2, 2, LAMP))).toEqual([{ ts: T, ieee: LAMP, kind: 'route_error', detail: { kind: 'ping_failed', code: 'MAC_NO_ACK' } }]);
	});

	it('resolves the device by friendly name without an IEEE', () => {
		expect(log(withDevices(), ping('living/lamp', 2, 2))).toMatchObject([{ ieee: LAMP }]);
	});

	it('unknown device counts network-wide only', () => {
		const s = withDevices();
		expect(log(s, ping('nobody', 2, 2))).toMatchObject([{ ieee: null, kind: 'route_error' }]);
		expect(log(s, ping('nobody', 2, 2, '0x0000000000000bad'))).toMatchObject([{ ieee: null }]);
	});

	it('ignores retained lines, MQTT publish echoes and single-attempt pings of unavailable devices', () => {
		const s = withDevices();
		expect(log(s, ping('living/lamp', 2, 2, LAMP), true)).toEqual([]);
		expect(log(s, { level: 'info', message: "z2m:mqtt: MQTT publish: topic 'zigbee2mqtt/x', payload '{\"error\":\"Failed to ping 'x' (attempt 2/2, \"}'" })).toEqual([]);
		expect(log(s, ping('living/lamp', 1, 1, LAMP))).toEqual([]);
	});

	it('a command failure for an offline device counts network-wide only', () => {
		const fail = { level: 'error', message: `Publish 'set' 'state' to 'living/lamp' failed: 'Error: ZCL command ${LAMP}/1 genOnOff.on({}, {}) failed (Data request failed with error: 'NWK_NO_ROUTE' (0xcd))'` };
		const s = withDevices();
		s.devices.get(LAMP)!.availability = 'online';
		expect(log(s, fail)).toMatchObject([{ ieee: LAMP, detail: { kind: 'command_failed' } }]);
		s.devices.get(LAMP)!.availability = 'offline';
		expect(log(s, fail)).toMatchObject([{ ieee: null, detail: { kind: 'command_failed' } }]);
	});

	it('emits nothing for the real fixture (its final pings are all 1/1)', () => {
		expect(events(feed(createState(T), loadFixture('z2m-logging')))).toEqual([]);
	});

	it('live device messages count per minute; retained do not', () => {
		const s = withDevices();
		const live = (ts: number, retain = false) => msg(ts, 'living/lamp', { linkquality: 80 }, retain);
		feed(s, [live(T), live(T + 1000), live(T + 2000, true), live(T + MIN)]);
		expect(s.minutes.perMinute(LAMP, T + 2 * MIN, 2)).toEqual([2, 1]);
	});

	describe('bridge/health', () => {
		const health = (ts: number, devices: Record<string, unknown>, extra: Obj = {}) =>
			msg(ts, 'bridge/health', { process: { uptime_sec: 100 }, ...extra, devices });
		type Obj = Record<string, unknown>;
		const dev = (leave_count: number, network_address_changes: number) => ({ leave_count, network_address_changes });

		it('first health sample emits no deltas', () => {
			const s = createState(T);
			const fx = route(s, health(T, { [LAMP]: dev(4, 2) }), B);
			expect(events(fx)).toEqual([]);
			expect(fx).toContainEqual({ kind: 'health', ts: T, uptimeSec: 100, mqttQueued: null, devices: { [LAMP]: { leaves: 4, addr: 2 } } });
		});

		it('leave_count and address changes increase → events; a decrease re-baselines silently', () => {
			const s = createState(T);
			route(s, health(T, { [LAMP]: dev(1, 1), [DOOR]: dev(0, 0) }), B);
			const fx = route(s, health(T + MIN, { [LAMP]: dev(3, 1), [DOOR]: dev(0, 2), [TEMP]: dev(9, 9) }), B);
			expect(events(fx)).toEqual([
				{ ts: T + MIN, ieee: LAMP, kind: 'leave_count_up', detail: { delta: 2 } },
				{ ts: T + MIN, ieee: DOOR, kind: 'address_changed', detail: { delta: 2 } }
			]);
			expect(events(route(s, health(T + 2 * MIN, { [LAMP]: dev(0, 0), [DOOR]: dev(0, 2) }), B))).toEqual([]);
			expect(events(route(s, health(T + 3 * MIN, { [LAMP]: dev(1, 0) }), B)).map((e) => e.kind)).toEqual(['leave_count_up']);
		});

		it('stores mqtt queue, tolerating missing fields', () => {
			const s = createState(T);
			const fx = route(s, health(T, { [LAMP]: {}, bad: 5 }, { mqtt: { queued: 7 } }), B);
			expect(fx).toContainEqual({ kind: 'health', ts: T, uptimeSec: 100, mqttQueued: 7, devices: { [LAMP]: { leaves: 0, addr: 0 } } });
			expect(route(s, msg(T + 1, 'bridge/health', 'junk'), B)).toEqual([]);
		});
	});
});
