import { eq } from 'drizzle-orm';
import type { Db } from './db/index';
import { settings } from './db/schema';

export const DEFAULT_SETTINGS = {
	bridgeSilenceMin: 5,
	permitJoinMaxMin: 10,
	mqttLostSec: 60,
	graceMin: 15,
	restartWarnCount: 3,
	silenceMultiplier: 3,
	silenceMinH: 2,
	silenceMaxH: 25,
	flappingCount: 4,
	flappingClearBelow: 2,
	flappingWindowH: 6,
	batteryLowPct: 25,
	batteryCriticalPct: 10,
	batteryClearPct: 40,
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
	forecastTargetPct: 10,
	forecastWarnDays: 21,
	forecastClearDays: 30,
	forecastMinDays: 7,
	heartbeatUrl: ''
};

export type Settings = typeof DEFAULT_SETTINGS;

export function getSettings(db: Db): Settings {
	const rows = Object.fromEntries(db.select().from(settings).all().map((r) => [r.key, r.value]));
	return { ...DEFAULT_SETTINGS, ...rows };
}

export function saveSettings(db: Db, patch: Partial<Settings>): void {
	for (const [key, value] of Object.entries(patch))
		db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

const PCT = ['batteryLowPct', 'batteryCriticalPct', 'batteryClearPct', 'lqiDegradePct', 'lqiRecoverPct', 'forecastTargetPct'];
const VOLTS = ['voltageLow', 'voltageCritical', 'voltageClear', 'coinCellMaxV'];
// 0 would mean "always" (reminders, silence) or divide nothing (multiplier, window)
const POSITIVE = ['silenceMultiplier', 'flappingWindowH', 'reminderCriticalH', 'reminderWarningH', 'bridgeSilenceMin', 'mqttLostSec',
	'lqiWeak', 'lqiWeakClear', 'lqiMinHours', 'lqiDegradePct', 'lqiRecoverPct', 'baselineMinDays',
	'forecastWarnDays', 'forecastClearDays', 'forecastMinDays'];

/** Validates the Settings form; all-or-nothing, unknown keys ignored. */
export function parseSettingsForm(form: FormData): { settings: Settings } | { error: string } {
	const out: Record<string, unknown> = {};
	for (const [key, def] of Object.entries(DEFAULT_SETTINGS)) {
		const raw = String(form.get(key) ?? '').trim();
		if (typeof def === 'boolean') out[key] = form.get(key) === 'on';
		else if (typeof def === 'number') {
			const n = raw === '' ? NaN : Number(raw);
			const max = PCT.includes(key) ? 100 : VOLTS.includes(key) ? 10 : Infinity;
			if (!Number.isFinite(n) || n < 0 || n > max) return { error: max === Infinity ? `${key} must be a number of 0 or more` : `${key} must be a number from 0 to ${max}` };
			if (n === 0 && POSITIVE.includes(key)) return { error: `${key} must be above 0` };
			out[key] = n;
		} else if (key === 'heartbeatUrl') {
			if (raw && !/^https?:\/\/[^\s/]+\S*$/.test(raw)) return { error: 'heartbeatUrl must be an http(s) URL or empty' };
			out[key] = raw;
		} else {
			if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) return { error: `${key} must be a time as HH:MM` };
			out[key] = raw;
		}
	}
	const v = out as Settings;
	const order: [boolean, string][] = [
		[v.batteryCriticalPct < v.batteryLowPct && v.batteryLowPct < v.batteryClearPct, 'Battery thresholds must be critical < low < OK again'],
		[v.voltageCritical < v.voltageLow && v.voltageLow < v.voltageClear, 'Coin cell thresholds must be critical < low < OK again'],
		[v.flappingClearBelow < v.flappingCount, 'Flapping must clear below the count that raises it'],
		[v.silenceMinH <= v.silenceMaxH, 'Silence minimum must not exceed the maximum'],
		[v.lqiWeak < v.lqiWeakClear, 'Weak link must clear above the LQI that raises it'],
		[v.lqiRecoverPct < v.lqiDegradePct, 'Link recovered must be within less than the degrading percentage'],
		[v.forecastWarnDays < v.forecastClearDays, 'Forecast must clear above the days that raise it'],
		[v.lqiMinHours <= 24, 'Link rules can need data in at most 24 hours']
	];
	const bad = order.find(([ok]) => !ok);
	return bad ? { error: bad[1] } : { settings: v };
}
