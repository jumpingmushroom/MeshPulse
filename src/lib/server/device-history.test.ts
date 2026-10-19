import { describe, expect, it } from 'vitest';
import { openDb } from './db';
import { devices, issues, samples } from './db/schema';
import { deviceCharts, noDataSpans } from './device-history';
import { DEFAULT_SETTINGS } from './settings';

describe('deviceCharts', () => {
	it('returns empty charts without samples', () => {
		const db = openDb(':memory:');
		const c = deviceCharts(db, '0x1', '7d', DEFAULT_SETTINGS, 1_760_000_000_000);
		expect(c.lqi.points).toEqual([]);
		expect(c.lqi.latest).toBeUndefined();
		expect(c.battery).toBeNull();
		expect(c.msgs.unit).toBe('/min');
	});
	it('adds battery and voltage for battery devices', () => {
		const db = openDb(':memory:');
		db.insert(devices).values({ ieee: '0x2', powerSource: 'Battery' }).run();
		const c = deviceCharts(db, '0x2', '24h', DEFAULT_SETTINGS, 1_760_000_000_000);
		expect(c.battery?.points).toEqual([]);
		expect(c.voltage?.latest).toBeUndefined();
	});
	it('keeps the coin cell low line inside the voltage range', () => {
		const db = openDb(':memory:');
		const now = 1_760_000_000_000;
		db.insert(devices).values({ ieee: '0x3', powerSource: 'Battery' }).run();
		db.insert(samples).values([{ ieee: '0x3', ts: now - 60_000, voltage: 3.0 }, { ieee: '0x3', ts: now - 30_000, voltage: 3.05 }]).run();
		const v = deviceCharts(db, '0x3', '24h', DEFAULT_SETTINGS, now).voltage!;
		expect(v.refs).toEqual([{ y: DEFAULT_SETTINGS.voltageLow, label: `Coin cell low ${DEFAULT_SETTINGS.voltageLow} V` }]);
		expect(v.y0).toBeLessThan(DEFAULT_SETTINGS.voltageLow);
	});
});

describe('noDataSpans', () => {
	const H = 3_600_000;
	const base = { avail: [], outages: [], rolledHours: [], firstRolledHour: null, currentHour: 100 * H };
	it('pairs offline with online', () => {
		const avail = [{ ts: 10 * H, to: 'offline' }, { ts: 12 * H, to: 'online' }];
		expect(noDataSpans({ ...base, avail }, 0, 50 * H)).toEqual([{ from: 10 * H, to: 12 * H }]);
	});
	it('counts an offline span open before t0, clipped to the window', () => {
		expect(noDataSpans({ ...base, avail: [{ ts: -5 * H, to: 'offline' }] }, 0, 50 * H)).toEqual([{ from: 0, to: 50 * H }]);
	});
	it('clips an open outage to t1', () => {
		expect(noDataSpans({ ...base, outages: [{ from: 40 * H, to: null }] }, 0, 50 * H)).toEqual([{ from: 40 * H, to: 50 * H }]);
	});
	it('counts whole unrolled past hours only, from the first rollup', () => {
		const rolledHours = [10 * H, 11 * H, 13 * H];
		const s = noDataSpans({ ...base, rolledHours, firstRolledHour: 10 * H, currentHour: 16 * H }, 5 * H, 16 * H + 1000);
		expect(s).toEqual([{ from: 12 * H, to: 13 * H }, { from: 14 * H, to: 15 * H }]); // not 5-10 h, not the unrolled previous or current hour
	});
	it('drops spans shorter than the minimum', () => {
		const avail = [{ ts: 10 * H, to: 'offline' }, { ts: 10 * H + 60_000, to: 'online' }, { ts: 20 * H, to: 'offline' }, { ts: 21 * H, to: 'online' }];
		expect(noDataSpans({ ...base, avail }, 0, 50 * H, 15 * 60_000)).toEqual([{ from: 20 * H, to: 21 * H }]);
	});
	it('handles several flips', () => {
		const avail = [{ ts: 1 * H, to: 'offline' }, { ts: 2 * H, to: 'online' }, { ts: 3 * H, to: 'offline' }, { ts: 4 * H, to: 'online' }];
		expect(noDataSpans({ ...base, avail }, 0, 50 * H)).toEqual([{ from: 1 * H, to: 2 * H }, { from: 3 * H, to: 4 * H }]);
	});
	it('does not flag the previous hour before its rollup lands', () => {
		const s = noDataSpans({ ...base, rolledHours: [10 * H], firstRolledHour: 10 * H, currentHour: 12 * H }, 10 * H, 12 * H + 1000);
		expect(s).toEqual([]);
	});
	it('merges overlapping spans', () => {
		const s = noDataSpans({ ...base, avail: [{ ts: 10 * H, to: 'offline' }, { ts: 14 * H, to: 'online' }],
			outages: [{ from: 12 * H, to: 16 * H }, { from: 20 * H, to: 21 * H }] }, 0, 50 * H);
		expect(s).toEqual([{ from: 10 * H, to: 16 * H }, { from: 20 * H, to: 21 * H }]);
	});
});

describe('deviceCharts gaps', () => {
	it('uses mqtt_lost outages and the device state when no event precedes the window', () => {
		const db = openDb(':memory:');
		const now = 1_760_000_000_000;
		db.insert(devices).values({ ieee: '0x8', availability: 'offline' }).run();
		db.insert(issues).values({ rule: 'monitor.mqtt_lost', severity: 'critical', state: 'open', openedAt: now - 3_600_000,
			updatedAt: now, summary: 's', action: 'a' }).run();
		const c = deviceCharts(db, '0x8', '24h', DEFAULT_SETTINGS, now);
		expect(c.lqi.gaps).toEqual([{ from: now - 24 * 3_600_000, to: now }]); // offline all window, merged with the outage
	});
	it('keeps the line through a quiet spell and reports an outage span', () => {
		const db = openDb(':memory:');
		const now = 1_760_000_000_000;
		db.insert(samples).values([{ ieee: '0x9', ts: now - 6 * 3_600_000, lqi: 100 }, { ieee: '0x9', ts: now - 3_600_000, lqi: 90 }]).run();
		db.insert(issues).values({ rule: 'bridge.offline', severity: 'critical', state: 'resolved', openedAt: now - 4 * 3_600_000,
			updatedAt: now, resolvedAt: now - 2 * 3_600_000, summary: 's', action: 'a' }).run();
		const c = deviceCharts(db, '0x9', '24h', DEFAULT_SETTINGS, now);
		expect(c.lqi.maxGapMs).toBe(Infinity);
		expect(c.lqi.gaps).toContainEqual({ from: now - 4 * 3_600_000, to: now - 2 * 3_600_000 });
	});
});
