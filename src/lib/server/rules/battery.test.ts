import { describe, expect, it } from 'vitest';
import { ctx, dev, DOOR, ev, H, HALL, MIN, NOW, TEMP } from '../../../../tests/helpers/ctx';
import { evaluate, newIssue, type IssueRow } from '../issues/lifecycle';
import type { HourlyRow } from '../trends/history';
import { hourStart } from '../trends/rollup';
import type { DeviceState, EventKind } from '../types';
import { issueKey, type RuleContext } from './index';
import { batteryDropping, batteryLow, batteryStale, isBatteryLow } from './battery';
import { DEFAULT_SETTINGS } from '../settings';

const run = (ieee: string, patch: Partial<DeviceState>, open = false) => {
	const c = ctx();
	Object.assign(dev(c, ieee), patch);
	if (open) c.open.add(issueKey('battery.low', ieee));
	return batteryLow(c);
};

describe('battery.low', () => {
	it('warns at 25 %', () => {
		const [f] = run(DOOR, { battery: 25 });
		expect(f).toMatchObject({ rule: 'battery.low', ieee: DOOR, severity: 'warning', evidence: { level: 'battery.low' } });
		expect(f.summary).toContain('door_sensor');
	});

	it('is critical at 10 %', () => {
		const [f] = run(DOOR, { battery: 10 });
		expect(f).toMatchObject({ severity: 'critical', evidence: { level: 'battery.critical' } });
	});

	it('warns when battery_low is true', () => {
		expect(run(DOOR, { batteryLow: true })[0].severity).toBe('warning');
	});

	it('uses voltage for coin cells even when battery % looks fine', () => {
		expect(run(TEMP, { voltage: 2.8, battery: 50 })[0].severity).toBe('warning');
		expect(run(TEMP, { voltage: 2.6, battery: 50 })[0].severity).toBe('critical');
	});

	it('ignores voltage for multi-cell devices', () => {
		expect(run(DOOR, { maxVoltage: 6.0, voltage: 2.8, battery: 60 })).toEqual([]);
	});

	it('never fires for a mains device, whatever its voltage says', () => {
		expect(run(HALL, { maxVoltage: 0.23, voltage: 0.23 })).toEqual([]);
		expect(run(HALL, { maxVoltage: 0.23, voltage: 0.23 }, true)).toEqual([]);
		expect(run(HALL, { maxVoltage: 0.23 }, true)).toEqual([]); // an old false issue resolves
	});

	it('when open, holds while nothing is known yet (after a restart)', () => {
		expect(run(DOOR, { batteryLow: null, battery: null, voltage: null }, true)).toHaveLength(1);
	});

	it('is nothing for a healthy baseline', () => {
		expect(batteryLow(ctx())).toEqual([]);
	});

	it('when open, keeps firing at 35 % and stops above 40 %', () => {
		expect(run(DOOR, { battery: 35 }, true)).toHaveLength(1);
		expect(run(DOOR, { battery: 41 }, true)).toEqual([]);
	});

	it('when open, keeps firing while battery_low is true', () => {
		expect(run(DOOR, { battery: 80, batteryLow: true }, true)).toHaveLength(1);
	});

	it('when open, a coin cell stops above 2.9 V and holds between 2.8 and 2.9 V', () => {
		expect(run(TEMP, { voltage: 2.95 }, true)).toEqual([]);
		expect(run(TEMP, { voltage: 2.85 }, true)).toHaveLength(1);
	});
});

const at = (c: RuleContext, kind: EventKind, ieee: string | null, ts: number, detail: Record<string, unknown> = {}) => {
	const e = ev({ ts, ieee, kind, detail });
	c.longEvents = [...(c.longEvents ?? c.events), e].sort((a, b) => a.ts - b.ts);
	c.events = c.longEvents.filter((x) => x.ts >= c.now - 24 * H);
};
const low = (pct: number, patch: Partial<DeviceState> = {}) => {
	const c = ctx();
	Object.assign(dev(c, DOOR), { battery: pct, voltage: 2.7 }, patch);
	return c;
};
const rejoins = (c: RuleContext, n: number, lastAgo = MIN) => {
	for (let i = 0; i < n; i++) at(c, 'device_announce', DOOR, c.now - lastAgo - i * 10 * MIN);
};
const lqiHours = (avg: number) => Array.from({ length: 24 }, (_, i): HourlyRow =>
	({ hour: hourStart(NOW) - (24 - i) * H, lqiMin: avg, lqiAvg: avg, lqiMax: avg, batteryMin: null, voltageMin: null, msgCount: 1 }));

