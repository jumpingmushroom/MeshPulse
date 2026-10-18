import { describe, expect, it } from 'vitest';
import { COORD, ctx, dev, DOOR, flip, H, HALL, LAMP, MIN, NOW } from '../../../../tests/helpers/ctx';
import { evaluate, newIssue, type IssueRow } from '../issues/lifecycle';
import { route } from '../mqtt/route';
import { evaluateRules, issueKey } from './index';
import { deviceSilentFor } from './bridge-offline';
import { deviceOffline } from './device-offline';

const silent = (gap: number, ago: number) => {
	const c = ctx();
	dev(c, DOOR).typicalGapMs = gap;
	dev(c, DOOR).lastSeenAt = NOW - ago;
	return c;
};

describe('device.offline', () => {
	it('warns for a router reported offline, with offlineSince in evidence', () => {
		const c = ctx();
		Object.assign(dev(c, LAMP), { availability: 'offline', offlineSince: NOW - 10 * MIN });
		const [f] = deviceOffline(c);
		expect(f).toMatchObject({ rule: 'device.offline', ieee: LAMP, severity: 'warning' });
		expect(f.summary).toContain('living/lamp');
		expect(f.evidence.offlineSince).toBe(NOW - 10 * MIN);
	});

	it('warns for an end device reported offline; offlineSince falls back to the latest offline event', () => {
		const c = ctx();
		dev(c, DOOR).availability = 'offline';
		c.events = [flip(DOOR, NOW - 3 * H, 'online', 'offline')];
		const [f] = deviceOffline(c);
		expect(f).toMatchObject({ ieee: DOOR, severity: 'warning' });
		expect(f.evidence.offlineSince).toBe(NOW - 3 * H);
	});

	it('never reports the coordinator', () => {
		const c = ctx();
		dev(c, COORD).availability = 'offline';
		expect(deviceOffline(c)).toEqual([]);
	});

	it('clamps the silence threshold to 2 h for a 30 min gap (3 × 30 min < 2 h)', () => {
		expect(deviceOffline(silent(30 * MIN, 2 * H + 1000))).toHaveLength(1);
		expect(deviceOffline(silent(30 * MIN, 2 * H - MIN))).toEqual([]);
	});

	it('uses 3 × the typical gap inside the clamp (1 h gap -> 3 h)', () => {
		expect(deviceOffline(silent(H, 3 * H + 1000))).toHaveLength(1);
		expect(deviceOffline(silent(H, 3 * H))).toEqual([]);
	});

	it('clamps the silence threshold to 25 h for a 10 h gap', () => {
		expect(deviceOffline(silent(10 * H, 25 * H + 1000))).toHaveLength(1);
		expect(deviceOffline(silent(10 * H, 25 * H - MIN))).toEqual([]);
	});

	it('has no silence finding without a typical gap', () => {
		expect(deviceOffline(silent(null as unknown as number, 100 * H))).toEqual([]);
	});

	it('does not apply silence to routers', () => {
		const c = silent(H, 4 * H);
		dev(c, DOOR).typicalGapMs = null;
		Object.assign(dev(c, LAMP), { typicalGapMs: H, lastSeenAt: NOW - 4 * H });
		expect(deviceOffline(c)).toEqual([]);
	});

	it('suppresses silence in grace unless already open', () => {
		const c = silent(H, 4 * H);
		c.state.bridge.restartedAt = NOW - 5 * MIN;
		expect(deviceOffline(c)).toEqual([]);
		c.open.add(issueKey('device.offline', DOOR));
		expect(deviceOffline(c)).toHaveLength(1);
	});

	it('uses lastSeenAt as offlineSince for silence', () => {
		const [f] = deviceOffline(silent(H, 4 * H));
		expect(f.evidence.offlineSince).toBe(NOW - 4 * H);
	});

	it('stops once online and seen again', () => {
		const c = silent(H, 4 * H);
		c.open.add(issueKey('device.offline', DOOR));
		dev(c, DOOR).lastSeenAt = NOW - MIN;
		expect(deviceOffline(c)).toEqual([]);
	});

	it('does not start silence from a gap that spans an MQTT outage', () => {
		const c = silent(H, 4 * H);
		c.state.monitor.connectedAt = NOW - 10 * MIN;
		expect(deviceOffline(c)).toEqual([]);
	});

	it('does not start silence from a gap that spans a Z2M restart (after grace)', () => {
		const c = silent(30 * MIN, 4 * H);
		c.state.bridge.restartedAt = NOW - 20 * MIN;
		expect(deviceOffline(c)).toEqual([]);
	});

	it('keeps an open silence issue and lastSeenAt evidence after reconnect', () => {
		const c = silent(H, 4 * H);
		c.state.monitor.connectedAt = NOW - 10 * MIN;
		c.open.add(issueKey('device.offline', DOOR));
		const [f] = deviceOffline(c);
		expect(f.evidence.offlineSince).toBe(NOW - 4 * H);
	});

	it('holds new offline findings while no device message for 60 s; an open one stays', () => {
		const c = ctx();
		Object.assign(dev(c, LAMP), { availability: 'offline', offlineSince: NOW - 10 * MIN });
		c.state.bridge.lastDeviceAt = NOW - 60_000;
		expect(deviceSilentFor(c, 60_000)).toBe(true);
		expect(deviceOffline(c)).toEqual([]);
		c.open.add(issueKey('device.offline', LAMP));
		expect(deviceOffline(c)).toHaveLength(1);
		c.open.clear();
		c.state.bridge.lastDeviceAt = NOW - 59_000;
		expect(deviceOffline(c)).toHaveLength(1);
	});

	it('after a network silence, holds devices offline from before the recovery for graceMin', () => {
		const c = ctx();
		c.state.bridge.deviceSince = NOW - 10 * MIN;
		Object.assign(dev(c, LAMP), { availability: 'offline', offlineSince: NOW - 30 * MIN });
		expect(deviceOffline(c)).toEqual([]);
		Object.assign(dev(c, HALL), { availability: 'offline', offlineSince: NOW - 5 * MIN }); // dropped after recovery
		expect(deviceOffline(c).map((f) => f.ieee)).toEqual([HALL]);
		c.state.bridge.deviceSince = NOW - 15 * MIN;
		expect(deviceOffline(c).map((f) => f.ieee)).toEqual([LAMP, HALL]);
	});

	it('outage then recovery with 30 routers still offline: no device issue in grace, one opens after it', () => {
		const c = ctx();
		const routers = Array.from({ length: 30 }, (_, i) => {
			const ieee = `0xrouter${i}`;
			c.state.devices.set(ieee, { ...dev(c, LAMP), ieee, friendlyName: `router_${i}`, recentSeen: [] });
			return ieee;
		});
		const issues: IssueRow[] = [];
		const counters = { seen: new Map(), missing: new Map() };
		const notes: string[] = [];
		for (let k = 0; k < 70; k++) {
			const now = NOW + k * MIN;
			route(c.state, { ts: now, topic: 'zigbee2mqtt/bridge/health', payload: { process: { uptime_sec: 100_000 + k * 60 } }, retain: false }, 'zigbee2mqtt');
			// devices silent from minute 4 to 24; routers drop at minute 12; 29 return at minute 35
			if (k < 4 || k >= 25) route(c.state, { ts: now, topic: 'zigbee2mqtt/living/lamp', payload: { state: 'ON' }, retain: false }, 'zigbee2mqtt');
			if (k === 12) for (const r of routers) {
				Object.assign(dev(c, r), { availability: 'offline', offlineSince: now });
				c.events.push(flip(r, now, 'online', 'offline'));
			}
			if (k === 35) for (const r of routers.slice(1)) Object.assign(dev(c, r), { availability: 'online', offlineSince: null });
			const open = issues.filter((i) => i.state !== 'resolved');
			const run = { ...c, now, open: new Set(open.map((i) => issueKey(i.rule, i.ieee))) };
			const r = evaluate({ findings: evaluateRules(run), issues: open, counters, mutedUntil: () => null, settings: c.settings, now });
			for (const f of r.opens) issues.push({ id: issues.length + 1, ...newIssue(f, now, true) });
			for (const { id, patch } of r.updates) Object.assign(issues[id - 1], patch);
			notes.push(...r.notify.map((n) => `${k} ${n.key}:${n.kind}`));
		}
		// device traffic resumed at minute 25: grace (15 min) ends at minute 40
		expect(notes).toEqual(['9 bridge.offline|:open', '28 bridge.offline|:resolved', `41 device.offline|${routers[0]}:open`]);
	});
});
