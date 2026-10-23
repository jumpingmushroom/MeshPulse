import { eq } from 'drizzle-orm';
import type { Db } from './db/index';
import { settings } from './db/schema';
import { thresholdFields } from '../settings-groups';

export const DEFAULT_SETTINGS = {
	bridgeSilenceMin: 5,
	permitJoinMaxMin: 10,
	mqttLostSec: 60,
	graceMin: 15,
	restartWarnCount: 3,
	silenceMultiplier: 3,
	silenceMinH: 2,
	silenceMaxH: 25,
	silenceLongGapFactor: 1.5,
	flappingCount: 4,
	flappingClearBelow: 2,
	flappingWindowH: 6,
	batteryLowPct: 25,
	batteryCriticalPct: 10,
	batteryClearPct: 40,
	rechargeableLowPct: 10,
	rechargeableCriticalPct: 5,
	rechargeableClearPct: 20,
	rechargeableDropPct: 15,
	voltageLow: 2.8,
	voltageCritical: 2.6,
	voltageClear: 2.9,
	coinCellMaxV: 3.3,
	quietEnabled: true,
	quietStart: '23:00',
	quietEnd: '07:00',
	reminderCriticalH: 6,
	reminderWarningH: 24,
	lqiWeak: 30,
	lqiWeakClear: 40,
	lqiMinHours: 6,
	lqiDegradePct: 25,
	lqiRecoverPct: 10,
	baselineMinDays: 3,
	routeFailWarn: 5,
	routeFailCrit: 20,
	routeFailClear: 2,
	netRouteFactor: 3,
	netRouteMin: 10,
	netRouteClearFactor: 1.5,
	forecastTargetPct: 10,
	forecastWarnDays: 21,
	forecastClearDays: 30,
	forecastMinDays: 7,
	massOfflineRouterPct: 20,
	massOfflineDevices: 10,
	massOfflineWindowMin: 5,
	massOfflineClearPct: 5,
	routerGroupWindowMin: 10,
	churnAnnounce: 3,
	churnAddrChanges: 2,
	churnWindowH: 6,
	churnCritical: 10,
	churnClearH: 12,
	netChurnDevices: 5,
	netChurnWindowMin: 15,
	netChurnQuietH: 1,
	stormFactor: 5,
	stormMinPerMin: 20,
	stormCritPerMin: 60,
	stormSustainMin: 5,
	stormClearFactor: 2,
	stormClearMin: 15,
	dominantPct: 30,
	dominantClearPct: 15,
	dominantWindowMin: 15,
	dominantClearMin: 30,
	dominantMinMsgs: 60,
	netStormFactor: 4,
	netStormClearFactor: 2,
	causingBatteryPct: 35,
	causingWindowH: 48,
	staleBatteryDays: 7,
	backlogHigh: 50,
	backlogClear: 10,
	heartbeatUrl: '',
	activeCoordinatorCheck: false,
	activeNetworkScan: false,
	wifiEnabled: false,
	wifiBusyPct: 60,
	wifiClearPct: 40
};

export type Settings = typeof DEFAULT_SETTINGS;

export function getSettings(db: Db): Settings {
	// only known keys: raw rows (wifiConfig, weeklyDigestWeek, ...) must never reach a page
	const rows = Object.fromEntries(db.select().from(settings).all().filter((r) => r.key in DEFAULT_SETTINGS).map((r) => [r.key, r.value]));
	return { ...DEFAULT_SETTINGS, ...rows };
}

/** Upserts one settings row; raw keys (outside DEFAULT_SETTINGS) are allowed. */
export const setSetting = (db: Db, key: string, value: unknown) =>
	db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();

export function saveSettings(db: Db, patch: Partial<Settings>): void {
	for (const [key, value] of Object.entries(patch)) setSetting(db, key, value);
}

