import { describe, expect, it } from 'vitest';
import { ctx, flip, H, LAMP, MIN, NOW } from '../../../../tests/helpers/ctx';
import { issueKey } from './index';
import { deviceFlapping } from './device-flapping';

const flips = (n: number, start = NOW - 5 * H, step = 30 * MIN) =>
	Array.from({ length: n }, (_, i) => flip(LAMP, start + i * step, i % 2 ? 'offline' : 'online', i % 2 ? 'online' : 'offline'));

describe('device.flapping', () => {
	it('warns at 4 availability changes in 6 h', () => {
		const c = ctx();
		c.events = flips(4);
		const [f] = deviceFlapping(c);
		expect(f).toMatchObject({ rule: 'device.flapping', ieee: LAMP, severity: 'warning' });
		expect(f.evidence.changes).toBe(4);
	});

	it('is nothing at 3 changes, or with older events outside the window', () => {
		const c = ctx();
		c.events = flips(3);
		expect(deviceFlapping(c)).toEqual([]);
		c.events = [...flips(2, NOW - 8 * H), ...flips(3)];
		expect(deviceFlapping(c)).toEqual([]);
	});

	it('does not count first-ever availability (from null)', () => {
		const c = ctx();
		c.events = [flip(LAMP, NOW - 4 * H, null, 'online'), ...flips(3)];
		expect(deviceFlapping(c)).toEqual([]);
	});

	it('does not count changes within graceMin after a Z2M restart', () => {
		const c = ctx();
		const r = NOW - 4 * H;
		c.state.bridge.restartedAt = r;
		c.events = [...flips(2, r + MIN, MIN), ...flips(3, NOW - 2 * H)];
		expect(deviceFlapping(c)).toEqual([]);
	});

	it('also skips changes after earlier restarts from the event log', () => {
		const c = ctx();
		const r = NOW - 4 * H;
		c.events = [
			{ id: 999, ts: r, ieee: null, kind: 'bridge_restart', detail: {} },
			...flips(2, r + MIN, MIN),
			...flips(3, NOW - 2 * H)
		];
		expect(deviceFlapping(c)).toEqual([]);
	});

	it('skips changes after the start of a restart noticed from uptime, before its event', () => {
		const c = ctx();
		const r = NOW - 4 * H;
		c.events = [
			...flips(2, r - 4 * MIN, MIN),
			{ id: 999, ts: r, ieee: null, kind: 'bridge_restart', detail: { reason: 'uptime', to: 300 } },
			...flips(3, NOW - 2 * H)
		];
		expect(deviceFlapping(c)).toEqual([]);
	});

	it('when open, keeps firing at 2 changes and stops at 1', () => {
		const c = ctx();
		c.open.add(issueKey('device.flapping', LAMP));
		c.events = flips(2);
		expect(deviceFlapping(c)).toHaveLength(1);
		c.events = flips(1);
		expect(deviceFlapping(c)).toEqual([]);
	});

	it('is suppressed in grace', () => {
		const c = ctx();
		c.state.monitor.startedAt = NOW - 5 * MIN;
		c.events = flips(5);
		expect(deviceFlapping(c)).toEqual([]);
	});
});
