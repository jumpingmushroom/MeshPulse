import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCoordinatorCheck, parseNetworkmap } from './parse';

describe('parseCoordinatorCheck', () => {
	it('returns the missing router ieees', () => {
		expect(parseCoordinatorCheck({ missing_routers: [{ ieee_address: '0xa', friendly_name: 'a' }, { ieee_address: '0xb', friendly_name: 'b' }] })).toEqual(['0xa', '0xb']);
		expect(parseCoordinatorCheck({ missing_routers: [] })).toEqual([]);
	});
	it('parses a real coordinator_check response', () => {
		const fixture = JSON.parse(readFileSync(new URL('./fixtures/coordinator-check.json', import.meta.url), 'utf8'));
		const expected = fixture.data.missing_routers.map((r: { ieee_address: string }) => r.ieee_address);
		expect(expected.length).toBeGreaterThan(0);
		expect(parseCoordinatorCheck(fixture.data)).toEqual(expected);
	});
	it('throws on an unexpected shape', () => {
		for (const bad of [null, {}, { missing_routers: 'x' }, { missing_routers: [{ friendly_name: 'a' }] }])
			expect(() => parseCoordinatorCheck(bad)).toThrow();
	});
});

const MAP = {
	type: 'raw', routes: false,
	value: {
		nodes: [
			{ ieeeAddr: '0xc', friendlyName: 'Coordinator', type: 'Coordinator', networkAddress: 0 },
			{ ieeeAddr: '0xa', friendlyName: 'a', type: 'Router', networkAddress: 1, failed: ['lqi'] },
			{ ieeeAddr: '0xb', friendlyName: 'b', type: 'EndDevice', networkAddress: 2, failed: [] }
		],
		links: [
			{ source: { ieeeAddr: '0xb', networkAddress: 2 }, target: { ieeeAddr: '0xa', networkAddress: 1 }, linkquality: 90, depth: 1, relationship: 1, routes: [] },
			{ source: { ieeeAddr: '0xa', networkAddress: 1 }, target: { ieeeAddr: '0xc', networkAddress: 0 }, lqi: 120, linkquality: 120, depth: 0, relationship: 2, routes: [] }
		]
	}
};

describe('parseNetworkmap', () => {
	it('maps nodes and links', () => {
		const r = parseNetworkmap(MAP);
		expect(r.nodes).toEqual([{ ieee: '0xc', type: 'Coordinator', failed: false }, { ieee: '0xa', type: 'Router', failed: true }, { ieee: '0xb', type: 'EndDevice', failed: false }]);
		expect(r.links).toEqual([
			{ source: '0xb', target: '0xa', lqi: 90, depth: 1, relationship: 1 },
			{ source: '0xa', target: '0xc', lqi: 120, depth: 0, relationship: 2 }
		]);
	});
	it('throws on an unexpected shape', () => {
		for (const bad of [null, {}, { value: {} }, { value: { nodes: [{ type: 'Router' }], links: [] } }, { value: { nodes: [], links: [{ source: {}, target: {} }] } }])
			expect(() => parseNetworkmap(bad)).toThrow();
	});
});