/** Saves the Settings form. The active switches live in their own form: an absent checkbox here must not turn them off. */
export function saveFormSettings(db: Db, s: Settings): void {
	const { activeCoordinatorCheck: _c, activeNetworkScan: _n, wifiEnabled: _w, ...rest } = s;
	saveSettings(db, rest);
}

const PCT = ['batteryLowPct', 'batteryCriticalPct', 'batteryClearPct', 'rechargeableLowPct', 'rechargeableCriticalPct', 'rechargeableClearPct', 'rechargeableDropPct', 'lqiDegradePct', 'lqiRecoverPct', 'forecastTargetPct', 'massOfflineRouterPct', 'massOfflineClearPct', 'dominantPct', 'dominantClearPct', 'causingBatteryPct', 'wifiBusyPct', 'wifiClearPct'];
const VOLTS = ['voltageLow', 'voltageCritical', 'voltageClear', 'coinCellMaxV'];
// 0 would mean "always" (reminders, silence) or divide nothing (multiplier, window)
const POSITIVE = ['silenceMultiplier', 'silenceLongGapFactor', 'flappingWindowH', 'reminderCriticalH', 'reminderWarningH', 'bridgeSilenceMin', 'mqttLostSec',
	'lqiWeak', 'lqiWeakClear', 'lqiMinHours', 'lqiDegradePct', 'lqiRecoverPct', 'baselineMinDays',
	'routeFailWarn', 'routeFailCrit', 'routeFailClear', 'netRouteFactor', 'netRouteMin', 'netRouteClearFactor',
	'forecastWarnDays', 'forecastClearDays', 'forecastMinDays', 'massOfflineRouterPct', 'massOfflineDevices', 'massOfflineWindowMin', 'massOfflineClearPct',
	'churnAnnounce', 'churnAddrChanges', 'churnWindowH', 'churnCritical', 'churnClearH', 'netChurnDevices', 'netChurnWindowMin', 'netChurnQuietH',
	'stormFactor', 'stormMinPerMin', 'stormCritPerMin', 'stormSustainMin', 'stormClearFactor', 'stormClearMin',
	'dominantPct', 'dominantClearPct', 'dominantWindowMin', 'dominantClearMin', 'dominantMinMsgs', 'netStormFactor', 'netStormClearFactor',
	'backlogHigh', 'backlogClear', 'wifiBusyPct', 'wifiClearPct', 'causingWindowH', 'staleBatteryDays', 'rechargeableDropPct'];

const LABEL: Record<string, string> = { quietStart: 'Quiet hours start', quietEnd: 'Quiet hours end', heartbeatUrl: 'Heartbeat URL',
	...Object.fromEntries(thresholdFields().map((x) => [x.key, x.name])) };

export type SettingsError = { field: keyof Settings; message: string };

