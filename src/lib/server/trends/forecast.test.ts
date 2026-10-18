import { describe, expect, it } from 'vitest';
import { forecastDaysLeft } from './forecast';

const D = 86_400_000;
const series = (days: number, start: number, perDay: number) => Array.from({ length: days + 1 }, (_, i) => ({ t: i * D, battery: start - perDay * i }));

describe('forecastDaysLeft', () => {
	it('steady 1%/day from 40 reaches 10 in 30 days', () => {
		expect(forecastDaysLeft(series(10, 40, 1), 0, 10, 7)).toBeCloseTo(30);
	});
	it('flat series has no forecast', () => {
		expect(forecastDaysLeft(series(10, 40, 0), 0, 10, 7)).toBeNull();
	});
	it('less than 7 days has no forecast', () => {
		expect(forecastDaysLeft(series(6, 40, 1).slice(0, 6), 0, 10, 7)).toBeNull();
		expect(forecastDaysLeft([{ t: 0, battery: 40 }], 0, 10, 7)).toBeNull();
	});
	it('already below target returns 0', () => {
		expect(forecastDaysLeft(series(10, 20, 2), 10 * D, 10, 7)).toBe(0);
	});
});
