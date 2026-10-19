import { describe, expect, it } from 'vitest';
import { ctx, HALL, dev } from '../../../../tests/helpers/ctx';
import { evaluateRules } from './index';
import { missingRouter } from './missing-router';

const withMissing = (m: string[] | null) => { const c = ctx(); c.active = { missingRouters: m, scanFailStreak: 0 }; return c; };

describe('coordinator.missing_router', () => {
	it('fires per missing router with the re-pair action', () => {
		const f = missingRouter(withMissing([HALL]));
		expect(f).toHaveLength(1);
		expect(f[0]).toMatchObject({ rule: 'coordinator.missing_router', ieee: HALL, severity: 'warning' });
		expect(f[0].action).toBe(`Re-pair ${dev(withMissing([]), HALL).friendlyName} so the coordinator knows it again`);
	});
	it('is silent without a check or with none missing', () => {
		expect(missingRouter(ctx())).toEqual([]);
		expect(missingRouter(withMissing(null))).toEqual([]);
		expect(missingRouter(withMissing([]))).toEqual([]);
	});
	it('ignores ignore-tagged routers and ieees Z2M no longer lists', () => {
		const c = withMissing([HALL, '0xdead']);
		expect(missingRouter(c).map((x) => x.ieee)).toEqual([HALL]);
		dev(c, HALL).tags.push('ignore');
		expect(evaluateRules(c).filter((x) => x.rule === 'coordinator.missing_router')).toEqual([]);
		expect(missingRouter(c)).toEqual([]);
	});
});
