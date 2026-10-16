import { describe, expect, it } from 'vitest';
import { normaliseVoltage, parseAvailability, parseJson, parseLastSeen } from './parse';

describe('parse', () => {
	it('parses availability JSON and plain', () => {
		expect(parseAvailability({ state: 'online' })).toBe('online');
		expect(parseAvailability('offline')).toBe('offline');
		expect(parseAvailability({ state: 'weird' })).toBeNull();
		expect(parseAvailability(null)).toBeNull();
	});
	it('parses last_seen in all formats', () => {
		expect(parseLastSeen(1760000000000, 5)).toBe(1760000000000);
		expect(parseLastSeen('2026-10-16T10:00:00.000Z', 5)).toBe(Date.parse('2026-10-16T10:00:00.000Z'));
		expect(parseLastSeen(undefined, 5)).toBe(5);
		expect(parseLastSeen('nope', 5)).toBe(5);
	});
	it('normalises millivolts', () => {
		expect(normaliseVoltage(3000)).toBe(3);
		expect(normaliseVoltage(2.9)).toBe(2.9);
		expect(normaliseVoltage(null)).toBeNull();
	});
	it('parses Buffers and strings, keeps non-JSON as string', () => {
		expect(parseJson(Buffer.from('{"a":1}'))).toEqual({ a: 1 });
		expect(parseJson('online')).toBe('online');
		expect(parseJson({ a: 1 })).toEqual({ a: 1 });
	});
});