describe('battery.low causing issues', () => {
	it.each<[string, (c: RuleContext) => void, string]>([
		['rejoin churn', (c) => rejoins(c, 3), 'rejoined 3 times in 48 h'],
		['rejoin churn', (c) => { at(c, 'address_changed', DOOR, NOW - 2 * H, { delta: 1 }); at(c, 'address_changed', DOOR, NOW - H, { delta: 1 }); }, 'changed address 2 times in 48 h'],
		['flapping', (c) => { for (let i = 0; i < 4; i++) at(c, 'availability', DOOR, NOW - (i + 1) * H, { from: i % 2 ? 'online' : 'offline', to: i % 2 ? 'offline' : 'online' }); }, 'dropped off 4 times in 48 h'],
		['silence', (c) => Object.assign(dev(c, DOOR), { typicalGapMs: H, lastSeenAt: NOW - 3 * H }), 'silent for 3 h'],
		['link degrading', (c) => { c.history.hourly.set(DOOR, lqiHours(70)); c.history.baselines.set(`${DOOR}|lqi_mean`, { value: 100, days: 5 }); }, 'link LQI 70, normally 100'],
		['message failures', (c) => { for (let i = 0; i < 5; i++) at(c, 'route_error', DOOR, NOW - (i + 1) * H, { kind: 'command_failed' }); }, '5 messages failed in 48 h']
	])('%s escalates to critical (%#)', (label, setup, text) => {
		const c = low(18);
		setup(c);
		expect(batteryLow(c)).toEqual([{
			rule: 'battery.low', ieee: DOOR, severity: 'critical',
			summary: `Replace battery in door_sensor: 18% / 2.7 V, ${text}`,
			action: 'Replace the battery',
			evidence: expect.objectContaining({ causingIssues: [label] })
		}]);
	});

	it('lists every instability; the summary names the first', () => {
		const c = low(18, { typicalGapMs: H, lastSeenAt: NOW - 3 * H });
		rejoins(c, 4);
		const [f] = batteryLow(c);
		expect(f.evidence.causingIssues).toEqual(['rejoin churn', 'silence']);
		expect(f.summary).toBe('Replace battery in door_sensor: 18% / 2.7 V, rejoined 4 times in 48 h');
	});

	it('30 % with churn opens directly at critical; 30 % alone is nothing; 36 % with churn is nothing', () => {
		const c = low(30);
		expect(batteryLow(c)).toEqual([]);
		rejoins(c, 3);
		expect(batteryLow(c)).toMatchObject([{ severity: 'critical' }]);
		const d = low(36);
		rejoins(d, 3);
		expect(batteryLow(d)).toEqual([]);
	});

	it('counts instability up to 48 h back, beyond the 24 h events', () => {
		const c = low(18);
		rejoins(c, 3, 40 * H);
		expect(c.events).toEqual([]);
		expect(batteryLow(c)[0].severity).toBe('critical');
		const d = low(18);
		rejoins(d, 3, 49 * H);
		expect(batteryLow(d)[0].severity).toBe('warning');
	});

	it('silence and flapping are not instability during a mass outage or a router outage', () => {
		const silent = () => low(18, { typicalGapMs: H, lastSeenAt: NOW - 3 * H });
		const a = silent();
		a.open.add(issueKey('network.mass_offline', null));
		expect(batteryLow(a)[0].severity).toBe('warning');
		const b = silent();
		const router = [...b.state.devices.values()].find((d) => d.type === 'Router')!;
		b.open.add(issueKey('device.offline', router.ieee));
		expect(batteryLow(b)[0].severity).toBe('warning');
		const c = low(18);
		for (let i = 0; i < 4; i++) at(c, 'availability', DOOR, NOW - (i + 1) * H, { from: i % 2 ? 'online' : 'offline', to: i % 2 ? 'offline' : 'online' });
		c.open.add(issueKey('network.mass_offline', null));
		expect(batteryLow(c)[0].severity).toBe('warning');
	});

	it('never escalates a mains device', () => {
		const c = ctx();
		Object.assign(dev(c, HALL), { battery: 20 });
		at(c, 'device_announce', HALL, NOW - MIN);
		at(c, 'device_announce', HALL, NOW - 20 * MIN);
		at(c, 'device_announce', HALL, NOW - 40 * MIN);
		expect(batteryLow(c).filter((f) => f.severity === 'critical')).toEqual([]);
	});

	it('restart bursts are not instability', () => {
		const c = low(18);
		c.state.bridge.restartedAt = NOW - 2 * H;
		for (let i = 0; i < 5; i++) at(c, 'device_announce', DOOR, NOW - 2 * H + i * 2 * MIN);
		expect(batteryLow(c)[0].severity).toBe('warning');
	});

	it('availability changes caused by an outage do not count', () => {
		const flaps = (c: RuleContext, from: number) => {
			for (let i = 0; i < 4; i++) at(c, 'availability', DOOR, from + i * MIN, { from: i % 2 ? 'offline' : 'online', to: i % 2 ? 'online' : 'offline' });
		};
		const c = low(18); // bridge offline, then back
		at(c, 'bridge_state', null, NOW - 5 * H, { from: 'online', to: 'offline' });
		flaps(c, NOW - 5 * H + MIN);
		at(c, 'bridge_state', null, NOW - 5 * H + 3 * MIN, { from: 'offline', to: 'online' });
		expect(batteryLow(c)[0].severity).toBe('warning');
		const d = low(18); // real silence
		Object.assign(d.state.bridge, { silenceEndedAt: NOW - 5 * H, silenceMs: 30 * MIN });
		flaps(d, NOW - 5 * H - 10 * MIN);
		expect(batteryLow(d)[0].severity).toBe('warning');
		const e = low(18); // many devices dropped at once
		for (let i = 0; i < 10; i++) at(e, 'availability', `0xother${i}`, NOW - 3 * H, { from: 'online', to: 'offline' });
		flaps(e, NOW - 3 * H);
		expect(batteryLow(e)[0].severity).toBe('warning');
	});

	it('silence needs at least silenceMinH, not only 2 × the typical gap, and none during grace', () => {
		expect(batteryLow(low(18, { typicalGapMs: 10 * MIN, lastSeenAt: NOW - 30 * MIN }))[0].severity).toBe('warning');
		const c = low(18, { typicalGapMs: H, lastSeenAt: NOW - 3 * H });
		c.state.monitor.startedAt = NOW - 5 * MIN;
		expect(batteryLow(c)[0].severity).toBe('warning');
	});

	it('silence counts from the end of a real silence (plus grace), not from before it', () => {
		const c = low(30, { typicalGapMs: H, lastSeenAt: NOW - 3.5 * H });
		Object.assign(c.state.bridge, { silenceEndedAt: NOW - 20 * MIN, silenceMs: 3 * H });
		expect(batteryLow(c)).toEqual([]);
	});

	it('a coin cell escalates only at or below voltageLow', () => {
		const c = ctx();
		Object.assign(dev(c, TEMP), { battery: 50, voltage: 2.85 });
		for (let i = 0; i < 3; i++) at(c, 'device_announce', TEMP, NOW - (i + 1) * 10 * MIN);
		expect(batteryLow(c)).toEqual([]);
		dev(c, TEMP).voltage = 2.8;
		expect(batteryLow(c)[0].severity).toBe('critical');
	});

	it('over consecutive runs: opens critical, drops silently to warning after 48 h stable, stays open, no loop', () => {
		const c = low(30);
		rejoins(c, 3);
		const issues: IssueRow[] = [];
		const counters = { seen: new Map(), missing: new Map() };
		const notes: string[] = [];
		const severities: string[] = [];
		const start = c.now;
		for (let k = 0; k < 60; k++) {
			c.now = start + k * H;
			c.events = (c.longEvents ?? []).filter((e) => e.ts >= c.now - 24 * H);
			Object.assign(c.state.bridge, { lastLiveAt: c.now, lastDeviceAt: c.now });
			dev(c, DOOR).lastSeenAt = c.now;
			const open = issues.filter((i) => i.state !== 'resolved');
			c.open = new Set(open.map((i) => issueKey(i.rule, i.ieee)));
			c.openCritical = new Set(open.filter((i) => i.severity === 'critical').map((i) => issueKey(i.rule, i.ieee)));
			const r = evaluate({ device: (ieee) => c.state.devices.get(ieee), findings: batteryLow(c), issues: open, counters, mutedUntil: () => null, settings: c.settings, now: c.now, networkQuiet: false });
			for (const f of r.opens) issues.push({ id: issues.length + 1, ...newIssue(f, c.now, true) });
			for (const { id, patch } of r.updates) Object.assign(issues[id - 1], patch);
			notes.push(...r.notify.map((x) => `${x.kind}:${x.severity}`));
			severities.push(issues[0]?.severity ?? '-');
		}
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({ state: 'open', severity: 'warning', summary: 'Battery low in door_sensor: 30% / 2.7 V' });
		expect(notes.filter((n) => !n.startsWith('reminder'))).toEqual(['open:critical']); // no escalate, resolve or reopen
		expect(severities[47]).toBe('critical');
		expect(severities[49]).toBe('warning');
	});
});

