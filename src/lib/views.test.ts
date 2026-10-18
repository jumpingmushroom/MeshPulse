import { describe, expect, it } from 'vitest';
import { batteryRows, formatDaysLeft, counters, deviceRows, evidenceRows, formatAgo, formatDetail, formatVoltage, overallStatus, sortIssues, sortRows } from './views';
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

	it('counts routers and batteries <= batteryLowPct', () => {
		const s = state([
			dev({ ieee: 'c', type: 'Coordinator' }),
			dev({ ieee: 'r1', type: 'Router' }),
			dev({ ieee: 'r2', type: 'Router', availability: 'offline' }),
			dev({ ieee: 'e1', battery: 24 }),
			dev({ ieee: 'e2', battery: 25, availability: null }),
			dev({ ieee: 'gone', type: 'Router', removedAt: 1 })
		]);
		expect(counters(s, 25)).toEqual({ devicesOnline: 2, devicesTotal: 4, routersOnline: 1, routersTotal: 2, batteriesLow: 2 });
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

describe('evidenceRows', () => {
	it('hides nulls and formats times, durations and objects', () => {
		const ts = Date.UTC(2026, 9, 16, 15, 47);
		expect(evidenceRows({ offlineSince: ts, lastSeenAt: null, typicalGapMs: undefined, thresholdMs: 3 * 3_600_000 + 12 * 60_000,
			count: 4, rule: 'x', tags: ['a'] }, 'Europe/Oslo')).toEqual([
			['offlineSince', '16 Oct 2026, 17:47'], ['thresholdMs', '3 h 12 min'], ['count', '4'], ['rule', 'x'], ['tags', '["a"]']
		]);
	});
});

describe('formatVoltage', () => {
	it('shows one decimal, two when needed', () => {
		expect(formatVoltage(3)).toBe('3.0');
		expect(formatVoltage(2.95)).toBe('2.95');
		expect(formatVoltage(2.8)).toBe('2.8');
		expect(formatVoltage(0.7)).toBe('0.7');
		expect(formatVoltage(null)).toBe('—');
	});
});

describe('formatDetail', () => {
	it('reads from/to as arrows and other details as key: value', () => {
		expect(formatDetail('availability', { from: 'offline', to: 'online' })).toBe('offline → online');
		expect(formatDetail('availability', { from: null, to: 'online' })).toBe('— → online');
		expect(formatDetail('battery_swap', { from: 20, to: 100 })).toBe('20% → 100%');
		expect(formatDetail('bridge_restart', { reason: 'uptime', from: 5, to: 1 })).toBe('reason: uptime, from: 5, to: 1');
		expect(formatDetail('join', { a: { b: 1 } })).toBe('a: {"b":1}');
		expect(formatDetail('leave', null)).toBe('');
	});
});

describe('batteryRows', () => {
	const b = (ieee: string, o: Partial<DeviceState> = {}) => dev({ ieee, friendlyName: ieee, powerSource: 'Battery', battery: 50, ...o });

	it('sorts by days left, unknown last', () => {
		const rows = batteryRows([b('a', { battery: 40 }), b('b', { battery: 90 }), b('c', { battery: 30 }), b('d', { battery: 60 })],
			new Map([['b', 5], ['d', 40]]), new Map([['b', 123]]));
		expect(rows.map((r) => r.ieee)).toEqual(['b', 'd', 'c', 'a']);
		expect(rows[0]).toMatchObject({ daysLeft: 5, lastSwapAt: 123 });
		expect(rows[3]).toMatchObject({ daysLeft: null, lastSwapAt: null });
	});

	it('excludes mains and removed devices', () => {
		const rows = batteryRows([b('a'), b('m', { powerSource: 'Mains (single phase)' }), b('r', { removedAt: 1 })], new Map(), new Map());
		expect(rows.map((r) => r.ieee)).toEqual(['a']);
	});

	it('puts low-now rows first by charge, nulls last in their group', () => {
		const rows = batteryRows([b('f', { battery: 60 }), b('x', { battery: null }), b('l2', { battery: 25 }), b('l1', { battery: 0 }), b('fl', { battery: 90, batteryLow: true }), b('n', { battery: 70 })],
			new Map([['f', 3], ['l1', 1]]), new Map(), 25);
		expect(rows.map((r) => r.ieee)).toEqual(['l1', 'l2', 'fl', 'f', 'n', 'x']);
		expect(rows.map((r) => r.low)).toEqual([true, true, true, false, false, false]);
	});

	it('formats days left', () => {
		expect([0.4, 1.2, 18.4].map(formatDaysLeft)).toEqual(['less than a day', 'about 1 day', 'about 18 days']);
	});
});
