import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../../tests/helpers/fixtures';
import { openDb } from './db';
import { events, samples } from './db/schema';
import { route } from './mqtt/route';
import { applyEffects, flushDevices, loadDevices, muteUntil } from './store';
import { FOREVER } from '../views';
import { createState } from './types';

const B = 'zigbee2mqtt';
function run() {
	const db = openDb(':memory:');
	const state = createState(1760000000000);
	const dirty = new Set<string>();
	const live = { ts: 1760000060000, topic: `${B}/temp_sensor`, retain: false,
		payload: { battery: 88, voltage: 2990, linkquality: 100 } };
	// startup is all retained, so add one live message to produce a sample
	for (const m of [...loadFixture('startup'), live]) applyEffects(db, route(state, m, B), dirty);
	return { db, state, dirty };
}

describe('store', () => {
	it('persists dirty devices and reloads them', () => {
		const { db, state, dirty } = run();
		expect(dirty.size).toBeGreaterThan(0);
		flushDevices(db, state, dirty);
		expect(dirty.size).toBe(0);
		const s2 = createState(0);
		loadDevices(db, s2);
		expect(s2.devicesLoaded).toBe(false);
		expect(s2.devices.size).toBe(state.devices.size);
		for (const [ieee, d] of state.devices) {
			const r = s2.devices.get(ieee)!;
			expect(r.friendlyName).toBe(d.friendlyName);
			expect(r.availability).toBe(d.availability);
			expect(r.typicalGapMs).toBe(d.typicalGapMs);
			expect(r.maxVoltage).toBe(d.maxVoltage);
			expect(r.battery).toBe(d.battery);
			expect(s2.byName.get(d.friendlyName)).toBe(ieee);
		}
	});

	it('writes events and samples', () => {
		const { db } = run();
		expect(db.select().from(events).all().length).toBeGreaterThan(0);
		expect(db.select().from(samples).all().length).toBeGreaterThan(0);
	});
});

describe('muteUntil', () => {
	it('maps durations and rejects anything else, including prototype keys', () => {
		expect(muteUntil('1h', 1000)).toBe(1000 + 3_600_000);
		expect(muteUntil('7d', 0)).toBe(7 * 24 * 3_600_000);
		expect(muteUntil('forever', 5)).toBe(FOREVER);
		expect(muteUntil('unmute', 5)).toBeNull();
		for (const bad of ['toString', 'constructor', '__proto__', 'hasOwnProperty', '2h', ''])
			expect(muteUntil(bad, 5)).toBeUndefined();
	});
});
