import { describe, expect, it } from 'vitest';
import { ctx, dev, DOOR, ev, H, HALL, LAMP, MIN, NOW, TEMP } from '../../../../tests/helpers/ctx';
import { evaluate, newIssue, type IssueRow } from '../issues/lifecycle';
import type { EventKind } from '../types';
import { interviewFailed, networkChurn, rejoinChurn, deviceLeave } from './churn';
import { evaluateRules, issueKey, restartGuard, type RuleContext } from './index';

const at = (c: RuleContext, kind: EventKind, ieee: string | null, ts: number, detail: Record<string, unknown> = {}) => {
	c.events.push(ev({ ts, ieee, kind, detail }));
	c.events.sort((a, b) => a.ts - b.ts);
};
/** `n` announces from `ieee`, one per `everyMin` minutes, the last one a minute ago */
const announces = (c: RuleContext, ieee: string, n: number, everyMin = 10) => {
	for (let i = 0; i < n; i++) at(c, 'device_announce', ieee, c.now - MIN - i * everyMin * MIN);
};
/** Adds `n` fake known devices; returns their ieees. */
const add = (c: RuleContext, n: number) => Array.from({ length: n }, (_, i) => {
	const ieee = `0xfake${i}`;
	c.state.devices.set(ieee, { ...dev(c, LAMP), ieee, friendlyName: `fake_${i}`, recentSeen: [] });
	return ieee;
});

/** Runs rules + lifecycle every `stepMin` minutes for `runs` runs; `tick(c, k)` changes the world before each run. */
function runs(c: RuleContext, n: number, stepMin: number, tick: (c: RuleContext, k: number) => void = () => {}) {
	const issues: IssueRow[] = [];
	const counters = { seen: new Map(), missing: new Map() };
	const notes: string[] = [];
	const start = c.now;
	for (let k = 0; k < n; k++) {
		c.now = start + k * stepMin * MIN;
		Object.assign(c.state.bridge, { lastLiveAt: c.now, lastDeviceAt: c.now });
		tick(c, k);
		const open = issues.filter((i) => i.state !== 'resolved');
		c.open = new Set(open.map((i) => issueKey(i.rule, i.ieee)));
		const r = evaluate({ device: (ieee) => c.state.devices.get(ieee), findings: evaluateRules(c), issues: open, counters, mutedUntil: () => null, settings: c.settings, now: c.now, networkQuiet: false });
		for (const f of r.opens) issues.push({ id: issues.length + 1, ...newIssue(f, c.now, true) });
		for (const { id, patch } of r.updates) Object.assign(issues[id - 1], patch);
		notes.push(...r.notify.map((x) => `${x.key}:${x.kind}:${x.severity}`));
	}
	return { issues, notes };
}

describe('device.rejoin_churn', () => {
	it('2 announces in 6 h: nothing; 3: warning', () => {
		const c = ctx();
		announces(c, LAMP, 2);
		expect(rejoinChurn(c)).toEqual([]);
		at(c, 'device_announce', LAMP, NOW - 30 * MIN);
		expect(rejoinChurn(c)).toEqual([{
			rule: 'device.rejoin_churn', ieee: LAMP, severity: 'warning',
			summary: 'living/lamp keeps rejoining the network (3 rejoins in 6 h)',
			action: "Check the device's power and its nearest router",
			evidence: { announces: 3, addressChanges: 0, windowH: 6, last24h: 3 }
		}]);
	});

	it('announces older than 6 h do not open it', () => {
		const c = ctx();
		for (let i = 0; i < 5; i++) at(c, 'device_announce', LAMP, NOW - 7 * H - i * MIN);
		expect(rejoinChurn(c)).toEqual([]);
	});

	it('10 in 24 h: critical', () => {
		const c = ctx();
		for (let i = 0; i < 10; i++) at(c, 'device_announce', LAMP, NOW - MIN - i * 2 * H);
		expect(rejoinChurn(c)).toMatchObject([{ severity: 'critical', evidence: { last24h: 10 } }]);
	});

	it('2 address changes in 6 h: warning; deltas add up', () => {
		const c = ctx();
		at(c, 'address_changed', HALL, NOW - 30 * MIN, { delta: 1 });
		expect(rejoinChurn(c)).toEqual([]);
		at(c, 'address_changed', HALL, NOW - 20 * MIN, { delta: 1 });
		expect(rejoinChurn(c)).toMatchObject([{ ieee: HALL, severity: 'warning', evidence: { addressChanges: 2 } }]);
		const d = ctx();
		at(d, 'address_changed', HALL, NOW - 20 * MIN, { delta: 2 });
		expect(rejoinChurn(d)).toHaveLength(1);
	});

	it('when open, holds until 12 h without a rejoin', () => {
		const c = ctx();
		at(c, 'device_announce', LAMP, NOW - 11 * H);
		expect(rejoinChurn(c)).toEqual([]);
		c.open.add(issueKey('device.rejoin_churn', LAMP));
		expect(rejoinChurn(c)).toHaveLength(1);
		c.now += 2 * H;
		expect(rejoinChurn(c)).toEqual([]);
	});

	it('opens once, resolves after 12 h quiet and never reopens', () => {
		const c = ctx();
		const { notes } = runs(c, 30 * 6, 10, (c, k) => { if (k < 3) at(c, 'device_announce', LAMP, c.now); });
		expect(notes).toEqual([`device.rejoin_churn|${LAMP}:open:warning`, `device.rejoin_churn|${LAMP}:resolved:warning`]);
	});
});

