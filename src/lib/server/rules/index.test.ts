import { describe, expect, it } from 'vitest';
import { ctx, dev, DOOR, HALL, LAMP, MIN, NOW, TEMP } from '../../../../tests/helpers/ctx';
import { evaluateRules, inGrace, issueKey, RULE_DEFAULTS, RULES } from './index';

describe('rules index', () => {
	it('removed and ignored devices produce no findings', () => {
		const c = ctx();
		Object.assign(dev(c, HALL), { availability: 'offline', removedAt: NOW - MIN });
		Object.assign(dev(c, LAMP), { availability: 'offline', tags: ['ignore'] });
		Object.assign(dev(c, DOOR), { battery: 5, ignoreRules: ['battery.low'] });
		Object.assign(dev(c, TEMP), { battery: 5 });
		expect(evaluateRules(c).map((f) => issueKey(f.rule, f.ieee))).toEqual([issueKey('battery.low', TEMP)]);
	});

	it('keeps an ignoreRules entry scoped to that rule', () => {
		const c = ctx();
		Object.assign(dev(c, DOOR), { availability: 'offline', ignoreRules: ['battery.low'] });
		expect(evaluateRules(c).map((f) => f.rule)).toEqual(['device.offline']);
	});

	it('is quiet on a healthy baseline', () => {
		expect(evaluateRules(ctx())).toEqual([]);
	});

	it('computes grace from the later of monitor start and Z2M restart', () => {
		const c = ctx();
		expect(inGrace(c)).toBe(false);
		c.state.bridge.restartedAt = NOW - 14 * MIN;
		expect(inGrace(c)).toBe(true);
		c.state.bridge.restartedAt = NOW - 15 * MIN;
		expect(inGrace(c)).toBe(false);
	});

	it('has defaults for every rule', () => {
		expect(RULES).toHaveLength(22);
		expect(RULE_DEFAULTS['device.rejoin_churn']).toEqual({ minRuns: 2, resolveRuns: 2, deviceLevel: true, notify: true });
		expect(RULE_DEFAULTS['network.churn'].deviceLevel).toBe(false);
		expect(RULE_DEFAULTS['bridge.mqtt_backlog'].deviceLevel).toBe(false);
		expect(RULE_DEFAULTS['monitor.mqtt_lost']).toEqual({ minRuns: 1, resolveRuns: 2, deviceLevel: false, notify: true });
		expect(RULE_DEFAULTS['bridge.permit_join_open'].minRuns).toBe(1);
		expect(RULE_DEFAULTS['device.offline']).toEqual({ minRuns: 2, resolveRuns: 2, deviceLevel: true, notify: true });
		expect(RULE_DEFAULTS['battery.low'].deviceLevel).toBe(true);
		expect(RULE_DEFAULTS['lqi.weak']).toEqual({ minRuns: 2, resolveRuns: 2, deviceLevel: true, notify: true });
		expect(RULE_DEFAULTS['network.route_errors'].deviceLevel).toBe(false);
		expect(RULE_DEFAULTS['network.mass_offline']).toEqual({ minRuns: 2, resolveRuns: 2, deviceLevel: false, notify: true });
		expect(RULE_DEFAULTS['battery.forecast']).toEqual({ minRuns: 1, resolveRuns: 2, deviceLevel: true, notify: false });
	});
});
