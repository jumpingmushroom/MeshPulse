import { describe, expect, it } from 'vitest';
import { COORD, ctx, DOOR, H, LAMP, NOW } from '../../../../tests/helpers/ctx';
import type { HourlyRow } from '../trends/history';
import { hourStart } from '../trends/rollup';
import { evaluate, newIssue, type IssueRow } from '../issues/lifecycle';
import { evaluateRules, issueKey, type RuleContext } from './index';
import { lqiDegrading, lqiWeak } from './lqi';

const hour = (ago: number, lqiAvg: number | null): HourlyRow =>
	({ hour: hourStart(NOW) - ago * H, lqiMin: lqiAvg, lqiAvg, lqiMax: lqiAvg, batteryMin: null, voltageMin: null, msgCount: 1 });
/** `n` hours of data at `avg`, most recent first (1 h ago, 2 h ago, ...) */
const hours = (n: number, avg: number, from = 1) => Array.from({ length: n }, (_, i) => hour(from + i, avg)).reverse();

function setup(ieee: string, rows: HourlyRow[], opts: { open?: string; baseline?: { value: number; days: number } } = {}): RuleContext {
	const c = ctx();
	c.history.hourly.set(ieee, rows);
	if (opts.baseline) c.history.baselines.set(`${ieee}|lqi_mean`, opts.baseline);
	if (opts.open) c.open.add(issueKey(opts.open, ieee));
	return c;
}

describe('lqi.weak and lqi.degrading', () => {
	it('a weak device gets one issue: degrading does not open while lqi.weak is open or firing', () => {
		const baseline = { value: 80, days: 7 };
		expect(lqiDegrading(setup(DOOR, hours(24, 20), { baseline }))).toEqual([]);
		expect(lqiDegrading(setup(DOOR, hours(24, 35), { baseline, open: 'lqi.weak' }))).toEqual([]);
		expect(lqiDegrading(setup(DOOR, hours(24, 35), { baseline }))).toHaveLength(1);
	});
});

describe('lqi.weak', () => {
	it('fires below 30 with 6+ hours of data', () => {
		const [f, ...rest] = lqiWeak(setup(DOOR, hours(6, 25)));
		expect(rest).toEqual([]);
		expect(f).toMatchObject({ rule: 'lqi.weak', ieee: DOOR, severity: 'warning', summary: 'Weak link to door_sensor (LQI 25)',
			evidence: { avg: 25, hours: 6, threshold: 30 } });
	});

	it('needs data in at least 6 hours', () => {
		expect(lqiWeak(setup(DOOR, [...hours(5, 10), hour(7, null)]))).toEqual([]);
	});

	it('never critical', () => {
		expect(lqiWeak(setup(DOOR, hours(24, 5)))[0].severity).toBe('warning');
	});

	it('stops only above 40 over 12 h', () => {
		// older hours are weak; the last 12 h decide once open
		const rows = (recent: number) => [...hours(12, 10, 13), ...hours(12, recent)];
		expect(lqiWeak(setup(DOOR, rows(35), { open: 'lqi.weak' }))).toHaveLength(1);
		expect(lqiWeak(setup(DOOR, rows(41), { open: 'lqi.weak' }))).toEqual([]);
	});

	it('judges an open issue on 24 h when the last 12 h have no data', () => {
		expect(lqiWeak(setup(DOOR, hours(12, 10, 13), { open: 'lqi.weak' }))).toHaveLength(1);
		expect(lqiWeak(setup(DOOR, hours(12, 45, 13), { open: 'lqi.weak' }))).toEqual([]);
	});

	it('stops an open issue when the last 24 h have no data', () => {
		expect(lqiWeak(setup(DOOR, [hour(5, null)], { open: 'lqi.weak' }))).toEqual([]);
		expect(lqiWeak(setup(DOOR, [], { open: 'lqi.weak' }))).toEqual([]);
	});

	it('does not open while the last 12 h are already above the clear level', () => {
		expect(lqiWeak(setup(DOOR, [...hours(12, 15, 13), ...hours(12, 42)]))).toEqual([]);
	});

	it('skips the coordinator and devices without history', () => {
		expect(lqiWeak(setup(COORD, hours(24, 5)))).toEqual([]);
		expect(lqiWeak(ctx())).toEqual([]);
	});
});

