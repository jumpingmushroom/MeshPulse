import { describe, expect, it } from 'vitest';
import { openDb } from './db';
import { devices } from './db/schema';
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
});