describe('battery.stale', () => {
	const stale = (gapH: number, lastAgoDays: number, ieee = DOOR) => {
		const c = ctx();
		c.history.baselines.set(`${ieee}|battery_report_gap_h`, { value: gapH, days: 30 });
		c.history.baselines.set(`${ieee}|battery_last_report`, { value: NOW - lastAgoDays * 24 * H, days: 30 });
		return c;
	};

	it('fires at 8 days for a daily reporter', () => {
		expect(batteryStale(stale(24, 8))).toEqual([{
			rule: 'battery.stale', ieee: DOOR, severity: 'info',
			summary: 'No battery report from door_sensor for 8 days',
			action: 'Check the device and its battery',
			evidence: { lastReportAt: NOW - 8 * 24 * H, typicalGapH: 24 }
		}]);
	});

	it('not at 6 days, not for a weekly reporter, not for a mains device', () => {
		expect(batteryStale(stale(1, 6))).toEqual([]);
		expect(batteryStale(stale(168, 8))).toEqual([]);
		expect(batteryStale(stale(1, 8, HALL))).toEqual([]);
	});

	it('never notifies', () => {
		const c = stale(1, 8);
		const counters = { seen: new Map(), missing: new Map() };
		const input = { issues: [], counters, mutedUntil: () => null, settings: c.settings, networkQuiet: false, device: () => undefined };
		evaluate({ ...input, findings: batteryStale(c), now: NOW });
		const r = evaluate({ ...input, findings: batteryStale(c), now: NOW + MIN });
		expect(r.opens).toHaveLength(1);
		expect(r.notify).toEqual([]);
	});
});

