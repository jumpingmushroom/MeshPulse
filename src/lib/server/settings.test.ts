import { describe, expect, it } from 'vitest';
import { openDb } from './db/index';
import { saveWifiConfig } from './wifi/config';
import { DEFAULT_SETTINGS, getSettings, parseSettingsForm, saveSettings } from './settings';

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
		['lqiDegradePct', '101'], ['lqiRecoverPct', '101'],
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
		[{ flappingClearBelow: '4' }], [{ silenceMinH: '30' }], [{ lqiWeak: '40' }], [{ lqiWeakClear: '20' }],
		[{ lqiRecoverPct: '25' }], [{ lqiDegradePct: '10' }], [{ lqiMinHours: '25' }], [{ forecastWarnDays: '30' }], [{ forecastTargetPct: '101' }],
		[{ routeFailClear: '5' }], [{ routeFailWarn: '20' }], [{ routeFailCrit: '5' }], [{ netRouteClearFactor: '3' }], [{ netRouteFactor: '1.5' }],
		[{ massOfflineRouterPct: '101' }], [{ massOfflineClearPct: '20' }],
		[{ churnWindowH: '13' }], [{ churnClearH: '25' }], [{ netChurnWindowMin: '61' }], [{ netChurnQuietH: '25' }], [{ backlogClear: '50' }],
		[{ causingBatteryPct: '20' }], [{ causingBatteryPct: '40' }],
		[{ rechargeableCriticalPct: '10' }], [{ rechargeableClearPct: '10' }], [{ rechargeableDropPct: '0' }]
	])('rejects out-of-order thresholds %o', (o) => {
		expect(parseSettingsForm(form(o))).toHaveProperty('error');
	});

	it.each([['silenceMultiplier'], ['flappingWindowH'], ['reminderCriticalH'], ['reminderWarningH'], ['bridgeSilenceMin'], ['mqttLostSec'],
		['lqiWeak'], ['lqiWeakClear'], ['lqiMinHours'], ['lqiDegradePct'], ['lqiRecoverPct'], ['baselineMinDays'],
		['routeFailWarn'], ['routeFailCrit'], ['routeFailClear'], ['netRouteFactor'], ['netRouteMin'], ['netRouteClearFactor'],
		['forecastWarnDays'], ['forecastClearDays'], ['forecastMinDays'],
		['massOfflineRouterPct'], ['massOfflineDevices'], ['massOfflineWindowMin'], ['massOfflineClearPct'],
		['churnAnnounce'], ['churnAddrChanges'], ['churnWindowH'], ['churnCritical'], ['churnClearH'], ['netChurnDevices'], ['netChurnWindowMin'],
		['netChurnQuietH'], ['backlogHigh'], ['backlogClear'], ['causingWindowH'], ['staleBatteryDays']])(
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

describe('parseSettingsForm errors', () => {
	it('collects every bad field', () => {
		const r = parseSettingsForm(form({ batteryCriticalPct: '30', graceMin: 'x' }));
		expect(r).toHaveProperty('errors');
		if (!('errors' in r)) return;
		expect(r.errors.map((e) => e.field).sort()).toEqual(['batteryCriticalPct', 'graceMin']);
		expect(r.error).toBe(r.errors[0].message);
	});
});

it('Wi-Fi must clear below the busy percentage', () => {
	const f = new FormData();
	for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) if (typeof v !== 'boolean') f.set(k, String(v));
	f.set('wifiClearPct', '60');
	expect(parseSettingsForm(f)).toMatchObject({ errors: [{ field: 'wifiClearPct' }] });
});

it('getSettings returns only known keys, never raw rows like wifiConfig', () => {
	const db = openDb(':memory:');
	saveWifiConfig(db, 'k', { url: 'https://x', site: 'default', user: 'u', password: 'hunter2' });
	saveSettings(db, { weeklyDigestWeek: '2026-W43' } as never);
	const out = JSON.stringify(getSettings(db));
	expect(out).not.toContain('wifiConfig');
	expect(out).not.toContain('weeklyDigestWeek');
	expect(Object.keys(getSettings(db)).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
});
