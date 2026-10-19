import { describe, expect, it } from 'vitest';
import { batteriesDue, banner, learning, peakQuiet, RULE_LABELS, scoreLabel, groupedSummary, batteryRows, splitBatteries, navSummary, formatDaysLeft, counters, deviceRows, chartFor, humanise, liveDevice, evidenceRows, formatAgo, formatDetail, formatVoltage, sortIssues, sortRows, filterRows } from './views';
import type { DeviceState, Severity } from './server/types';

const dev = (o: Partial<DeviceState>): DeviceState => ({
	ieee: '0x1', friendlyName: 'd', type: 'EndDevice', powerSource: null, model: null, vendor: null, firmware: null,
	networkAddress: null, availability: 'online', lastSeenAt: null, removedAt: null, mutedUntil: null, tags: [],
	ignoreRules: [], typicalGapMs: null, maxVoltage: null, lqi: null, battery: null, voltage: null, batteryLow: null,
	recentSeen: [], lastSampleAt: null, offlineSince: null, ...o
});
const state = (ds: DeviceState[]) => ({ devices: new Map(ds.map((d) => [d.ieee, d])) });

describe('views', () => {
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
		const rows = deviceRows(s, [{ ieee: 'a', severity: 'warning' }, { ieee: 'a', severity: 'critical' }, { ieee: null, severity: 'critical' }]);
		expect(rows).toEqual([expect.objectContaining({ ieee: 'a', name: 'Lamp', lqi: 80, openIssues: 2, score: 67 })]);
	});

	it('leaves stats null without samples', () => {
		const [r] = deviceRows(state([dev({ ieee: 'a' })]), []);
		expect([r.lqi24, r.lqiBase, r.msgH]).toEqual([null, null, null]);
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

	it('sorts by score', () => {
		const r = deviceRows(state([dev({ ieee: 'a', friendlyName: 'a' }), dev({ ieee: 'b', friendlyName: 'b' })]), [{ ieee: 'b', severity: 'warning' }]);
		expect(sortRows(r, 'score', true).map((x) => x.name)).toEqual(['b', 'a']);
	});

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
			['Offline since', '16 Oct 2026, 17:47'], ['Threshold', '3 h 12 min'], ['Count', '4'], ['Rule', 'x'], ['Tags', '["a"]']
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

describe('navSummary', () => {
	const i = (severity: Severity, parentIssueId: number | null = null) => ({ severity, parentIssueId });
	it('counts top-level issues and picks the worst severity', () => {
		expect(navSummary([i('warning'), i('critical', 1), i('info')], { connected: true, downSince: null, startedAt: 5 }))
			.toEqual({ count: 2, worst: 'warning', stale: false, staleSince: null });
	});
	it('is stale while MQTT is down', () => {
		expect(navSummary([], { connected: false, downSince: 1000, startedAt: 5 })).toEqual({ count: 0, worst: null, stale: true, staleSince: 1000 });
	});
	it('falls back to the start time when MQTT never connected', () => {
		expect(navSummary([], { connected: false, downSince: null, startedAt: 5 }).staleSince).toBe(5);
	});
});

describe('labels', () => {
	it('labels every rule', () => {
		for (const id of ['bridge.offline', 'battery.stale', 'network.storm'] as const) expect(RULE_LABELS[id]).toBeTruthy();
	});
	it('scoreLabel', () => { expect([scoreLabel('green'), scoreLabel('amber'), scoreLabel('red')]).toEqual(['Good', 'Fair', 'Poor']); });
	it('groupedSummary counts per rule, most first', () => {
		const c = (rule: string) => ({ rule });
		expect(groupedSummary([c('device.offline'), c('device.flapping'), c('device.offline')])).toBe('3 grouped issues: 2 device offline, 1 device flapping');
		expect(groupedSummary([c('device.offline')])).toBe('1 grouped issue: 1 device offline');
	});
});

describe('banner', () => {
	const w = { severity: 'warning' as const, summary: 'Weak link', action: 'Move a router closer' };
	const c = { severity: 'critical' as const, summary: 'Zigbee bridge is offline', action: 'Check the Zigbee2MQTT container' };
	it('all good', () => expect(banner([])).toEqual({ tone: 'ok', kicker: 'All good', title: 'All good', sub: 'No open issues.' }));
	it('warnings', () => expect(banner([w, w])).toEqual({ tone: 'warn', kicker: 'Needs attention', title: '2 unresolved issues', sub: 'Nothing critical. Start with: Move a router closer.' }));
	it('one warning', () => expect(banner([w]).title).toBe('1 unresolved issue'));
	it('critical', () => expect(banner([c, w])).toEqual({ tone: 'crit', kicker: 'Critical', title: 'Zigbee bridge is offline', sub: '1 critical issue and 1 warning. Start with: Check the Zigbee2MQTT container.' }));
});
it('learning', () => {
	expect(learning(null, 0)).toEqual({ hours: 0, done: false });
	expect(learning(0, 2 * 3_600_000)).toEqual({ hours: 2, done: false });
	expect(learning(0, 72 * 3_600_000)).toEqual({ hours: 72, done: true });
});
it('peakQuiet', () => {
	expect(peakQuiet([], 'Europe/Oslo')).toBeNull();
	const H = 3_600_000, t = Date.UTC(2026, 9, 18, 5);
	expect(peakQuiet([{ t, v: 312 }, { t: t + H, v: 40 }, { t: t + 2 * H, v: 142 }], 'Europe/Oslo')).toEqual({ now: 142, peak: '312/min at 07:00', quiet: '08:00' });
});

it('batteriesDue', () => {
	const st = state([dev({ ieee: 'a', friendlyName: 'A' }), dev({ ieee: 'b', friendlyName: 'B' }), dev({ ieee: 'c', friendlyName: 'C', removedAt: 1 })]);
	const rows = [{ ieee: 'b', days: 12.4 }, { ieee: 'a', days: 3 }, { ieee: 'c', days: 1 }, { ieee: 'x', days: 2 }, { ieee: 'a2', days: 40 }];
	expect(batteriesDue(rows, st)).toEqual([{ name: 'A', days: 3 }, { name: 'B', days: 12 }]);
});

describe('chartFor', () => {
	it('maps rules to a chart', () => {
		expect(chartFor('battery.low')).toBe('battery');
		expect(chartFor('lqi.degrading')).toBe('lqi');
		expect(chartFor('route.failures')).toBe('lqi');
		expect(chartFor('device.storm')).toBe('msgs');
		expect(chartFor('device.dominant')).toBe('msgs');
		expect(chartFor('bridge.offline')).toBeNull();
	});
});

describe('evidence links and liveDevice', () => {
	it('links device lists and falls back to text when a name is unknown', () => {
		const m = new Map([['a', '0x1'], ['b', '0x2']]);
		expect(evidenceRows({ names: ['a', 'b'], top: [{ name: 'a', perMin: 12 }] }, 'UTC', m)).toEqual([
			['Devices', [{ text: 'a', href: '/devices/0x1' }, { text: 'b', href: '/devices/0x2' }]],
			['Top senders', [{ text: 'a (12/min)', href: '/devices/0x1' }]]
		]);
		expect(evidenceRows({ names: ['a', 'zz'] }, 'UTC', m)).toEqual([['Devices', '["a","zz"]']]);
	});
	it('treats a removed device as no device', () => {
		const m = new Map([['0x1', { removedAt: null }], ['0x2', { removedAt: 5 }]]);
		expect(liveDevice(m, '0x1')).toBeDefined();
		expect(liveDevice(m, '0x2')).toBeUndefined();
		expect(liveDevice(m, null)).toBeUndefined();
	});
});

describe('evidence humanising', () => {
	it('words camelCase keys, shows booleans as Yes/No and hides level', () => {
		expect(humanise('coinCell')).toBe('Coin cell');
		expect(humanise('')).toBe('');
		expect(evidenceRows({ level: 'battery.low', batteryLow: true, coinCell: false }, 'UTC')).toEqual([['Battery low', 'Yes'], ['Coin cell', 'No']]);
	});
});

describe('filterRows', () => {
	const rows = deviceRows(state([
		dev({ ieee: 'a', friendlyName: 'Attic plug', type: 'Router' }),
		dev({ ieee: 'b', friendlyName: 'Hall plug', type: 'Router' }),
		dev({ ieee: 'c', friendlyName: 'Door', battery: 50 })
	]), [{ ieee: 'b', severity: 'warning' }, { ieee: 'c', severity: 'info' }]);
	const none = { q: '', routers: false, battery: false, offline: false, issues: false };

	it('matches the name case-insensitively', () => {
		expect(filterRows(rows, { ...none, q: 'attic' }).map((r) => r.name)).toEqual(['Attic plug']);
	});

	it('ANDs the chips', () => {
		expect(filterRows(rows, { ...none, routers: true, issues: true }).map((r) => r.name)).toEqual(['Hall plug']);
	});
});

describe('splitBatteries', () => {
	const r = (name: string, daysLeft: number | null) => ({ ieee: name, name, battery: 50, voltage: null, daysLeft, lastSwapAt: null, low: false, trend: '' });
	it('splits by days left and orders each group', () => {
		const out = splitBatteries([r('z', null), r('late', 55), r('soon', 6), r('a', null)]);
		expect(out.soon.map((x) => x.name)).toEqual(['soon']);
		expect(out.later.map((x) => x.name)).toEqual(['late']);
		expect(out.none.map((x) => x.name)).toEqual(['a', 'z']);
	});
});
