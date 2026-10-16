import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettingsForm } from './settings';

const form = (o: Record<string, string | null> = {}) => {
	const f = new FormData();
	for (const [k, v] of Object.entries({ ...DEFAULT_SETTINGS, quietEnabled: 'on', ...o }))
		if (v !== null) f.set(k, String(v));
	return f;
};

describe('parseSettingsForm', () => {
	it('accepts the defaults and ignores unknown keys', () => {
		const r = parseSettingsForm(form({ evil: 'x' }));
		expect(r).toEqual({ settings: DEFAULT_SETTINGS });
	});

	it('reads an unchecked checkbox as false', () => {
		expect(parseSettingsForm(form({ quietEnabled: null }))).toEqual({ settings: { ...DEFAULT_SETTINGS, quietEnabled: false } });
	});

	it.each([
		['graceMin', '-1'], ['graceMin', 'abc'], ['graceMin', ''], ['graceMin', 'Infinity'], ['graceMin', null],
		['batteryLowPct', '101'], ['voltageLow', '11'], ['quietStart', '25:00'], ['quietEnd', '7:00'],
		['heartbeatUrl', 'ftp://x'], ['heartbeatUrl', 'not a url']
	])('rejects %s = %s', (key, value) => {
		const r = parseSettingsForm(form({ [key]: value }));
		expect(r).toHaveProperty('error');
	});

	it('accepts an http(s) heartbeat url', () => {
		expect(parseSettingsForm(form({ heartbeatUrl: ' https://hc.example/ping ' }))).toEqual({ settings: { ...DEFAULT_SETTINGS, heartbeatUrl: 'https://hc.example/ping' } });
	});
});

describe('parseSettingsForm ordering', () => {
	it.each([
		[{ batteryCriticalPct: '30' }], [{ batteryClearPct: '20' }], [{ voltageCritical: '2.9' }], [{ voltageClear: '2.7' }],
		[{ flappingClearBelow: '4' }], [{ silenceMinH: '30' }]
	])('rejects out-of-order thresholds %o', (o) => {
		expect(parseSettingsForm(form(o))).toHaveProperty('error');
	});

	it.each([['silenceMultiplier'], ['flappingWindowH'], ['reminderCriticalH'], ['reminderWarningH'], ['bridgeSilenceMin'], ['mqttLostSec']])(
		'rejects zero %s', (key) => {
			expect(parseSettingsForm(form({ [key]: '0' }))).toHaveProperty('error');
		});

	it('allows graceMin 0', () => {
		expect(parseSettingsForm(form({ graceMin: '0' }))).toHaveProperty('settings');
	});

	it('allows silenceMinH equal to silenceMaxH', () => {
		expect(parseSettingsForm(form({ silenceMinH: '25' }))).toHaveProperty('settings');
	});
});