describe('device.rejoin_churn de-duplication', () => {
	it('two announces 20 s apart are one rejoin: two pairs nothing, three separate rejoins warning', () => {
		const c = ctx();
		for (const t of [NOW - 60 * MIN, NOW - 30 * MIN]) {
			at(c, 'device_announce', LAMP, t);
			at(c, 'device_announce', LAMP, t + 20_000);
		}
		expect(rejoinChurn(c)).toEqual([]);
		at(c, 'device_announce', LAMP, NOW - MIN);
		expect(rejoinChurn(c)).toMatchObject([{ evidence: { announces: 3 } }]);
	});
});

describe('device.leave', () => {
	it('leave, announce, then the leave_count_up from the next health sample: no finding', () => {
		const c = ctx();
		c.health = [{ ts: NOW - 12 * MIN, queued: 0 }, { ts: NOW - 2 * MIN, queued: 0 }];
		dev(c, DOOR).lastSeenAt = NOW - 30 * MIN;
		at(c, 'device_leave', DOOR, NOW - 8 * MIN);
		at(c, 'device_announce', DOOR, NOW - 7 * MIN);
		at(c, 'leave_count_up', DOOR, NOW - 2 * MIN, { delta: 1 });
		expect(deviceLeave(c)).toEqual([]);
	});

	it('a device_joined after the leave counts as seen again, even inside the restart grace', () => {
		const c = ctx();
		dev(c, DOOR).lastSeenAt = NOW - 30 * MIN;
		at(c, 'device_leave', DOOR, NOW - 30 * MIN);
		c.state.monitor.startedAt = NOW - 25 * MIN; // grace until NOW - 10 min
		at(c, 'device_joined', DOOR, NOW - 20 * MIN);
		expect(deviceLeave(c)).toEqual([]);
	});

	it('when open, holds after the leave ages out of 24 h until the device is seen', () => {
		const c = ctx();
		dev(c, DOOR).lastSeenAt = NOW - 30 * H;
		c.open.add(issueKey('device.leave', DOOR));
		expect(deviceLeave(c)).toMatchObject([{ ieee: DOOR, evidence: { leftAt: null } }]);
		dev(c, DOOR).lastSeenAt = NOW - H;
		expect(deviceLeave(c)).toEqual([]);
	});

	it('a leave event opens a warning until the device is seen again', () => {
		const c = ctx();
		dev(c, DOOR).lastSeenAt = NOW - 10 * MIN;
		at(c, 'device_leave', DOOR, NOW - 5 * MIN);
		expect(deviceLeave(c)).toEqual([{
			rule: 'device.leave', ieee: DOOR, severity: 'warning',
			summary: 'door_sensor left the network',
			action: 'Re-pair the device if it does not come back',
			evidence: { leftAt: NOW - 5 * MIN }
		}]);
		dev(c, DOOR).lastSeenAt = NOW - MIN;
		expect(deviceLeave(c)).toEqual([]);
	});

	it('a leave_count_up counts as a leave', () => {
		const c = ctx();
		dev(c, TEMP).lastSeenAt = NOW - 10 * MIN;
		at(c, 'leave_count_up', TEMP, NOW - 2 * MIN, { delta: 1 });
		expect(deviceLeave(c)).toMatchObject([{ ieee: TEMP }]);
		dev(c, TEMP).lastSeenAt = NOW;
		expect(deviceLeave(c)).toEqual([]);
	});

	it('a device never seen since the leave keeps it open', () => {
		const c = ctx();
		dev(c, DOOR).lastSeenAt = null;
		at(c, 'device_leave', DOOR, NOW - 5 * MIN);
		expect(deviceLeave(c)).toHaveLength(1);
	});
});