describe('rechargeable batteries', () => {
	const NIMH = { tags: ['rechargeable'] };
	it('battery.low uses the rechargeable thresholds: 36 % is fine, 10 % warns, 5 % is critical', () => {
		expect(run(DOOR, { ...NIMH, battery: 36 })).toEqual([]);
		expect(run(DOOR, { battery: 36 }, true)).toHaveLength(1); // untagged: unchanged
		expect(run(DOOR, { ...NIMH, battery: 10 })[0].severity).toBe('warning');
		expect(run(DOOR, { ...NIMH, battery: 5 })[0].severity).toBe('critical');
	});

	it('battery.low on a tagged device holds up to 20 % and clears above', () => {
		expect(run(DOOR, { ...NIMH, battery: 20 }, true)).toHaveLength(1);
		expect(run(DOOR, { ...NIMH, battery: 21 }, true)).toEqual([]);
	});

	it('the device\'s own battery_low flag still counts', () => {
		expect(run(DOOR, { ...NIMH, battery: 60, batteryLow: true })).toHaveLength(1);
	});

	const drop = (value: number | null, patch: Partial<DeviceState> = NIMH, open = false) => {
		const c = ctx();
		Object.assign(dev(c, DOOR), { battery: 22 }, patch);
		if (value !== null) c.history.baselines.set(`${DOOR}|battery_drop`, { value, days: 4 });
		if (open) c.open.add(issueKey('battery.dropping', DOOR));
		return batteryDropping(c);
	};

	it('battery.dropping warns at a 15-point drop since the battery went in, tagged devices only', () => {
		expect(drop(16)).toEqual([{
			rule: 'battery.dropping', ieee: DOOR, severity: 'warning',
			summary: 'Rechargeable battery in door_sensor dropped 16 points to 22%',
			action: 'Recharge or replace the battery soon',
			evidence: { battery: 22, drop: 16 }
		}]);
		expect(drop(14)).toEqual([]);
		expect(drop(16, {})).toEqual([]); // untagged
		expect(drop(null)).toEqual([]);
	});

	it('battery.dropping holds while open down to 8 points, and leaves it to battery.low at the low threshold', () => {
		expect(drop(8, NIMH, true)).toHaveLength(1);
		expect(drop(7, NIMH, true)).toEqual([]);
		expect(drop(30, { ...NIMH, battery: 10 })).toEqual([]);
	});
});

describe('isBatteryLow (the shopping list uses the rule condition)', () => {
	const d = (o: Partial<DeviceState>) => ({ powerSource: 'Battery', maxVoltage: 3.0, voltage: 3.0, battery: 80, batteryLow: null, tags: [], ...o }) as DeviceState;
	it('a coin cell at 2.8 V is low even at 80 %', () => expect(isBatteryLow(d({ voltage: 2.8 }), DEFAULT_SETTINGS)).toBe(true));
	it('a healthy coin cell is not low', () => expect(isBatteryLow(d({}), DEFAULT_SETTINGS)).toBe(false));
	it('percentage and the device flag count, rechargeables use their own threshold', () => {
		expect(isBatteryLow(d({ maxVoltage: null, voltage: null, battery: 25 }), DEFAULT_SETTINGS)).toBe(true);
		expect(isBatteryLow(d({ maxVoltage: null, voltage: null, batteryLow: true }), DEFAULT_SETTINGS)).toBe(true);
		expect(isBatteryLow(d({ maxVoltage: null, voltage: null, battery: 30, tags: ['rechargeable'] }), DEFAULT_SETTINGS)).toBe(false);
	});
});