describe('lqi.degrading', () => {
	const base = { value: 100, days: 3 };

	it('fires 25% below baseline', () => {
		const [f] = lqiDegrading(setup(LAMP, hours(24, 74), { baseline: base }));
		expect(f).toMatchObject({ rule: 'lqi.degrading', ieee: LAMP, severity: 'warning',
			summary: 'Link to living/lamp degrading (LQI 74, normally 100)', evidence: { avg: 74, hours: 24, baseline: 100, baselineDays: 3 } });
		expect(lqiDegrading(setup(LAMP, hours(24, 76), { baseline: base }))).toEqual([]);
	});

	it('needs 3 days of baseline', () => {
		expect(lqiDegrading(setup(LAMP, hours(24, 50), { baseline: { value: 100, days: 2 } }))).toEqual([]);
		expect(lqiDegrading(setup(LAMP, hours(24, 50)))).toEqual([]);
	});

	it('needs data in at least 6 hours', () => {
		expect(lqiDegrading(setup(LAMP, hours(5, 50), { baseline: base }))).toEqual([]);
	});

	it('recovers within 10%', () => {
		const rows = (recent: number) => [...hours(12, 50, 13), ...hours(12, recent)];
		expect(lqiDegrading(setup(LAMP, rows(91), { open: 'lqi.degrading', baseline: base }))).toEqual([]);
		expect(lqiDegrading(setup(LAMP, rows(89), { open: 'lqi.degrading', baseline: base }))).toHaveLength(1);
		expect(lqiDegrading(setup(LAMP, hours(12, 50, 13), { open: 'lqi.degrading', baseline: base }))).toHaveLength(1);
		expect(lqiDegrading(setup(LAMP, [], { open: 'lqi.degrading', baseline: base }))).toEqual([]);
	});

	it('does not open while the last 12 h are already within 10%', () => {
		expect(lqiDegrading(setup(LAMP, [...hours(12, 50, 13), ...hours(12, 91)], { baseline: base }))).toEqual([]);
	});
});

describe('lqi rules via evaluateRules', () => {
	it('removed, ignored and muted handling unchanged', () => {
		const c = setup(DOOR, hours(24, 10));
		c.history.hourly.set(LAMP, hours(24, 10));
		c.state.devices.get(LAMP)!.mutedUntil = NOW + H; // muting is the lifecycle's job: still a finding
		expect(evaluateRules(c).map((f) => issueKey(f.rule, f.ieee))).toEqual([issueKey('lqi.weak', LAMP), issueKey('lqi.weak', DOOR)]);
		c.state.devices.get(DOOR)!.removedAt = NOW - H;
		c.state.devices.get(LAMP)!.ignoreRules = ['lqi.weak'];
		expect(evaluateRules(c)).toEqual([]);
		c.state.devices.get(LAMP)!.ignoreRules = [];
		c.state.devices.get(LAMP)!.tags = ['ignore'];
		expect(evaluateRules(c)).toEqual([]);
	});
});

describe('lqi rules through the lifecycle', () => {
	/** One run a minute: `bad` history for the first 3 runs, then `good`; returns the notify kinds. */
	function replay(bad: RuleContext, good: RuleContext, runs = 30) {
		const issues: IssueRow[] = [];
		const counters = { seen: new Map(), missing: new Map() };
		const kinds: string[] = [];
		for (let k = 0; k < runs; k++) {
			const now = NOW + k * 60_000;
			const open = issues.filter((i) => i.state !== 'resolved');
			const c = { ...(k < 3 ? bad : good), now, open: new Set(open.map((i) => issueKey(i.rule, i.ieee))) };
			c.state.bridge.lastDeviceAt = now; // keep the bridge live as time advances
			const r = evaluate({ findings: evaluateRules(c), issues: open, counters, mutedUntil: () => null, settings: c.settings, now, networkQuiet: false });
			for (const f of r.opens) issues.push({ id: issues.length + 1, ...newIssue(f, now, true) });
			for (const { id, patch } of r.updates) Object.assign(issues[id - 1], patch);
			kinds.push(...r.notify.map((n) => `${n.key.split('|')[0]} ${n.kind}`));
		}
		return kinds;
	}

	it('a recovered weak link resolves once and does not reopen', () => {
		// 24 h avg 28.5 stays below 30 while the last 12 h (42) are above the clear level
		expect(replay(setup(DOOR, [...hours(12, 15, 13), ...hours(12, 10)]), setup(DOOR, [...hours(12, 15, 13), ...hours(12, 42)])))
			.toEqual(['lqi.weak open', 'lqi.weak resolved']);
	});

	it('a recovered degrading link resolves once and does not reopen', () => {
		const base = { baseline: { value: 100, days: 3 } };
		// 24 h avg 70.5 stays 25% below while the last 12 h (91) are within 10%
		expect(replay(setup(LAMP, [...hours(12, 50, 13), ...hours(12, 50)], base), setup(LAMP, [...hours(12, 50, 13), ...hours(12, 91)], base)))
			.toEqual(['lqi.degrading open', 'lqi.degrading resolved']);
	});
});
