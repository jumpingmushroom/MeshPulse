import { describe, expect, it } from 'vitest';
import { BATTERY_TYPES, batteryOf, builtinBattery, KNOWN_TYPES, lookup } from './battery-types';

const dev = (o: Partial<Parameters<typeof batteryOf>[0]> = {}) => ({ vendor: 'Aqara', model: 'WSDCGQ11LM', batteryType: null, batteryCells: null, ...o });

describe('battery types', () => {
	it('vendor|model beats model', () => {
		const table = { 'Acme|X1': { type: 'AA', cells: 2 }, X1: { type: 'AAA', cells: 1 } };
		expect(lookup(table, 'Acme', 'X1')).toEqual({ type: 'AA', cells: 2 });
		expect(lookup(table, 'Other', 'X1')).toEqual({ type: 'AAA', cells: 1 });
	});

	it('knows the Aqara temperature sensor', () => {
		expect(builtinBattery('Aqara', 'WSDCGQ11LM')).toEqual({ type: 'CR2032', cells: 1 });
	});

	it('gives null for an unknown model and for a device not interviewed yet', () => {
		expect(builtinBattery('Acme', 'NOPE-1')).toBeNull();
		expect(builtinBattery(null, null)).toBeNull();
		expect(batteryOf(dev({ vendor: null, model: null }))).toBeNull();
	});

	it('an override beats the table; cells default to 1', () => {
		expect(batteryOf(dev({ batteryType: 'AA', batteryCells: 2 }))).toEqual({ type: 'AA', cells: 2, source: 'override' });
		expect(batteryOf(dev({ batteryType: 'LR44', batteryCells: null }))).toEqual({ type: 'LR44', cells: 1, source: 'override' });
	});

	it('falls back to the table', () => {
		expect(batteryOf(dev())).toEqual({ type: 'CR2032', cells: 1, source: 'builtin' });
	});

	it('every entry is valid', () => {
		expect(Object.keys(BATTERY_TYPES).length).toBeGreaterThan(20);
		for (const [model, b] of Object.entries(BATTERY_TYPES)) {
			expect(b.type, model).not.toBe('');
			expect(Number.isInteger(b.cells) && b.cells >= 1 && b.cells <= 8, model).toBe(true);
		}
		expect(KNOWN_TYPES).toContain('CR2032');
	});
});
