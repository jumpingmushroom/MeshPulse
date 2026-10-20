import { describe, expect, it } from 'vitest';
import { loadFixture } from '../../../tests/helpers/fixtures';
import { openDb } from './db';
import { devices, events, healthSamples, samples } from './db/schema';
import { route } from './mqtt/route';
import { eq } from 'drizzle-orm';
import { applyEffects, flushDevices, loadDevices, muteUntil, setBatteryType, setIgnoredRule, setTag } from './store';
import { FOREVER } from '../views';
import { createState } from './types';

const B = 'zigbee2mqtt';
function run() {
	const db = openDb(':memory:');
	const state = createState(1760000000000);
	const dirty = new Set<string>();
	const live = { ts: 1760000060000, topic: `${B}/temp_sensor`, retain: false,
		payload: { battery: 88, voltage: 2990, linkquality: 100, battery_low: true } };
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
		expect([...s2.devices.values()].some((d) => d.batteryLow === true)).toBe(true);
		for (const [ieee, d] of state.devices) {
			const r = s2.devices.get(ieee)!;
			expect(r.friendlyName).toBe(d.friendlyName);
			expect(r.availability).toBe(d.availability);
			expect(r.typicalGapMs).toBe(d.typicalGapMs);
			expect(r.maxVoltage).toBe(d.maxVoltage);
			expect(r.battery).toBe(d.battery);
			expect(r.batteryLow).toBe(d.batteryLow); // a restart must not resolve a battery_low issue
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

describe('setBatteryType', () => {
	it('writes memory and DB, reloads, and clears', () => {
		const { db, state, dirty } = run();
		flushDevices(db, state, dirty);
		const ieee = state.byName.get('temp_sensor')!;
		expect(setBatteryType(db, state, ieee, 'AA', 2)).toBe(true);
		expect(state.devices.get(ieee)).toMatchObject({ batteryType: 'AA', batteryCells: 2 });
		const s2 = createState(0);
		loadDevices(db, s2);
		expect(s2.devices.get(ieee)).toMatchObject({ batteryType: 'AA', batteryCells: 2 });
		setBatteryType(db, state, ieee, null, null);
		const s3 = createState(0);
		loadDevices(db, s3);
		expect(s3.devices.get(ieee)).toMatchObject({ batteryType: null, batteryCells: null });
		expect(setBatteryType(db, state, 'nope', 'AA', 1)).toBe(false);
	});
});

describe('setIgnoredRule', () => {
	it('adds and removes a rule in memory and DB, idempotent, survives a reload', () => {
		const { db, state, dirty } = run();
		flushDevices(db, state, dirty);
		const ieee = state.byName.get('temp_sensor')!;
		const reload = () => { const s = createState(0); loadDevices(db, s); return s.devices.get(ieee)!.ignoreRules; };
		expect(setIgnoredRule(db, state, ieee, 'lqi.weak', true)).toBe(true);
		setIgnoredRule(db, state, ieee, 'lqi.weak', true);
		expect(state.devices.get(ieee)!.ignoreRules).toEqual(['lqi.weak']);
		expect(reload()).toEqual(['lqi.weak']);
		setIgnoredRule(db, state, ieee, 'lqi.weak', false);
		expect(reload()).toEqual([]);
		expect(setIgnoredRule(db, state, 'nope', 'lqi.weak', true)).toBe(false);
	});
});

describe('setTag', () => {
	it('setTag toggles chatty in DB and memory', () => {
		const { db, state, dirty } = run();
		flushDevices(db, state, dirty);
		const ieee = state.byName.get('temp_sensor')!;
		const d = state.devices.get(ieee)!;
		d.tags = ['chatty'];
		const tags = () => db.select({ tags: devices.tags }).from(devices).where(eq(devices.ieee, ieee)).get()!.tags;
		expect(setTag(db, state, ieee, 'ignore', true)).toBe(true);
		expect(d.tags).toEqual(['chatty', 'ignore']);
		expect(tags()).toEqual({ chatty: true, ignore: true });
		setTag(db, state, ieee, 'ignore', true); // idempotent
		expect(d.tags).toEqual(['chatty', 'ignore']);
		setTag(db, state, ieee, 'ignore', false);
		expect(d.tags).toEqual(['chatty']);
		expect(tags()).toEqual({ chatty: true });
		expect(setTag(db, state, 'nope', 'ignore', true)).toBe(false);
	});
});

it('setTag toggles chatty in DB and memory (chatty)', () => {
	const { db, state, dirty } = run();
	flushDevices(db, state, dirty);
	const ieee = state.byName.get('temp_sensor')!;
	setTag(db, state, ieee, 'chatty', true);
	expect(state.devices.get(ieee)!.tags).toEqual(['chatty']);
	expect(db.select({ t: devices.tags }).from(devices).where(eq(devices.ieee, ieee)).get()!.t).toEqual({ chatty: true });
	setTag(db, state, ieee, 'chatty', false);
	expect(state.devices.get(ieee)!.tags).toEqual([]);
});

it('lastHealth survives restart via the latest sample', () => {
	const db = openDb(':memory:');
	const dirty = new Set<string>();
	const h = (ts: number, leaves: number) => ({ kind: 'health' as const, ts, uptimeSec: 5, mqttQueued: 2, devices: { a: { leaves, addr: 0 } } });
	applyEffects(db, [h(1, 1), h(2, 3)], dirty);
	const s = createState(0);
	loadDevices(db, s);
	expect(s.lastHealth).toEqual({ a: { leaves: 3, addr: 0 } });
	expect(db.select().from(healthSamples).all()[0]).toMatchObject({ mqttQueued: 2, uptimeSec: 5 });
	const empty = createState(0);
	loadDevices(openDb(':memory:'), empty);
	expect(empty.lastHealth).toBeNull();
});
