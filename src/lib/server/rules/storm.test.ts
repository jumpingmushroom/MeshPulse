import { describe, expect, it } from 'vitest';
import { COORD, ctx, dev, DOOR, ev, HALL, LAMP, MIN, TEMP } from '../../../../tests/helpers/ctx';
import { evaluate, newIssue, type IssueRow } from '../issues/lifecycle';
import { MinuteCounters } from '../trends/minutes';
import { evaluateRules, issueKey, type RuleContext } from './index';
import { deviceDominant, deviceStorm, networkStorm } from './storm';

/** Start of the complete minute `ago` minutes back (1 = the last complete minute). */
const minute = (c: RuleContext, ago: number) => Math.floor(c.now / MIN) * MIN - ago * MIN;
/** `perMin` messages from `ieee` in each of `mins` complete minutes, the newest `from` minutes back. */
const send = (c: RuleContext, ieee: string, perMin: number, mins: number, from = 1) => {
	for (let a = from; a < from + mins; a++) for (let i = 0; i < perMin; i++) c.state.minutes.add(ieee, minute(c, a));
};
const base = (c: RuleContext, ieee: string, value: number, days = 7) => c.history.baselines.set(`${ieee}|msg_per_min`, { value, days });
const add = (c: RuleContext, n: number) => Array.from({ length: n }, (_, i) => {
	const ieee = `0xfake${i}`;
	c.state.devices.set(ieee, { ...dev(c, LAMP), ieee, friendlyName: `fake_${i}`, tags: [], recentSeen: [] });
	return ieee;
});

/** Runs rules + lifecycle once a minute for `n` runs; `tick(c, k)` feeds the minute that just completed. */
function runs(c: RuleContext, n: number, tick: (c: RuleContext, k: number) => void) {
	const issues: IssueRow[] = [];
	const counters = { seen: new Map(), missing: new Map() };
	const notes: string[] = [];
	const start = c.now;
	for (let k = 0; k < n; k++) {
		c.now = start + k * MIN;
		Object.assign(c.state.bridge, { lastLiveAt: c.now, lastDeviceAt: c.now });
		tick(c, k);
		const open = issues.filter((i) => i.state !== 'resolved');
		c.open = new Set(open.map((i) => issueKey(i.rule, i.ieee)));
		const r = evaluate({ findings: evaluateRules(c), issues: open, counters, mutedUntil: () => null, settings: c.settings, now: c.now, networkQuiet: false });
		for (const f of r.opens) issues.push({ id: issues.length + 1, ...newIssue(f, c.now, true) });
		for (const { id, patch } of r.updates) Object.assign(issues[id - 1], patch);
		notes.push(...r.notify.map((x) => `${x.key}:${x.kind}:${x.severity}`));
	}
	return { issues, notes };
}

