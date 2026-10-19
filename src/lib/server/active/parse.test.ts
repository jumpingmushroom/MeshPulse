import { describe, expect, it } from 'vitest';
import { parseCoordinatorCheck } from './parse';

describe('parseCoordinatorCheck', () => {
	it('returns the missing router ieees', () => {
		expect(parseCoordinatorCheck({ missing_routers: [{ ieee_address: '0xa', friendly_name: 'a' }, { ieee_address: '0xb', friendly_name: 'b' }] })).toEqual(['0xa', '0xb']);
		expect(parseCoordinatorCheck({ missing_routers: [] })).toEqual([]);
	});
	it('throws on an unexpected shape', () => {
		for (const bad of [null, {}, { missing_routers: 'x' }, { missing_routers: [{ friendly_name: 'a' }] }])
			expect(() => parseCoordinatorCheck(bad)).toThrow();
	});
});
