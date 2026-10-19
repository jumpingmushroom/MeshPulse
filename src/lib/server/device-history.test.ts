import { describe, expect, it } from 'vitest';
import { openDb } from './db';
import { devices, samples } from './db/schema';
import { deviceCharts } from './device-history';
import { DEFAULT_SETTINGS } from './settings';

describe('deviceCharts', () => {
	it('returns empty charts without samples', () => {
		const db = openDb(':memory:');
		const c = deviceCharts(db, '0x1', '7d', DEFAULT_SETTINGS, 1_760_000_000_000);
		expect(c.lqi.points).toEqual([]);
		expect(c.lqi.latest).toBeUndefined();
		expect(c.battery).toBeNull();
		expect(c.msgs.unit).toBe('/min');
	});
	it('adds battery and voltage for battery devices', () => {
		const db = openDb(':memory:');
		db.insert(devices).values({ ieee: '0x2', powerSource: 'Battery' }).run();
		const c = deviceCharts(db, '0x2', '24h', DEFAULT_SETTINGS, 1_760_000_000_000);
		expect(c.battery?.points).toEqual([]);
		expect(c.voltage?.latest).toBeUndefined();
	});
	it('keeps the coin cell low line inside the voltage range', () => {
		const db = openDb(':memory:');
		const now = 1_760_000_000_000;
		db.insert(devices).values({ ieee: '0x3', powerSource: 'Battery' }).run();
		db.insert(samples).values([{ ieee: '0x3', ts: now - 60_000, voltage: 3.0 }, { ieee: '0x3', ts: now - 30_000, voltage: 3.05 }]).run();
		const v = deviceCharts(db, '0x3', '24h', DEFAULT_SETTINGS, now).voltage!;
		expect(v.refs).toEqual([{ y: DEFAULT_SETTINGS.voltageLow, label: `Coin cell low ${DEFAULT_SETTINGS.voltageLow} V` }]);
		expect(v.y0).toBeLessThan(DEFAULT_SETTINGS.voltageLow);
	});
});