describe('device.storm', () => {
	it('fires above 5 x baseline and 20 msg/min for 5 minutes, with exact thresholds', () => {
		const c = ctx();
		base(c, LAMP, 3); // 5 x 3 = 15, so the 20 floor decides
		send(c, LAMP, 20, 5);
		expect(deviceStorm(c)).toEqual([]);
		c.state.minutes = new MinuteCounters();
		send(c, LAMP, 21, 5);
		expect(deviceStorm(c)).toEqual([expect.objectContaining({ rule: 'device.storm', ieee: LAMP, severity: 'warning',
			summary: 'living/lamp is flooding the network (21 msgs/min, normally 3)',
			action: 'Check the device for a stuck sensor or a reporting-interval misconfiguration; power-cycle it' })]);

		base(c, LAMP, 5); // 5 x 5 = 25
		c.state.minutes = new MinuteCounters();
		send(c, LAMP, 25, 5);
		expect(deviceStorm(c)).toEqual([]);
		send(c, LAMP, 1, 5);
		expect(deviceStorm(c)).toHaveLength(1);
	});

	it('needs all 5 minutes over the threshold', () => {
		const c = ctx();
		base(c, LAMP, 3);
		send(c, LAMP, 40, 4);
		send(c, LAMP, 19, 1, 5);
		expect(deviceStorm(c)).toEqual([]);
	});

	it('is critical when all 5 minutes are above 60 msg/min', () => {
		const c = ctx();
		base(c, LAMP, 3);
		send(c, LAMP, 61, 5);
		expect(deviceStorm(c)[0].severity).toBe('critical');
		c.state.minutes = new MinuteCounters();
		send(c, LAMP, 61, 4);
		send(c, LAMP, 60, 1, 5);
		expect(deviceStorm(c)[0].severity).toBe('warning');
	});

	it('holds while open until 15 minutes are all below 2 x baseline', () => {
		const c = ctx();
		base(c, LAMP, 3);
		c.open = new Set([issueKey('device.storm', LAMP)]);
		send(c, LAMP, 5, 14);
		send(c, LAMP, 6, 1, 15); // not below 6
		expect(deviceStorm(c)).toHaveLength(1);
		c.state.minutes = new MinuteCounters();
		send(c, LAMP, 5, 15);
		expect(deviceStorm(c)).toEqual([]);
	});

	it('thin baseline -> none', () => {
		const c = ctx();
		base(c, LAMP, 3, 2);
		send(c, LAMP, 100, 5);
		expect(deviceStorm(c)).toEqual([]);
	});

	it('needs a full window after start', () => {
		const c = ctx();
		base(c, LAMP, 3);
		send(c, LAMP, 100, 10);
		const grace = c.settings.graceMin * MIN; // a MeshPulse start is also a restart window
		c.state.monitor.startedAt = minute(c, 5) - grace;
		expect(deviceStorm(c)).toHaveLength(1);
		c.state.monitor.startedAt = minute(c, 5) - grace + 1;
		expect(deviceStorm(c)).toEqual([]);
		c.state.monitor.startedAt = 0;
		c.state.monitor.connectedAt = minute(c, 5) + 1; // reconnect
		expect(deviceStorm(c)).toEqual([]);
	});

	it('restart burst is not a storm', () => {
		const c = ctx();
		const all = [COORD, LAMP, HALL, DOOR, TEMP];
		for (const i of all) base(c, i, 0.5);
		base(c, '', 2.5);
		c.events.push(ev({ ts: minute(c, 3), ieee: null, kind: 'bridge_restart', detail: {} }));
		for (const i of all) send(c, i, 30, 1, 2); // every device sends 30 msgs in the minute after the restart
		expect([...deviceStorm(c), ...deviceDominant(c), ...networkStorm(c)]).toEqual([]);
	});

	it('waits 5 complete minutes after the restart guard ends', () => {
		const c = ctx();
		base(c, LAMP, 3);
		send(c, LAMP, 100, 25);
		const guard = c.settings.graceMin * MIN;
		c.events.push(ev({ ts: minute(c, 5) - guard, ieee: null, kind: 'bridge_restart', detail: {} }));
		expect(deviceStorm(c)).toHaveLength(1);
		c.events[0] = ev({ ts: minute(c, 5) - guard + 1, ieee: null, kind: 'bridge_restart', detail: {} });
		expect(deviceStorm(c)).toEqual([]);
	});

	it('no resolve/reopen loop over consecutive runs', () => {
		const c = ctx();
		base(c, LAMP, 3);
		const others = add(c, 5);
		for (const i of others) send(c, i, 12, 15); // normal background traffic, no device dominant
		// 10 min at 30/min, 20 min at 10/min (between 2x and 5x), then normal
		const { notes } = runs(c, 60, (c, k) => {
			send(c, LAMP, k < 10 ? 30 : k < 30 ? 10 : 3, 1);
			for (const i of others) send(c, i, 12, 1);
		});
		expect(notes).toEqual([`${issueKey('device.storm', LAMP)}:open:warning`, `${issueKey('device.storm', LAMP)}:resolved:warning`]);
	});
});

