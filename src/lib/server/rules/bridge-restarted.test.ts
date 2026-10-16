import { describe, expect, it } from 'vitest';
import { ctx, ev, H, MIN, NOW } from '../../../../tests/helpers/ctx';
import { bridgeRestarted } from './bridge-restarted';

const restart = (ts: number) => ev({ ts, ieee: null, kind: 'bridge_restart', detail: { reason: 'state' } });

describe('bridge.restarted', () => {
	it('is info for one restart 30 min ago', () => {
		const c = ctx();
		c.events = [restart(NOW - 30 * MIN)];
		const [f] = bridgeRestarted(c);
		expect(f).toMatchObject({ rule: 'bridge.restarted', ieee: null, severity: 'info' });
	});

	it('is a warning with 3 restarts in 24 h', () => {
		const c = ctx();
		c.events = [restart(NOW - 20 * H), restart(NOW - 5 * H), restart(NOW - 10 * MIN)];
		expect(bridgeRestarted(c)[0].severity).toBe('warning');
	});

	it('is nothing 61 min after the last restart', () => {
		const c = ctx();
		c.events = [restart(NOW - 61 * MIN)];
		expect(bridgeRestarted(c)).toEqual([]);
	});
});
