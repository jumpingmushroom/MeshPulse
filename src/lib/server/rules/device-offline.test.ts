import { describe, expect, it } from 'vitest';
import { COORD, ctx, dev, DOOR, flip, H, HALL, LAMP, MIN, NOW } from '../../../../tests/helpers/ctx';
import { evaluate, newIssue, type IssueRow } from '../issues/lifecycle';
import { route } from '../mqtt/route';
import { evaluateRules, issueKey, type RuleContext } from './index';
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

	it('holds new offline findings for graceMin after a real silence (>= bridgeSilenceMin) or a Z2M restart', () => {
		const c = ctx();
		Object.assign(c.state.bridge, { silenceEndedAt: NOW - 10 * MIN, silenceMs: 5 * MIN });
		Object.assign(dev(c, LAMP), { availability: 'offline', offlineSince: NOW - 30 * MIN });
		Object.assign(dev(c, HALL), { availability: 'offline', offlineSince: NOW - 5 * MIN }); // Z2M still catching up
		expect(deviceOffline(c)).toEqual([]);
		c.state.bridge.silenceEndedAt = NOW - 15 * MIN;
		expect(deviceOffline(c).map((f) => f.ieee)).toEqual([LAMP, HALL]);
		// a short gap is not a silence: no hold
		Object.assign(c.state.bridge, { silenceEndedAt: NOW - MIN, silenceMs: 5 * MIN - 1 });
		expect(deviceOffline(c).map((f) => f.ieee)).toEqual([LAMP, HALL]);
		c.state.bridge.restartedAt = NOW - 14 * MIN;
		expect(deviceOffline(c)).toEqual([]);
		c.state.bridge.restartedAt = NOW - 15 * MIN;
		expect(deviceOffline(c).map((f) => f.ieee)).toEqual([LAMP, HALL]);
	});

	it('repeating 3-min device gaps every 10 min do not hold a dead router', () => {
		const c = ctx();
		const notes = simulateRuns(c, 60, (k) => k % 10 < 7, (k) => {
			if (k === 12) Object.assign(dev(c, LAMP), { availability: 'offline', offlineSince: NOW + k * MIN });
		});
		expect(notes).toHaveLength(1);
		expect(notes[0]).toMatch(new RegExp(`^\\d+ device.offline\\|${LAMP}:open$`));
		expect(Number(notes[0].split(' ')[0])).toBeLessThanOrEqual(12 + c.settings.graceMin + 2);
	});

	it('a real 6-min silence holds a dead router for graceMin after resume, then it opens', () => {
		const c = ctx();
		const notes = simulateRuns(c, 50, (k) => k < 10 || k >= 16, (k) => {
			if (k === 9) Object.assign(dev(c, LAMP), { availability: 'offline', offlineSince: NOW + k * MIN });
		});
		// quiet from minute 10, bridge.offline guards from 15; traffic resumes at 16, held to 31, minRuns 2 opens it at 32
		expect(notes.filter((n) => n.includes('device.offline'))).toEqual([`${16 + 15 + 1} device.offline|${LAMP}:open`]);
	});

	it('sparse mesh (one device message every 90 s): a dead router opens at the first non-quiet run after minRuns', () => {
		const c = ctx();
		let j = 0;
		const notes = simulateRuns(c, 12, () => false, (k) => {
			const now = NOW + k * MIN;
			for (; NOW + j * 90_000 <= now; j++)
				route(c.state, { ts: NOW + j * 90_000, topic: 'zigbee2mqtt/hall_plug', payload: { state: 'ON' }, retain: false }, 'zigbee2mqtt');
			if (k === 3) Object.assign(dev(c, LAMP), { availability: 'offline', offlineSince: now });
		});
		// seen at 3 and 4 (minRuns met), minute 4 is quiet (last message 60 s ago), minute 5 is not
		expect(notes).toEqual([`5 device.offline|${LAMP}:open`]);
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
			const r = evaluate({ device: (ieee) => c.state.devices.get(ieee), findings: evaluateRules(run), issues: open, counters, mutedUntil: () => null, settings: c.settings, now,
				networkQuiet: deviceSilentFor(run, 60_000) });
			for (const f of r.opens) issues.push({ id: issues.length + 1, ...newIssue(f, now, true) });
			for (const { id, patch } of r.updates) Object.assign(issues[id - 1], patch);
			notes.push(...r.notify.map((n) => `${k} ${n.key}:${n.kind}`));
		}
		// device traffic resumed at minute 25: grace (15 min) ends at minute 40
		expect(notes).toEqual(['9 bridge.offline|:open', '28 bridge.offline|:resolved', `41 device.offline|${routers[0]}:open`]);
	});

	it('Z2M restart marks 50 devices offline that come back within 10 min: no issue; one still offline at grace end opens', () => {
		const c = ctx();
		const ends = Array.from({ length: 50 }, (_, i) => {
			const ieee = `0xend${i}`;
			c.state.devices.set(ieee, { ...dev(c, DOOR), ieee, friendlyName: `end_${i}`, recentSeen: [] });
			return ieee;
		});
		const issues: IssueRow[] = [];
		const counters = { seen: new Map(), missing: new Map() };
		const notes: string[] = [];
		for (let k = 0; k < 40; k++) {
			const now = NOW + k * MIN;
			route(c.state, { ts: now, topic: 'zigbee2mqtt/living/lamp', payload: { state: 'ON' }, retain: false }, 'zigbee2mqtt');
			if (k === 2) c.state.bridge.restartedAt = now;
			if (k === 6) for (const e of ends) {
				Object.assign(dev(c, e), { availability: 'offline', offlineSince: now });
				c.events.push(flip(e, now, 'online', 'offline'));
			}
			if (k === 12) for (const e of ends.slice(1)) Object.assign(dev(c, e), { availability: 'online', offlineSince: null, lastSeenAt: now });
			const open = issues.filter((i) => i.state !== 'resolved');
			const run = { ...c, now, open: new Set(open.map((i) => issueKey(i.rule, i.ieee))) };
			const r = evaluate({ device: (ieee) => c.state.devices.get(ieee), findings: evaluateRules(run), issues: open, counters, mutedUntil: () => null, settings: c.settings, now,
				networkQuiet: deviceSilentFor(run, 60_000) });
			for (const f of r.opens) issues.push({ id: issues.length + 1, ...newIssue(f, now, true) });
			for (const { id, patch } of r.updates) Object.assign(issues[id - 1], patch);
			notes.push(...r.notify.map((n) => `${k} ${n.key}:${n.kind}`));
		}
		// restart at minute 2: grace (15 min) ends at minute 17
		expect(notes).toEqual([`18 device.offline|${ends[0]}:open`]);
	});
});