describe('device.dominant', () => {
	const share = (c: RuleContext, lamp: number, others: number) => {
		// spread over the 15-minute window; others split evenly so none of them dominates
		for (let i = 0; i < lamp; i++) c.state.minutes.add(LAMP, minute(c, 1 + (i % 15)));
		for (let i = 0; i < others; i++) c.state.minutes.add([HALL, DOOR, TEMP][i % 3], minute(c, 1 + (i % 15)));
	};

	it('31 % of 100 -> warning', () => {
		const c = ctx();
		share(c, 31, 69);
		expect(deviceDominant(c)).toEqual([expect.objectContaining({ rule: 'device.dominant', ieee: LAMP, severity: 'warning',
			action: 'Mark it as chatty if this is expected, otherwise check its reporting settings' })]);
	});

	it('31 % of 50 -> none (below the minimum message count)', () => {
		const c = ctx();
		share(c, 16, 34); // 32 %
		expect(deviceDominant(c)).toEqual([]);
	});

	it('30 % exactly -> none', () => {
		const c = ctx();
		share(c, 30, 70);
		expect(deviceDominant(c)).toEqual([]);
	});

	it('chatty devices are excluded', () => {
		const c = ctx();
		dev(c, LAMP).tags = ['chatty'];
		share(c, 60, 40);
		expect(deviceDominant(c)).toEqual([]);
	});

	it('a storming device is reported as device.storm only', () => {
		const c = ctx();
		base(c, LAMP, 3);
		send(c, LAMP, 30, 15);
		send(c, HALL, 5, 15);
		expect(evaluateRules(c).map((f) => f.rule)).toEqual(['device.storm']);
	});

	it('needs a full window after start', () => {
		const c = ctx();
		share(c, 60, 40);
		c.state.monitor.startedAt = minute(c, 15) + 1;
		expect(deviceDominant(c)).toEqual([]);
	});

	it('stops below 15 % for 30 min, no resolve/reopen loop', () => {
		const c = ctx();
		// 20 min at 40 %, 20 min at 20 % (holds), then 10 %
		const { notes } = runs(c, 90, (c, k) => {
			const lamp = k < 20 ? 4 : k < 40 ? 2 : 1;
			send(c, LAMP, lamp, 1);
			for (const i of [HALL, DOOR, TEMP]) send(c, i, 2, 1);
		});
		const key = issueKey('device.dominant', LAMP);
		expect(notes).toEqual([`${key}:open:warning`, `${key}:resolved:warning`]);
	});
});

describe('network.storm', () => {
	it('fires above 4 x network baseline for 5 minutes and lists the top 5 senders', () => {
		const c = ctx();
		base(c, '', 10);
		const fakes = add(c, 7);
		fakes.forEach((ieee, i) => send(c, ieee, 10 - i, 5)); // 10+9+...+4 = 49 > 40
		expect(networkStorm(c)).toEqual([expect.objectContaining({ rule: 'network.storm', ieee: null, severity: 'critical',
			action: 'Check the top senders listed; a single misbehaving device is the usual cause',
			evidence: expect.objectContaining({ top: [10, 9, 8, 7, 6].map((perMin, i) => ({ name: `fake_${i}`, perMin })) }) })]);
	});

	it('40 msg/min against 10 -> none; thin baseline -> none', () => {
		const c = ctx();
		base(c, '', 10);
		send(c, LAMP, 40, 5);
		expect(networkStorm(c)).toEqual([]);
		send(c, HALL, 1, 5);
		expect(networkStorm(c)).toHaveLength(1);
		base(c, '', 10, 2);
		expect(networkStorm(c)).toEqual([]);
	});

	it('no resolve/reopen loop over consecutive runs', () => {
		const c = ctx();
		base(c, '', 10);
		const fakes = add(c, 5);
		// 10 min at 50/min, 20 min at 25/min (holds), then 10/min
		const { notes } = runs(c, 60, (c, k) => fakes.forEach((ieee) => send(c, ieee, k < 10 ? 10 : k < 30 ? 5 : 2, 1)));
		const key = issueKey('network.storm', null);
		expect(notes.filter((n) => n.startsWith(key))).toEqual([`${key}:open:critical`, `${key}:resolved:critical`]);
	});
});
