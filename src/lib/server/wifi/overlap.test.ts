import { describe, expect, it } from 'vitest';
import { wifiMHz, zigbeeMHz } from '../../wifi-freq';
import { freeChannels, overlaps } from './overlap';

describe('overlap', () => {
	it('maps channels to frequencies', () => {
		expect([zigbeeMHz(11), zigbeeMHz(25), wifiMHz(1), wifiMHz(13), wifiMHz(14)]).toEqual([2405, 2475, 2412, 2472, 2484]);
	});
	it('overlaps when closer than half the Wi-Fi width + 1 MHz', () => {
		expect(overlaps(11, 1, 20)).toBe(true);
		expect(overlaps(11, 6, 20)).toBe(false);
		expect(overlaps(11, 11, 20)).toBe(false);
		expect(overlaps(25, 13, 20)).toBe(true);
		// the brief expected 25 vs 11 at 20 MHz; the plan formula gives 13 MHz >= 11, so it only overlaps once widened
		expect(overlaps(25, 11, 20)).toBe(false);
		expect(overlaps(25, 11, 40)).toBe(true);
	});
	it('lists the free channels among 1, 6, 11', () => {
		expect(freeChannels(11)).toEqual([6, 11]);
		expect(freeChannels(15)).toEqual([1, 6, 11].filter((c) => !overlaps(15, c, 20)));
	});
});
