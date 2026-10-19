import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../lib/server/settings';
import { GROUPS } from './groups';

it('lists every numeric setting exactly once', () => {
	const keys = GROUPS.flatMap(([, fs]) => fs.map(([k]) => k)).sort();
	const numeric = Object.entries(DEFAULT_SETTINGS).filter(([, v]) => typeof v === 'number').map(([k]) => k).sort();
	expect(keys).toEqual(numeric);
});
