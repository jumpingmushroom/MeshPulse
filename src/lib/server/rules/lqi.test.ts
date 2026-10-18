import { describe, expect, it } from 'vitest';
import { COORD, ctx, DOOR, H, LAMP, NOW } from '../../../../tests/helpers/ctx';
import type { HourlyRow } from '../trends/history';
import { hourStart } from '../trends/rollup';
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

	it('holds an open issue when the last 12 h have no data', () => {
		expect(lqiWeak(setup(DOOR, hours(12, 10, 13), { open: 'lqi.weak' }))).toHaveLength(1);
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
