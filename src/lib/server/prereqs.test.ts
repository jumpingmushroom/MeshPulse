import { describe, expect, it } from 'vitest';
import { checkPrereqs } from './prereqs';

const good = {
	config: {
		availability: { enabled: true },
		health: { interval: 10 },
		advanced: { log_output: ['console', 'file', 'mqtt'] }
	}
};
const oks = (info: Record<string, any> | null) =>
	Object.fromEntries(checkPrereqs(info).map((p) => [p.key, p.ok]));

describe('checkPrereqs', () => {
	it('all present', () => {
		expect(oks(good)).toEqual({ availability: true, health: true, mqtt_log: true });
	});
	it('availability as boolean true is ok', () => {
		expect(oks({ config: { ...good.config, availability: true } }).availability).toBe(true);
	});
	it('availability object without enabled is ok', () => {
		expect(oks({ config: { ...good.config, availability: {} } }).availability).toBe(true);
	});
	it('availability.enabled false is not ok', () => {
		expect(oks({ config: { ...good.config, availability: { enabled: false } } }).availability).toBe(false);
	});
	it('health missing is not ok', () => {
		expect(oks({ config: { ...good.config, health: undefined } }).health).toBe(false);
	});
	it('log_output without mqtt is not ok', () => {
		expect(oks({ config: { ...good.config, advanced: { log_output: ['console'] } } }).mqtt_log).toBe(false);
	});
	it('null info gives []', () => {
		expect(checkPrereqs(null)).toEqual([]);
	});
	it('fix strings', () => {
		expect(checkPrereqs({}).map((p) => p.fix)).toEqual([
			'availability:\n  enabled: true',
			'health:\n  interval: 10\n  reset_on_check: false',
			'advanced:\n  log_output: [console, file, mqtt]\n  log_level: info'
		]);
	});
});
