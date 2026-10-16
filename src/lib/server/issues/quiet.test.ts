import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings';
import { isQuietHours, quietHoursEnded } from './quiet';

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

	it('quietHoursEnded true once when crossing 07:00', () => {
		// 2026-10-25: Oslo leaves summer time at 03:00 CEST -> 02:00 CET, so 07:00 local is 06:00Z
		expect(q('2026-10-25T05:30:00Z')).toBe(true); // 06:30 CET (a fixed +2 offset would say 07:30)
		const ends: string[] = [];
		for (let t = utc('2026-10-24T18:00:00Z'); t < utc('2026-10-25T18:00:00Z'); t += 60_000)
			if (quietHoursEnded(t, t + 60_000, S, TZ)) ends.push(new Date(t + 60_000).toISOString());
		expect(ends).toEqual(['2026-10-25T06:00:00.000Z']);
	});
});
