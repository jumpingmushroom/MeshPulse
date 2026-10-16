import { describe, expect, it } from 'vitest';
import { counters, deviceRows, formatAgo, overallStatus, sortIssues, sortRows } from './views';
import type { DeviceState } from './server/types';

const dev = (o: Partial<DeviceState>): DeviceState => ({
	ieee: '0x1', friendlyName: 'd', type: 'EndDevice', powerSource: null, model: null, vendor: null, firmware: null,
	networkAddress: null, availability: 'online', lastSeenAt: null, removedAt: null, mutedUntil: null, tags: [],
	ignoreRules: [], typicalGapMs: null, maxVoltage: null, lqi: null, battery: null, voltage: null, batteryLow: null,
	recentSeen: [], lastSampleAt: null, offlineSince: null, ...o
});
const state = (ds: DeviceState[]) => ({ devices: new Map(ds.map((d) => [d.ieee, d])) });

describe('views', () => {
	it('green with no issues or only info', () => {
		expect(overallStatus([])).toBe('green');
		expect(overallStatus([{ severity: 'info' }])).toBe('green');
	});

	it('amber with any warning', () => {
		expect(overallStatus([{ severity: 'info' }, { severity: 'warning' }])).toBe('amber');
	});

	it('red with any critical', () => {
		expect(overallStatus([{ severity: 'warning' }, { severity: 'critical' }, { severity: 'info' }])).toBe('red');
	});

	it('sorts by severity then newest', () => {
		const out = sortIssues([
			{ id: 1, severity: 'info' as const, openedAt: 9 },
			{ id: 2, severity: 'warning' as const, openedAt: 1 },
			{ id: 3, severity: 'critical' as const, openedAt: 1 },
			{ id: 4, severity: 'warning' as const, openedAt: 5 }
		]);
		expect(out.map((i) => i.id)).toEqual([3, 4, 2, 1]);
	});

	it('counts routers and batteries < batteryLowPct', () => {
		const s = state([
			dev({ ieee: 'c', type: 'Coordinator' }),
			dev({ ieee: 'r1', type: 'Router' }),
			dev({ ieee: 'r2', type: 'Router', availability: 'offline' }),
			dev({ ieee: 'e1', battery: 24 }),
			dev({ ieee: 'e2', battery: 25, availability: null }),
			dev({ ieee: 'gone', type: 'Router', removedAt: 1 })
		]);
		expect(counters(s, 25)).toEqual({ devicesOnline: 2, devicesTotal: 4, routersOnline: 1, routersTotal: 2, batteriesLow: 1 });
	});

	it('builds device rows with open issue counts, skipping coordinator and removed', () => {
		const s = state([dev({ ieee: 'c', type: 'Coordinator' }), dev({ ieee: 'a', friendlyName: 'Lamp', lqi: 80 }), dev({ ieee: 'g', removedAt: 1 })]);
		const rows = deviceRows(s, [{ ieee: 'a' }, { ieee: 'a' }, { ieee: null }]);
		expect(rows).toEqual([expect.objectContaining({ ieee: 'a', name: 'Lamp', lqi: 80, openIssues: 2 })]);
	});

	it('formats ago', () => {
		expect(formatAgo(0, 30_000)).toBe('just now');
		expect(formatAgo(0, 5 * 60_000)).toBe('5 min ago');
		expect(formatAgo(0, 3 * 3_600_000)).toBe('3 h ago');
		expect(formatAgo(0, 50 * 3_600_000)).toBe('2 d ago');
	});
});

describe('sortRows', () => {
	const rows = deviceRows(state([
		dev({ ieee: 'a', friendlyName: 'b', type: 'Router', lqi: 50, battery: null, lastSeenAt: 2 }),
		dev({ ieee: 'b', friendlyName: 'a', lqi: null, battery: 80, lastSeenAt: 1, availability: 'offline' }),
		dev({ ieee: 'c', friendlyName: 'c', lqi: 10, battery: 20, lastSeenAt: null })
	]), []);
	const names = (key: Parameters<typeof sortRows>[1], asc: boolean) => sortRows(rows, key, asc).map((r) => r.name);

	it('sorts every column both ways with unknowns last', () => {
		expect(names('name', true)).toEqual(['a', 'b', 'c']);
		expect(names('name', false)).toEqual(['c', 'b', 'a']);
		expect(names('lqi', true)).toEqual(['c', 'b', 'a']);
		expect(names('lqi', false)).toEqual(['b', 'c', 'a']);
		expect(names('battery', true)).toEqual(['c', 'a', 'b']);
		expect(names('lastSeenAt', false)).toEqual(['b', 'a', 'c']);
		expect(names('type', true)).toEqual(['a', 'c', 'b']);
		expect(names('availability', true)).toEqual(['a', 'b', 'c']);
	});
});
