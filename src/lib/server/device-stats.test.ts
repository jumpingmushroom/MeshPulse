import { describe, expect, it } from 'vitest';
import { openDb } from './db';
import { baselines, samplesHourly } from './db/schema';
import { deviceStats } from './device-stats';

const H = 3_600_000;
const NOW = 1000 * H + 1234;

describe('deviceStats', () => {
	it('is empty without data', () => {
		expect(deviceStats(openDb(':memory:'), NOW).size).toBe(0);
	});

	it('averages the last 24 full hours and reads the baseline', () => {
		const db = openDb(':memory:');
		const row = (hour: number, lqiAvg: number, msgCount: number) => ({ ieee: '0xa', hour, lqiAvg, msgCount });
		db.insert(samplesHourly).values([row(998 * H, 100, 10), row(999 * H, 80, 30), row(900 * H, 1, 999)]).run();
		db.insert(baselines).values({ ieee: '0xa', metric: 'lqi_mean', value: 90, days: 3, computedAt: NOW }).run();
		expect(deviceStats(db, NOW).get('0xa')).toEqual({ lqi24: 90, lqiBase: 90, msgH: 20 });
	});
});
