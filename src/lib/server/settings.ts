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
