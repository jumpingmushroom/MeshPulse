import type { AppState, DeviceState, Effect, EventKind, MqttMsg } from '../types';
import { parseRouteError } from './logparse';
import { normaliseVoltage, parseAvailability, parseJson, parseLastSeen } from './parse';

const PENDING_CAP = 5000;
const SAMPLE_EVERY_MS = 5 * 60_000;
const SEEN_KEEP = 21; // 20 gaps
const SEEN_MIN_GAP_MS = 60_000; // a burst (button presses, multi-report) counts as one sighting
const MIN_GAPS = 5;
const SWAP_JUMP = 30;
const BRIDGE_EVENTS: readonly EventKind[] = ['device_joined', 'device_leave', 'device_announce', 'device_interview'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Columns persisted in `devices`; a change in any of them emits `dirty`.
const persisted = (d: DeviceState) =>
	JSON.stringify([d.friendlyName, d.type, d.powerSource, d.model, d.vendor, d.firmware, d.networkAddress,
		d.availability, d.lastSeenAt, d.removedAt, d.typicalGapMs, d.maxVoltage]);

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Mutates `state` for one MQTT message and returns the persistence effects. Never throws. */
export function route(state: AppState, msg: MqttMsg, baseTopic: string): Effect[] {
	try {
		const fx: Effect[] = [];
		const before = new Map<string, string | null>(); // ieee -> persisted() at first touch
		const touch = (d: DeviceState) => {
			if (!before.has(d.ieee)) before.set(d.ieee, persisted(d));
			return d;
		};
		handle(state, msg, baseTopic, fx, touch);
		for (const [ieee, was] of before) {
			const d = state.devices.get(ieee);
			if (d && persisted(d) !== was) fx.push({ kind: 'dirty', ieee });
		}
		return fx;
	} catch (e) {
		console.error(`route: failed on topic ${msg.topic}`, e);
		return [];
	}
}

function handle(
	state: AppState,
	msg: MqttMsg,
	base: string,
	fx: Effect[],
	touch: (d: DeviceState) => DeviceState
) {
	if (!msg.topic.startsWith(base + '/')) return;
	const rest = msg.topic.slice(base.length + 1);
	// /set, /get and bridge/request come from other clients, not from Z2M
	if (rest.startsWith('bridge/request/') || (!rest.startsWith('bridge/') && /(^|\/)(set|get)(\/|$)/.test(rest))) return;
	if (!msg.retain) state.bridge.lastLiveAt = Math.max(state.bridge.lastLiveAt ?? 0, msg.ts);

	const payload = parseJson(msg.payload);
	const event = (kind: EventKind, ieee: string | null, detail: Obj) =>
		fx.push({ kind: 'event', event: { ts: msg.ts, ieee, kind, detail } });

	if (rest.startsWith('bridge/')) {
		const sub = rest.slice(7);
		if (sub === 'devices') return onDevices(state, msg, base, payload, fx, touch);
		if (sub === 'info') return onInfo(state, msg, payload, event);
		if (sub === 'state') return onBridgeState(state, msg, payload, event);
		if (sub === 'health') return onHealth(state, msg, payload, event);
		if (sub === 'event') return onBridgeEvent(state, payload, event);
		if (sub === 'logging' && !msg.retain) return onLogging(state, payload, event);
		return;
	}

	if (rest.endsWith('/availability')) {
		const ieee = state.byName.get(rest.slice(0, -13));
		if (ieee) return onAvailability(state.devices.get(ieee)!, msg, payload, touch, event);
	}
	const ieee = state.byName.get(rest);
	if (ieee) return onDevice(state, state.devices.get(ieee)!, msg, payload, fx, touch, event);
	if (!state.devicesLoaded) {
		state.pending.push(msg);
		if (state.pending.length > PENDING_CAP) state.pending.shift();
	}
}

type Emit = (kind: EventKind, ieee: string | null, detail: Obj) => void;

function onDevices(state: AppState, msg: MqttMsg, base: string, payload: unknown, fx: Effect[], touch: (d: DeviceState) => DeviceState) {
	if (!Array.isArray(payload)) return;
	const seen = new Set<string>();
	state.byName.clear();
	for (const e of payload) {
		const ieee = isObj(e) ? str(e.ieee_address) : null;
		if (!isObj(e) || !ieee) continue;
		seen.add(ieee);
		let d = state.devices.get(ieee);
		if (!d) {
			d = {
				ieee, friendlyName: '', type: 'EndDevice', powerSource: null, model: null, vendor: null, firmware: null,
				networkAddress: null, availability: null, lastSeenAt: null, removedAt: null, mutedUntil: null, tags: [],
				ignoreRules: [], typicalGapMs: null, maxVoltage: null, lqi: null, battery: null, voltage: null,
				batteryLow: null, recentSeen: [], lastSampleAt: null, offlineSince: null
			};
			// register as "new" so a dirty is emitted even if nothing else differs
			touch(d);
			state.devices.set(ieee, d);
		}
		touch(d);
		const def = isObj(e.definition) ? e.definition : {};
		d.friendlyName = str(e.friendly_name) ?? d.friendlyName;
		// unknown type strings are kept as-is (cast) and behave as end devices downstream
		d.type = (str(e.type) ?? d.type) as DeviceState['type'];
		d.powerSource = str(e.power_source);
		d.model = str(def.model);
		d.vendor = str(def.vendor);
		d.firmware = e.software_build_id == null ? null : String(e.software_build_id);
		d.networkAddress = num(e.network_address);
		d.removedAt = null;
		state.byName.set(d.friendlyName, ieee);
	}
	for (const d of state.devices.values()) if (!seen.has(d.ieee) && d.removedAt === null) touch(d).removedAt = msg.ts;

	state.devicesLoaded = true;
	const replay = state.pending.splice(0);
	for (const m of replay) fx.push(...route(state, m, base));
}

function onInfo(state: AppState, msg: MqttMsg, p: unknown, event: Emit) {
	if (!isObj(p)) return;
	const b = state.bridge;
	const version = str(p.version);
	if (version && b.version && version !== b.version) event('bridge_version', null, { from: b.version, to: version });
	if (version) b.version = version;
	const open = p.permit_join === true;
	if (open !== b.permitJoin) b.permitJoinSince = open ? msg.ts : null;
	b.permitJoin = open;
	b.info = p;
}

function onBridgeState(state: AppState, msg: MqttMsg, p: unknown, event: Emit) {
	const next = parseAvailability(p);
	const b = state.bridge;
	if (!next || next === b.state) return;
	const prev = b.state;
	b.state = next;
	if (prev) event('bridge_state', null, { from: prev, to: next });
	if (next === 'online') b.onlineSince = msg.ts;
	if (prev === 'offline' && next === 'online') {
		b.restartedAt = msg.ts;
		b.lastUptimeSec = null; // the next health sample would otherwise count the same restart again
		event('bridge_restart', null, { reason: 'state' });
	}
}

function onHealth(state: AppState, msg: MqttMsg, p: unknown, event: Emit) {
	const up = isObj(p) && isObj(p.process) ? num(p.process.uptime_sec) : null;
	if (up === null) return;
	const b = state.bridge;
	if (b.lastUptimeSec !== null && up < b.lastUptimeSec) {
		b.restartedAt = msg.ts;
		event('bridge_restart', null, { reason: 'uptime', from: b.lastUptimeSec, to: up });
	}
	b.lastUptimeSec = up;
}

function onBridgeEvent(state: AppState, p: unknown, event: Emit) {
	if (!isObj(p) || !isObj(p.data)) return;
	const kind = BRIDGE_EVENTS.find((k) => k === p.type);
	if (!kind) return;
	const name = str(p.data.friendly_name);
	const ieee = str(p.data.ieee_address) ?? (name ? (state.byName.get(name) ?? null) : null);
	const detail: Obj = { friendly_name: name };
	if (p.data.status !== undefined) detail.status = p.data.status;
	event(kind, ieee, detail);
}

function onLogging(state: AppState, p: unknown, event: Emit) {
	const r = parseRouteError(p);
	if (!r?.final) return; // ping attempts are logged one by one; the final one stands for the ping
	if (r.kind === 'ping_failed' && r.attempts === 1) return; // Z2M pings devices already unavailable once (`available ? 2 : 1`)
	const id = r.ieee ?? (r.name ? state.byName.get(r.name) : undefined);
	const d = id ? state.devices.get(id) : undefined;
	event('route_error', d?.ieee ?? null, { kind: r.kind, code: r.code });
}

function onAvailability(d: DeviceState, msg: MqttMsg, p: unknown, touch: (d: DeviceState) => DeviceState, event: Emit) {
	const next = parseAvailability(p);
	if (!next || next === d.availability) return;
	const prev = d.availability;
	touch(d).availability = next;
	d.offlineSince = next === 'offline' ? msg.ts : null;
	event('availability', d.ieee, { from: prev, to: next });
}

function onDevice(
	state: AppState,
	d: DeviceState,
	msg: MqttMsg,
	p: unknown,
	fx: Effect[],
	touch: (d: DeviceState) => DeviceState,
	event: Emit
) {
	if (!isObj(p)) return;
	touch(d);
	const lqi = num(p.linkquality);
	if (lqi !== null) d.lqi = lqi;
	const battery = num(p.battery);
	if (battery !== null) {
		if (d.battery !== null && battery - d.battery > SWAP_JUMP) event('battery_swap', d.ieee, { from: d.battery, to: battery });
		d.battery = battery;
	}
	// mains plugs with metering report line volts (230), which would read as a 0.23 V coin cell
	const voltage = d.powerSource === 'Battery' ? normaliseVoltage(p.voltage) : null;
	if (voltage !== null) {
		d.voltage = voltage;
		d.maxVoltage = Math.max(d.maxVoltage ?? 0, voltage);
	}
	if (typeof p.battery_low === 'boolean') d.batteryLow = p.battery_low;

	if (!msg.retain) {
		const k = `${d.ieee}|${msg.ts - (msg.ts % 3_600_000)}`;
		state.msgCounts.set(k, (state.msgCounts.get(k) ?? 0) + 1);
	}
	if (msg.retain) {
		// retained state is not live: only an explicit last_seen counts
		const seen = parseLastSeen(p.last_seen, NaN);
		if (!Number.isNaN(seen)) d.lastSeenAt = Math.max(d.lastSeenAt ?? 0, seen);
		return;
	}
	d.lastSeenAt = parseLastSeen(p.last_seen, msg.ts);
	const prevSeen = d.recentSeen.at(-1);
	if (prevSeen === undefined || msg.ts - prevSeen >= SEEN_MIN_GAP_MS) d.recentSeen = [...d.recentSeen, msg.ts].slice(-SEEN_KEEP);
	if (d.recentSeen.length > MIN_GAPS) {
		d.typicalGapMs = median(d.recentSeen.slice(1).map((t, i) => t - d.recentSeen[i]));
	}
	if (d.lastSampleAt === null || msg.ts - d.lastSampleAt >= SAMPLE_EVERY_MS) {
		d.lastSampleAt = msg.ts;
		fx.push({ kind: 'sample', ieee: d.ieee, ts: msg.ts, lqi: d.lqi, battery: d.battery, voltage: d.voltage });
	}
}