/** Validates the Settings form; all-or-nothing, unknown keys ignored. Collects every bad field. */
export function parseSettingsForm(form: FormData): { settings: Settings } | { error: string; errors: SettingsError[] } {
	const out: Record<string, unknown> = {};
	const errors: SettingsError[] = [];
	for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
		const key = k as keyof Settings;
		const raw = String(form.get(key) ?? '').trim();
		const name = LABEL[key] ?? key;
		const bad = (message: string) => { errors.push({ field: key, message }); out[key] = def; }; // default keeps the ordering checks meaningful
		if (typeof def === 'boolean') out[key] = form.get(key) === 'on';
		else if (typeof def === 'number') {
			const n = raw === '' ? NaN : Number(raw);
			const max = PCT.includes(key) ? 100 : VOLTS.includes(key) ? 10 : Infinity;
			if (!Number.isFinite(n) || n < 0 || n > max) bad(max === Infinity ? `${name} must be a number of 0 or more` : `${name} must be a number from 0 to ${max}`);
			else if (n === 0 && POSITIVE.includes(key)) bad(`${name} must be above 0`);
			else out[key] = n;
		} else if (key === 'heartbeatUrl') {
			if (raw && !/^https?:\/\/[^\s/]+\S*$/.test(raw)) bad(`${name} must be an http(s) URL or empty`);
			else out[key] = raw;
		} else if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) bad(`${name} must be a time as HH:MM`);
		else out[key] = raw;
	}
	const v = out as Settings;
	// each check reports on its first field
	const order: [boolean, keyof Settings, string][] = [
		[v.batteryCriticalPct < v.batteryLowPct && v.batteryLowPct < v.batteryClearPct, 'batteryCriticalPct', 'Battery thresholds must be critical < low < OK again'],
		[v.batteryLowPct <= v.causingBatteryPct && v.causingBatteryPct < v.batteryClearPct, 'causingBatteryPct', 'Battery causing issues must be from low up to below OK again'],
		[v.rechargeableCriticalPct < v.rechargeableLowPct && v.rechargeableLowPct < v.rechargeableClearPct, 'rechargeableCriticalPct', 'Rechargeable thresholds must be critical < low < OK again'],
		[v.voltageCritical < v.voltageLow && v.voltageLow < v.voltageClear, 'voltageCritical', 'Coin cell thresholds must be critical < low < OK again'],
		[v.flappingClearBelow < v.flappingCount, 'flappingClearBelow', 'Flapping must clear below the count that raises it'],
		[v.silenceMinH <= v.silenceMaxH, 'silenceMinH', 'Silence minimum must not exceed the maximum'],
		[v.lqiWeak < v.lqiWeakClear, 'lqiWeak', 'Weak link must clear above the LQI that raises it'],
		[v.lqiRecoverPct < v.lqiDegradePct, 'lqiRecoverPct', 'Link recovered must be within less than the degrading percentage'],
		[v.routeFailClear < v.routeFailWarn && v.routeFailWarn < v.routeFailCrit, 'routeFailClear', 'Route failures must be OK again < warning < critical'],
		[v.netRouteClearFactor < v.netRouteFactor, 'netRouteClearFactor', 'Network delivery failures must clear below the factor that raises them'],
		[v.forecastWarnDays < v.forecastClearDays, 'forecastWarnDays', 'Forecast must clear above the days that raise it'],
		[v.massOfflineClearPct < v.massOfflineRouterPct, 'massOfflineClearPct', 'Mass offline must clear below the router percentage that raises it'],
		[v.lqiMinHours <= 24, 'lqiMinHours', 'Link rules can need data in at most 24 hours'],
		[v.churnWindowH <= v.churnClearH && v.churnClearH <= 24, 'churnWindowH', 'Rejoin churn window must not exceed its quiet time, which is at most 24 hours'],
		[v.netChurnWindowMin <= v.netChurnQuietH * 60 && v.netChurnQuietH <= 24, 'netChurnWindowMin', 'Network churn window must not exceed its quiet time, which is at most 24 hours'],
		[v.backlogClear < v.backlogHigh, 'backlogClear', 'MQTT backlog must clear below the queue that raises it'],
		[v.stormClearFactor < v.stormFactor && v.netStormClearFactor < v.netStormFactor, 'stormClearFactor', 'Storms must clear below the factor that raises them'],
		[v.stormMinPerMin < v.stormCritPerMin, 'stormMinPerMin', 'Storm critical rate must be above the storm minimum rate'],
		[v.wifiClearPct < v.wifiBusyPct, 'wifiClearPct', 'Wi-Fi must clear below the busy percentage that raises it'],
		[v.dominantClearPct < v.dominantPct, 'dominantClearPct', 'Dominant device must clear below the share that raises it'],
		// minute counters keep the last 60 minutes
		[Math.max(v.stormSustainMin, v.stormClearMin, v.dominantWindowMin, v.dominantClearMin) <= 60, 'stormSustainMin', 'Storm and dominant windows can be at most 60 minutes']
	];
	for (const [ok, field, message] of order) if (!ok && !errors.some((e) => e.field === field)) errors.push({ field, message });
	return errors.length ? { error: errors[0].message, errors } : { settings: v };
}
