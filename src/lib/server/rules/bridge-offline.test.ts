import { describe, expect, it } from 'vitest';
import { ctx, MIN, NOW } from '../../../../tests/helpers/ctx';
import { evaluate, newIssue, type IssueRow } from '../issues/lifecycle';
import { route } from '../mqtt/route';
import { evaluateRules, issueKey } from './index';
import { bridgeOffline, deviceSilent } from './bridge-offline';

const z2m = (topic: string, ts: number, payload: unknown) => ({ ts, topic: `zigbee2mqtt/${topic}`, payload, retain: false });

describe('bridge.offline', () => {
	it('fires critical when bridge/state is offline', () => {
		const c = ctx();
		c.state.bridge.state = 'offline';
		const [f] = bridgeOffline(c);
		expect(f).toMatchObject({ rule: 'bridge.offline', ieee: null, severity: 'critical' });
	});

	it('fires when the last device message is 5 min old, not at 4 min 59 s', () => {
		const c = ctx();
		c.state.bridge.lastDeviceAt = NOW - 5 * MIN;
		expect(bridgeOffline(c)).toHaveLength(1);
		c.state.bridge.lastDeviceAt = NOW - 5 * MIN + 1000;
		expect(bridgeOffline(c)).toEqual([]);
	});

	it('is nothing on a healthy baseline', () => {
		expect(bridgeOffline(ctx())).toEqual([]);
	});

	it('suppresses the silence part in grace but not an explicit offline', () => {
		const c = ctx();
		c.state.monitor.startedAt = NOW - 10 * MIN;
		c.state.bridge.lastDeviceAt = NOW - 6 * MIN;
		expect(bridgeOffline(c)).toEqual([]);
		c.state.bridge.state = 'offline';
		expect(bridgeOffline(c)).toHaveLength(1);
	});

	it('when open, keeps firing until online for 2 min and live within 2 min', () => {
		const c = ctx();
		c.open.add(issueKey('bridge.offline', null));
		c.state.bridge.onlineSince = NOW - 1 * MIN;
		expect(bridgeOffline(c)).toHaveLength(1);
		c.state.bridge.onlineSince = NOW - 2 * MIN;
		c.state.bridge.lastDeviceAt = NOW - 3 * MIN;
		expect(bridgeOffline(c)).toHaveLength(1);
		c.state.bridge.lastDeviceAt = NOW - 1 * MIN;
		expect(bridgeOffline(c)).toEqual([]);
	});

	it('is nothing while the monitor is disconnected and the issue is not open', () => {
		const c = ctx();
		c.state.monitor.connected = false;
		c.state.bridge.lastDeviceAt = NOW - 10 * MIN;
		expect(bridgeOffline(c)).toEqual([]);
		c.state.bridge.state = 'offline'; // stale retained state
		expect(bridgeOffline(c)).toEqual([]);
	});

	it('holds an open issue while the monitor is disconnected', () => {
		const c = ctx();
		c.state.monitor.connected = false;
		c.open.add(issueKey('bridge.offline', null));
		expect(bridgeOffline(c)).toHaveLength(1);
	});

	it('starts the silence clock at reconnect after an outage', () => {
		const c = ctx();
		c.state.bridge.lastDeviceAt = NOW - 30 * MIN;
		c.state.monitor.connectedAt = NOW - 1 * MIN;
		expect(bridgeOffline(c)).toEqual([]);
		c.state.monitor.connectedAt = NOW - 5 * MIN;
		expect(bridgeOffline(c)).toHaveLength(1);
	});

	it('does not clear an open issue on reconnect alone; needs live messages', () => {
		const c = ctx();
		c.open.add(issueKey('bridge.offline', null));
		c.state.bridge.onlineSince = NOW - 60 * MIN;
		c.state.bridge.lastDeviceAt = NOW - 30 * MIN;
		c.state.monitor.connectedAt = NOW - 1 * MIN;
		expect(bridgeOffline(c)).toHaveLength(1);
	});

	it('clears an open issue without a retained bridge/state once live for 2 min', () => {
		const c = ctx();
		c.open.add(issueKey('bridge.offline', null));
		Object.assign(c.state.bridge, { state: null, onlineSince: null, lastDeviceAt: NOW });
		c.state.monitor.connectedAt = NOW - 1 * MIN;
		expect(bridgeOffline(c)).toHaveLength(1);
		c.state.monitor.connectedAt = NOW - 10 * MIN;
		expect(bridgeOffline(c)).toEqual([]);
	});

	it('Z2M health and logging alone do not keep the network alive', () => {
		const c = ctx();
		for (let k = 5; k >= 0; k--) {
			route(c.state, z2m('bridge/health', NOW - k * MIN, { process: { uptime_sec: 100_000 - k * 60 } }), 'zigbee2mqtt');
			route(c.state, z2m('bridge/logging', NOW - k * MIN, { level: 'error', message: 'ping failed' }), 'zigbee2mqtt');
		}
		c.state.bridge.lastDeviceAt = NOW - 5 * MIN;
		expect(c.state.bridge.lastLiveAt).toBe(NOW);
		expect(deviceSilent(c)).toBe(true);
		expect(bridgeOffline(c)).toEqual([{
			rule: 'bridge.offline', ieee: null, severity: 'critical',
			summary: 'Zigbee network silent: no device messages for 5 min (Zigbee2MQTT is running)',
			action: 'Check the Zigbee coordinator: restart the adapter, then Zigbee2MQTT',
			evidence: expect.objectContaining({ lastDeviceAt: NOW - 5 * MIN })
		}]);
	});

	it('measures device silence from the later of reconnect, start and Z2M restart', () => {
		const c = ctx();
		c.state.bridge.lastDeviceAt = NOW - 30 * MIN;
		c.state.bridge.restartedAt = NOW - 20 * MIN; // past grace (15 min)
		c.state.monitor.connectedAt = NOW - 25 * MIN;
		expect(deviceSilent(c)).toBe(true);
		c.state.bridge.restartedAt = NOW - 16 * MIN;
		c.state.bridge.lastDeviceAt = null;
		expect(deviceSilent(c)).toBe(true);
		c.state.monitor.connectedAt = NOW - 4 * MIN;
		expect(deviceSilent(c)).toBe(false);
	});

	it('when open, needs 2 min of device messages after the silence ends', () => {
		const c = ctx();
		c.open.add(issueKey('bridge.offline', null));
		Object.assign(c.state.bridge, { lastDeviceAt: NOW, deviceSince: NOW - MIN });
		expect(bridgeOffline(c)).toHaveLength(1);
		c.state.bridge.deviceSince = NOW - 2 * MIN;
		expect(bridgeOffline(c)).toEqual([]);
	});

	it('a silent network opens one Critical, resolves after devices flow for 2 min and never reopens', () => {
		const c = ctx();
		const issues: IssueRow[] = [];
		const counters = { seen: new Map(), missing: new Map() };
		const notes: string[] = [];
		let cleared = 0;
		for (let k = 0; k < 60; k++) {
			const now = NOW + k * MIN;
			route(c.state, z2m('bridge/health', now, { process: { uptime_sec: 100_000 + k * 60 } }), 'zigbee2mqtt');
			// devices silent from minute 1 to 29, then a lamp reports every 30 s
			if (k === 0 || k >= 30) for (const t of [now - 30_000, now]) route(c.state, z2m('living/lamp', t, { state: 'ON' }), 'zigbee2mqtt');
			const open = issues.filter((i) => i.state !== 'resolved');
			const run = { ...c, now, open: new Set(open.map((i) => issueKey(i.rule, i.ieee))) };
			const findings = evaluateRules(run);
			if (k >= 30 && !cleared && !findings.some((f) => f.rule === 'bridge.offline')) cleared = k;
			const r = evaluate({ findings, issues: open, counters, mutedUntil: () => null, settings: c.settings, now });
			for (const f of r.opens) issues.push({ id: issues.length + 1, ...newIssue(f, now, true) });
			for (const { id, patch } of r.updates) Object.assign(issues[id - 1], patch);
			notes.push(...r.notify.map((n) => `${n.key}:${n.kind}`));
		}
		expect(notes).toEqual(['bridge.offline|:open', 'bridge.offline|:resolved']);
		expect(cleared).toBe(32); // device run began at minute 29.5
	});
});
