import { describe, expect, it } from 'vitest';
import { openDb } from '../db/index';
import { wifiAps, wifiAreas } from '../db/schema';
import { apsNear, areaOf, candidateAreas, parseAreasForm, saveAreas, suggestArea } from './areas';

const AREAS = ['Kitchen', 'Basement', 'Living room', 'Datacenter', 'Bathroom'];

describe('suggestArea', () => {
	it('matches a whole word', () => {
		expect(suggestArea('Kitchen AP', AREAS)).toBe('Kitchen');
		expect(suggestArea('AP Basement', AREAS)).toBe('Basement');
		expect(suggestArea('Living room AP', AREAS)).toBe('Living room');
	});
	it('matches unique in-order letters of a 3+-letter first token', () => {
		expect(suggestArea('bas-wap-upro-01', AREAS)).toBe('Basement');
		expect(suggestArea('lvr-wap-ulr-01', AREAS)).toBe('Living room');
		expect(suggestArea('dtc-wap-01', AREAS)).toBe('Datacenter');
	});
	it('gives no hint for names without one', () => {
		for (const n of ['U6-Lite', 'AP-1', '70:a7:41:aa:bb:cc', '']) expect(suggestArea(n, AREAS)).toBeNull();
		expect(suggestArea('Kitchen AP', [])).toBeNull();
	});
	it('gives no hint when ambiguous', () => {
		expect(suggestArea('bat-ap', ['Bathroom', 'Battery room'])).toBeNull();
		expect(suggestArea('bsm-ap', ['Basement', 'Bosom'])).toBeNull();
		expect(suggestArea('Kitchen', ['Kitchen', 'Kitchen annex'])).toBe('Kitchen');
	});
});

describe('candidateAreas', () => {
	it('returns leading words seen at least twice', () => {
		expect(candidateAreas(['Living room lamp', 'Living room sofa', 'Basement stairs lamp', 'Basement door', 'Garage'])).toEqual(['Living room', 'Basement']);
	});
	it('ignores singletons, numbers and honours max', () => {
		expect(candidateAreas(['0x1 a', '0x1 b', 'Hall a', 'Hall b', 'Den a', 'Den b'], 1)).toEqual(['Hall']);
		expect(candidateAreas(['lamp'])).toEqual([]);
	});
});

describe('areaOf', () => {
	it('returns every area whose match occurs, case-insensitive', () => {
		const areas = [{ name: 'Kitchen', match: 'kitchen' }, { name: 'Upstairs', match: 'LAMP' }, { name: 'Bad', match: '' }];
		expect(areaOf('Kitchen Lamp', areas)).toEqual(['Kitchen', 'Upstairs']);
		expect(areaOf('Door', areas)).toEqual([]);
	});
});

describe('saveAreas', () => {
	it('replaces areas, defaults match to the name, and nulls APs on a removed area', () => {
		const db = openDb(':memory:');
		db.insert(wifiAps).values([{ mac: 'a', name: 'A', model: 'm', lastSeen: 1, area: 'Old' }, { mac: 'b', name: 'B', model: 'm', lastSeen: 1 }]).run();
		saveAreas(db, [{ name: 'Kitchen', match: '' }, { name: ' ', match: 'x' }, { name: 'Kitchen', match: 'dup' }], { a: 'Old', b: 'Kitchen' });
		expect(db.select().from(wifiAreas).all()).toEqual([{ name: 'Kitchen', match: 'Kitchen' }]);
		expect(db.select().from(wifiAps).all().map((r) => r.area)).toEqual([null, 'Kitchen']);
	});
});

describe('parseAreasForm', () => {
	const form = (rows: [string, string, string][], aps: Record<string, string> = {}) => {
		const f = new FormData();
		for (const [id, name, match] of rows) { f.append('areaId', id); f.append('areaName', name); f.append('areaMatch', match); }
		for (const [mac, v] of Object.entries(aps)) { f.append('apMac', mac); f.set(`ap:${mac}`, v); }
		return f;
	};
	it('trims, and carries AP assignments over a rename by row id', () => {
		const r = parseAreasForm(form([['s0', ' Lounge ', '']], { a: 's0', b: '' }));
		expect(r).toEqual({ areas: [{ name: 'Lounge', match: '' }], apAreas: { a: 'Lounge', b: null } });
	});
	it('rejects empty and duplicate names, and an unknown AP area', () => {
		expect('error' in parseAreasForm(form([['s0', '  ', '']]))).toBe(true);
		expect('error' in parseAreasForm(form([['s0', 'Kitchen', ''], ['s1', 'kitchen', '']]))).toBe(true);
		expect('error' in parseAreasForm(form([['s0', 'Kitchen', '']], { a: 'nope' }))).toBe(true);
	});
});

describe('apsNear', () => {
	const aps = [{ area: null }, { area: 'Kitchen' }, { area: 'Bedroom' }];
	it('returns all APs when the device has no area', () => expect(apsNear(aps, [])).toHaveLength(3));
	it('keeps APs without an area and in the device areas', () => expect(apsNear(aps, ['Kitchen'])).toEqual([aps[0], aps[1]]));
});
