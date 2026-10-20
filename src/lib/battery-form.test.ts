import { describe, expect, it } from 'vitest';
import { parseBatteryForm } from './battery-form';

const form = (o: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.set(k, v);
	return f;
};
const OTHER = { field: 'other', message: 'Use 1-20 letters, digits, spaces or -' };
const CELLS = { field: 'cells', message: 'Cells must be 1-8' };

describe('parseBatteryForm', () => {
	it('takes a known type and cells', () => expect(parseBatteryForm(form({ type: 'CR2032', cells: '1' }))).toEqual({ type: 'CR2032', cells: 1 }));
	it('takes Other text', () => expect(parseBatteryForm(form({ type: 'Other', other: 'LR44 x3', cells: '2' }))).toEqual({ type: 'LR44 x3', cells: 2 }));
	it.each(['', 'x'.repeat(21), '<b>', '**x**', '@everyone'])('rejects Other text %j', (other) =>
		expect(parseBatteryForm(form({ type: 'Other', other, cells: '1' }))).toEqual(OTHER));
	it.each(['0', '9', 'x', ''])('rejects cells %j', (cells) => expect(parseBatteryForm(form({ type: 'AA', cells }))).toEqual(CELLS));
	it('rejects an unknown type value', () => expect(parseBatteryForm(form({ type: 'D-cell', cells: '1' }))).toEqual({ field: 'type', message: 'Choose a battery type' }));
	it('reset clears both', () => expect(parseBatteryForm(form({ reset: '1' }))).toEqual({ type: null, cells: null }));
});
