import { describe, expect, it } from 'vitest';
import { ctx, DOOR, NOW } from '../../../../tests/helpers/ctx';
import { evaluate, newIssue, type IssueRow } from '../issues/lifecycle';
import { evaluateRules, issueKey, type RuleContext } from './index';
import { batteryForecast } from './forecast';

function setup(daysLeft: number | null, open = false): RuleContext {
	const c = ctx();
	if (daysLeft !== null) c.history.baselines.set(`${DOOR}|battery_days_left`, { value: daysLeft, days: 12 });
	if (open) c.open.add(issueKey('battery.forecast', DOOR));
	return c;
}

describe('battery.forecast', () => {
	it('fires at 21 days, not at 22', () => {
		const [f, ...rest] = batteryForecast(setup(21));
		expect(rest).toEqual([]);
		expect(f).toMatchObject({ rule: 'battery.forecast', ieee: DOOR, severity: 'info', summary: 'Battery in door_sensor runs out in about 21 days',
			action: 'Buy a replacement battery', evidence: { daysLeft: 21, basedOnDays: 12 } });
		expect(batteryForecast(setup(22))).toEqual([]);
	});
	it('says so when at or below target', () => {
		expect(batteryForecast(setup(0))[0].summary).toBe('Battery in door_sensor is at or below 10%');
	});
	it('open stays at 25, stops at 31 or when the baseline is gone', () => {
		expect(batteryForecast(setup(25, true))).toHaveLength(1);
		expect(batteryForecast(setup(31, true))).toEqual([]);
		expect(batteryForecast(setup(null, true))).toEqual([]);
	});
	it('ignores devices that are not battery powered', () => {
		const c = setup(5);
		c.state.devices.get(DOOR)!.powerSource = 'Mains (single phase)';
		expect(evaluateRules(c).filter((f) => f.rule === 'battery.forecast')).toEqual([]);
	});
	it('never notifies through the lifecycle', () => {
		const issues: IssueRow[] = [];
		const counters = { seen: new Map(), missing: new Map() };
		const kinds: string[] = [];
		for (let k = 0; k < 10; k++) {
			const now = NOW + k * 60_000;
			const open = issues.filter((i) => i.state !== 'resolved');
			const c = { ...setup(k < 5 ? 10 : null), now, open: new Set(open.map((i) => issueKey(i.rule, i.ieee))) };
			c.state.bridge.lastDeviceAt = now;
			const r = evaluate({ findings: evaluateRules(c).filter((f) => f.rule === 'battery.forecast'), issues: open, counters, mutedUntil: () => null, settings: c.settings, now, networkQuiet: false });
			for (const f of r.opens) issues.push({ id: issues.length + 1, ...newIssue(f, now, false) });
			for (const { id, patch } of r.updates) Object.assign(issues[id - 1], patch);
			kinds.push(...r.notify.map((n) => n.kind));
		}
		expect(issues).toHaveLength(1);
		expect(issues[0].state).toBe('resolved');
		expect(kinds).toEqual([]);
	});
});