describe('network.churn', () => {
	it('5 devices announcing within 15 min: warning; 4: nothing', () => {
		const c = ctx();
		const ids = add(c, 5);
		for (const [i, ieee] of ids.slice(0, 4).entries()) at(c, 'device_announce', ieee, NOW - i * 3 * MIN);
		at(c, 'device_announce', ids[0], NOW - MIN); // a repeat is still one device
		expect(networkChurn(c)).toEqual([]);
		at(c, 'device_announce', ids[4], NOW - 14 * MIN);
		expect(networkChurn(c)).toEqual([{
			rule: 'network.churn', ieee: null, severity: 'warning',
			summary: '5 devices rejoined the network within 15 min',
			action: 'Check for a power cut or a router that restarted near these devices',
			evidence: { devices: 5, windowMin: 15, names: ['fake_4', 'fake_3', 'fake_2', 'fake_1', 'fake_0'] }
		}]);
	});

	it('when open, stops after 1 h without announces', () => {
		const c = ctx();
		at(c, 'device_announce', LAMP, NOW - 59 * MIN);
		c.open.add(issueKey('network.churn', null));
		expect(networkChurn(c)).toHaveLength(1);
		c.now += 2 * MIN;
		expect(networkChurn(c)).toEqual([]);
	});

	it('opens once, resolves after quiet and never reopens', () => {
		const c = ctx();
		const ids = add(c, 6);
		const { notes } = runs(c, 120, 1, (c, k) => { if (k < 6) at(c, 'device_announce', ids[k], c.now); });
		expect(notes).toEqual(['network.churn|:open:warning', 'network.churn|:resolved:warning']);
	});
});

describe('device.interview_failed', () => {
	it('a failed interview: warning; a later successful one stops it', () => {
		const c = ctx();
		at(c, 'device_interview', DOOR, NOW - 10 * MIN, { status: 'started' });
		at(c, 'device_interview', DOOR, NOW - 9 * MIN, { status: 'failed' });
		at(c, 'device_interview', DOOR, NOW - 8 * MIN, { status: 'started' });
		expect(interviewFailed(c)).toEqual([{
			rule: 'device.interview_failed', ieee: DOOR, severity: 'warning',
			summary: 'door_sensor could not be interviewed',
			action: 'Re-pair the device or check its compatibility',
			evidence: { failedAt: NOW - 9 * MIN }
		}]);
		at(c, 'device_interview', DOOR, NOW - 7 * MIN, { status: 'successful' });
		expect(interviewFailed(c)).toEqual([]);
	});

	it('when open, holds after the failure ages out of 24 h', () => {
		const c = ctx();
		c.open.add(issueKey('device.interview_failed', DOOR));
		expect(interviewFailed(c)).toMatchObject([{ ieee: DOOR, evidence: { failedAt: null } }]);
		at(c, 'device_interview', DOOR, NOW - MIN, { status: 'successful' });
		expect(interviewFailed(c)).toEqual([]);
	});

	it('an unknown device uses the name from the event', () => {
		const c = ctx();
		at(c, 'device_interview', '0xnew', NOW - MIN, { status: 'failed', friendly_name: '0xnew_name' });
		expect(interviewFailed(c)).toMatchObject([{ ieee: '0xnew', summary: '0xnew_name could not be interviewed' }]);
	});
});

describe('restart guard', () => {
	it('an uptime-detected restart guards around the process start and the detection, not the gap between', () => {
		const c = ctx();
		at(c, 'bridge_restart', null, NOW - H, { reason: 'uptime', from: 90000, to: 3 * 3600 }); // noticed 3 h after the start
		const g = restartGuard(c);
		expect([g(NOW - 4 * H + MIN), g(NOW - 2 * H), g(NOW - H + MIN), g(NOW - 30 * MIN)]).toEqual([true, false, true, false]);
	});

	it('restart burst opens nothing: every device announces and leaves within the grace after a restart', () => {
		const c = ctx();
		const restart = NOW - 3 * H;
		at(c, 'bridge_restart', null, restart, { reason: 'state' });
		const ids = [...add(c, 8), LAMP, HALL, DOOR, TEMP];
		for (const ieee of ids) {
			dev(c, ieee).lastSeenAt = restart - H;
			for (let i = 0; i < 3; i++) at(c, 'device_announce', ieee, restart + i * 4 * MIN);
			at(c, 'device_leave', ieee, restart + 14 * MIN);
			at(c, 'leave_count_up', ieee, restart + 14 * MIN, { delta: 1 });
			at(c, 'address_changed', ieee, restart + 14 * MIN, { delta: 2 });
		}
		// a burst can arrive while the restart is first noticed by a health sample minutes later
		const later = NOW - 2 * H;
		at(c, 'bridge_restart', null, later, { reason: 'uptime', from: 9000, to: 300 });
		for (const ieee of ids) at(c, 'device_announce', ieee, later - 200_000);
		c.state.bridge.restartedAt = later;
		expect(evaluateRules(c)).toEqual([]);
		at(c, 'device_announce', LAMP, NOW - MIN); // the guard does not hide the next rejoin
		expect(rejoinChurn(c)).toEqual([]);
		for (let i = 2; i < 4; i++) at(c, 'device_announce', LAMP, NOW - i * MIN);
		expect(rejoinChurn(c)).toHaveLength(1);
	});

	it('events right after MeshPulse starts are ignored', () => {
		const c = ctx();
		c.state.monitor.startedAt = NOW - 20 * MIN;
		for (let i = 0; i < 3; i++) at(c, 'device_announce', LAMP, NOW - 19 * MIN + i * MIN);
		expect(rejoinChurn(c)).toEqual([]);
		c.state.monitor.startedAt = NOW - 40 * MIN;
		expect(rejoinChurn(c)).toHaveLength(1);
	});
});
