import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './server/settings';
import { changed, groupKeys, THRESHOLDS, thresholdFields } from './settings-groups';

describe('threshold groups', () => {
	it('lists every numeric setting exactly once', () => {
		const keys = thresholdFields().map((f) => f.key).sort();
		const numeric = Object.entries(DEFAULT_SETTINGS).filter(([, v]) => typeof v === 'number').map(([k]) => k).sort();
		expect(keys).toEqual(numeric);
	});

	it('every field has a name for error messages and every row has a sentence with text', () => {
		for (const f of thresholdFields()) expect(f.name, f.key).not.toBe('');
		for (const g of THRESHOLDS) for (const r of [...g.rows, ...g.more]) expect(r.parts.some((p) => typeof p === 'string'), r.label).toBe(true);
	});

	it('groupKeys covers rows and more settings', () => {
		const battery = THRESHOLDS.find((g) => g.title === 'Battery')!;
		expect(groupKeys(battery)).toEqual(expect.arrayContaining(['batteryLowPct', 'coinCellMaxV']));
	});

	it('changed lists keys that differ from the default, numerically', () => {
		const defaults = { a: 25, b: 2.8, c: 10 };
		expect(changed(['a', 'b', 'c'], { a: 25, b: '2.80', c: 12 }, defaults)).toEqual(['c']);
		expect(changed(['a'], { a: '' }, defaults)).toEqual(['a']); // an emptied field is a change, not the default
	});
});
