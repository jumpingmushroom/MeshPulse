import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings';
import { isQuietHours } from './quiet';

const TZ = 'Europe/Oslo';
const S = DEFAULT_SETTINGS;
const utc = (iso: string) => Date.parse(iso);
const q = (iso: string) => isQuietHours(utc(iso), S, TZ);

describe('quiet hours', () => {
	// 2026-10-16 Oslo is CEST (UTC+2)
	it('23:30 Oslo is quiet', () => expect(q('2026-10-16T21:30:00Z')).toBe(true));
	it('06:59 quiet', () => expect(q('2026-10-16T04:59:00Z')).toBe(true));
	it('07:00 not quiet', () => {
		expect(q('2026-10-16T05:00:00Z')).toBe(false);
		expect(q('2026-10-16T20:59:00Z')).toBe(false); // 22:59
	});

	it('quietEnabled false never quiet', () => {
		expect(isQuietHours(utc('2026-10-16T21:30:00Z'), { ...S, quietEnabled: false }, TZ)).toBe(false);
	});

	it('follows the DST change', () => {
		// 2026-10-25: Oslo leaves summer time at 03:00 CEST -> 02:00 CET, so 07:00 local is 06:00Z
		expect(q('2026-10-25T05:30:00Z')).toBe(true); // 06:30 CET (a fixed +2 offset would say 07:30)
		expect(q('2026-10-25T06:00:00Z')).toBe(false);
	});
});
