import { describe, expect, it } from 'vitest';
import { ctx, dev, DOOR, HALL, TEMP } from '../../../../tests/helpers/ctx';
import type { DeviceState } from '../types';
import { issueKey } from './index';
import { batteryLow } from './battery';

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
