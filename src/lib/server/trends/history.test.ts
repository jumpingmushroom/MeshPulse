import { describe, expect, it } from 'vitest';
import { openDb } from '../db/index';
import { baselines, samplesHourly } from '../db/schema';
import { baselineOf, loadHistory } from './history';

const H = 3_600_000;
const NOW = Date.UTC(2026, 9, 18, 12, 30);
const at = (ago: number) => Date.UTC(2026, 9, 18, 12) - ago * H;
const row = (ieee: string, ago: number, lqiAvg: number | null) =>
	({ ieee, hour: at(ago), lqiMin: null, lqiAvg, lqiMax: null, batteryMin: null, voltageMin: null, msgCount: 1 });

describe('loadHistory', () => {
	it('loads last 24 h ascending and all baselines', () => {
		const db = openDb(':memory:');
		db.insert(samplesHourly).values([row('0x1', 1, 80), row('0x1', 25, 10), row('0x1', 24, 70), row('0x2', 3, null), row('0x1', 5, 90)]).run();
		db.insert(baselines).values([
			{ ieee: '0x1', metric: 'lqi_mean', value: 85, days: 4, computedAt: NOW },
			{ ieee: '', metric: 'route_errors_hourly', value: 0.5, days: 7, computedAt: NOW }
		]).run();
		const h = loadHistory(db, NOW);
		const { ieee: _i, ...r } = row('0x1', 24, 70);
		expect(h.hourly.get('0x1')).toEqual([r, { ...r, hour: at(5), lqiAvg: 90 }, { ...r, hour: at(1), lqiAvg: 80 }]);
		expect(h.hourly.get('0x2')).toHaveLength(1);
		expect(baselineOf(h, '0x1', 'lqi_mean')).toEqual({ value: 85, days: 4 });
		expect(baselineOf(h, '', 'route_errors_hourly')).toEqual({ value: 0.5, days: 7 });
		expect(baselineOf(h, '0x2', 'lqi_mean')).toBeUndefined();
	});
});