/** One rules + lifecycle run per minute; a device message on minutes where `talk(k)`; returns notifications. */
function simulateRuns(c: RuleContext, n: number, talk: (k: number) => boolean, step: (k: number) => void): string[] {
	const issues: IssueRow[] = [];
	const counters = { seen: new Map(), missing: new Map() };
	const notes: string[] = [];
	for (let k = 0; k < n; k++) {
		const now = NOW + k * MIN;
		route(c.state, { ts: now, topic: 'zigbee2mqtt/bridge/health', payload: { process: { uptime_sec: 100_000 + k * 60 } }, retain: false }, 'zigbee2mqtt');
		if (talk(k)) route(c.state, { ts: now, topic: 'zigbee2mqtt/hall_plug', payload: { state: 'ON' }, retain: false }, 'zigbee2mqtt');
		step(k);
		const open = issues.filter((i) => i.state !== 'resolved');
		const run = { ...c, now, open: new Set(open.map((i) => issueKey(i.rule, i.ieee))) };
		const r = evaluate({ device: (ieee) => c.state.devices.get(ieee), findings: evaluateRules(run), issues: open, counters, mutedUntil: () => null, settings: c.settings, now,
			networkQuiet: deviceSilentFor(run, 60_000) });
		for (const f of r.opens) issues.push({ id: issues.length + 1, ...newIssue(f, now, true) });
		for (const { id, patch } of r.updates) Object.assign(issues[id - 1], patch);
		notes.push(...r.notify.map((x) => `${k} ${x.key}:${x.kind}`));
	}
	return notes;
}
