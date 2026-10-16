import { describe, expect, it } from 'vitest';
import { COORD, ctx, dev, DOOR, flip, H, LAMP, MIN, NOW } from '../../../../tests/helpers/ctx';
import { issueKey } from './index';
import { deviceOffline } from './device-offline';

const silent = (gap: number, ago: number) => {
	const c = ctx();
	dev(c, DOOR).typicalGapMs = gap;
	dev(c, DOOR).lastSeenAt = NOW - ago;
	return c;
};

describe('device.offline', () => {
	it('warns for a router reported offline, with offlineSince in evidence', () => {
		const c = ctx();
		Object.assign(dev(c, LAMP), { availability: 'offline', offlineSince: NOW - 10 * MIN });
		const [f] = deviceOffline(c);
		expect(f).toMatchObject({ rule: 'device.offline', ieee: LAMP, severity: 'warning' });
		expect(f.summary).toContain('living/lamp');
		expect(f.evidence.offlineSince).toBe(NOW - 10 * MIN);
	});

	it('warns for an end device reported offline; offlineSince falls back to the latest offline event', () => {
		const c = ctx();
		dev(c, DOOR).availability = 'offline';
		c.events = [flip(DOOR, NOW - 3 * H, 'online', 'offline')];
		const [f] = deviceOffline(c);
		expect(f).toMatchObject({ ieee: DOOR, severity: 'warning' });
		expect(f.evidence.offlineSince).toBe(NOW - 3 * H);
	});

	it('never reports the coordinator', () => {
		const c = ctx();
		dev(c, COORD).availability = 'offline';
		expect(deviceOffline(c)).toEqual([]);
	});

	it('clamps the silence threshold to 2 h for a 30 min gap (3 × 30 min < 2 h)', () => {
		expect(deviceOffline(silent(30 * MIN, 2 * H + 1000))).toHaveLength(1);
		expect(deviceOffline(silent(30 * MIN, 2 * H - MIN))).toEqual([]);
	});

	it('uses 3 × the typical gap inside the clamp (1 h gap -> 3 h)', () => {
		expect(deviceOffline(silent(H, 3 * H + 1000))).toHaveLength(1);
		expect(deviceOffline(silent(H, 3 * H))).toEqual([]);
	});

	it('clamps the silence threshold to 25 h for a 10 h gap', () => {
		expect(deviceOffline(silent(10 * H, 25 * H + 1000))).toHaveLength(1);
		expect(deviceOffline(silent(10 * H, 25 * H - MIN))).toEqual([]);
	});

	it('has no silence finding without a typical gap', () => {
		expect(deviceOffline(silent(null as unknown as number, 100 * H))).toEqual([]);
	});

	it('does not apply silence to routers', () => {
		const c = silent(H, 4 * H);
		dev(c, DOOR).typicalGapMs = null;
		Object.assign(dev(c, LAMP), { typicalGapMs: H, lastSeenAt: NOW - 4 * H });
		expect(deviceOffline(c)).toEqual([]);
	});

	it('suppresses silence in grace unless already open', () => {
		const c = silent(H, 4 * H);
		c.state.bridge.restartedAt = NOW - 5 * MIN;
		expect(deviceOffline(c)).toEqual([]);
		c.open.add(issueKey('device.offline', DOOR));
		expect(deviceOffline(c)).toHaveLength(1);
	});

	it('uses lastSeenAt as offlineSince for silence', () => {
		const [f] = deviceOffline(silent(H, 4 * H));
		expect(f.evidence.offlineSince).toBe(NOW - 4 * H);
	});

	it('stops once online and seen again', () => {
		const c = silent(H, 4 * H);
		c.open.add(issueKey('device.offline', DOOR));
		dev(c, DOOR).lastSeenAt = NOW - MIN;
		expect(deviceOffline(c)).toEqual([]);
	});
});
