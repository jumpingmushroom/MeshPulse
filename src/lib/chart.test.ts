import { describe, expect, it } from 'vitest';
import { autoRange, batteryTrend, buildSeries, fillHours, niceTicks, summarise } from './chart';

const box = { w: 100, h: 50, t0: 0, t1: 100, y0: 0, y1: 10 };

describe('buildSeries', () => {
	it('buildSeries handles empty, single and gapped input', () => {
		expect(buildSeries([], box, 10)).toEqual({ line: '', band: '', empty: true });
		expect(buildSeries([{ t: 5, v: null }], box, 10).empty).toBe(true);

		expect(buildSeries([{ t: 50, v: 5 }], box, 10)).toEqual({ line: 'M50,25', band: '', empty: false });

		const gapped = buildSeries([{ t: 0, v: 0 }, { t: 5, v: 10 }, { t: 50, v: 5 }, { t: 55, v: 5 }], box, 10);
		expect(gapped.line).toBe('M0,50L5,0M50,25L55,25');

		const broken = buildSeries([{ t: 0, v: 1 }, { t: 1, v: null }, { t: 2, v: 1 }], box, 10);
		expect(broken.line.match(/M/g)).toHaveLength(2);

		const banded = buildSeries([{ t: 0, v: 5, lo: 0, hi: 10 }, { t: 5, v: 5, lo: 0, hi: 10 }], box, 10);
		expect(banded.band).toBe('M0,0L5,0L5,50L0,50Z');

		const weird = buildSeries([{ t: 0, v: NaN }, { t: 1, v: Infinity }, { t: 2, v: 3, lo: null, hi: 4 }], { ...box, y1: 0 }, 10);
		expect(weird.line + weird.band).not.toContain('NaN');
		expect(weird.line + weird.band).not.toContain('Infinity');
	});
});

describe('niceTicks', () => {
	it('picks round steps', () => {
		expect(niceTicks(0, 255, 5)).toEqual([0, 50, 100, 150, 200, 250]);
		expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
		expect(niceTicks(2.9, 3.1, 4)).toEqual([2.9, 2.95, 3, 3.05, 3.1]);
		expect(niceTicks(0, 0, 5)).toEqual([0]);
		expect(niceTicks(0, 1, 4, 1)).toEqual([0, 1]);
		expect(niceTicks(0, 3, 4, 1)).toEqual([0, 1, 2, 3]);
	});
});

describe('autoRange and summarise', () => {
	it('pads data and handles none', () => {
		expect(autoRange([])).toEqual([0, 1]);
		expect(autoRange([null, 3])).toEqual([2.95, 3.05]);
		expect(autoRange([2.8, 3.0])).toEqual([2.75, 3.05]);
		expect(summarise('LQI', '', [])).toBe('LQI: no data yet.');
		expect(summarise('Battery', '%', [{ t: 0, v: 90 }, { t: 1, v: 80 }]))
			.toBe('Battery: latest 80 %, lowest 80 %, highest 90 % over 2 readings.');
	});
});

describe('fillHours', () => {
	it('fills silent hours with 0 from the first row to the last full hour', () => {
		const H = 3_600_000;
		expect(fillHours([], 5 * H)).toEqual([]);
		expect(fillHours([{ t: 2 * H, v: 4 }, { t: 4 * H, v: 1 }], 6 * H)).toEqual(
			[{ t: 2 * H, v: 4 }, { t: 3 * H, v: 0 }, { t: 4 * H, v: 1 }, { t: 5 * H, v: 0 }, { t: 6 * H, v: 0 }]);
	});
});

describe('batteryTrend', () => {
	it('spans the full width with a near-flat line for 80 -> 79 %', () => {
		expect(batteryTrend([{ t: 1000, v: 80 }, { t: 2000, v: 79 }], 96, 22, 5000)).toBe('M0,4.4L96,4.6');
	});
	it('is empty with fewer than 2 points', () => {
		expect(batteryTrend([{ t: 1, v: 80 }], 96, 22, 5000)).toBe('');
	});
});
