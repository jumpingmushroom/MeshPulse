import { describe, expect, it } from 'vitest';
import { initAreaRows } from './area-rows';

describe('initAreaRows', () => {
	it('gives each saved area a stable id and maps each AP to its area id', () => {
		const r = initAreaRows([{ name: 'Kitchen', match: 'k' }, { name: 'Hall', match: 'Hall' }],
			[{ mac: 'a', area: 'Hall' }, { mac: 'b', area: null }, { mac: 'c', area: 'Gone' }]);
		expect(r.rows).toEqual([{ id: 's0', name: 'Kitchen', match: 'k' }, { id: 's1', name: 'Hall', match: 'Hall' }]);
		expect(r.apSel).toEqual({ a: 's1', b: '', c: '' });
	});
});
