import type { Settings } from './server/settings';

type Key = keyof Settings;
/** One number in a sentence; `name` is used in validation messages. */
export type Field = { key: Key; name: string; unit: string };
/** One alert as a sentence: text pieces with inline fields. */
export type Row = { label: string; help: string; parts: (string | Field)[] };
export type Group = { title: string; rows: Row[]; more: Row[] };

const f = (key: Key, name: string, unit = ''): Field => ({ key, name, unit });
const row = (label: string, help: string, ...parts: (string | Field)[]): Row => ({ label, help, parts });

/** Settings → Thresholds: every numeric DEFAULT_SETTINGS key appears exactly once (tested). */
export const THRESHOLDS: Group[] = [
	{ title: 'Bridge and MQTT', rows: [
		row('Bridge silent', 'Time without any device message before "Zigbee network silent" fires. Raise it on a small or quiet mesh.',
			'Raise after', f('bridgeSilenceMin', 'Bridge silence', 'min'), 'without device messages'),
		row('Permit join', 'Joining left open is a security risk.', 'Warn when open longer than', f('permitJoinMaxMin', 'Permit join max', 'min')),
		row('MQTT lost', 'Seconds without MQTT traffic before the broker link counts as lost.', 'Lost after', f('mqttLostSec', 'MQTT lost after', 's')),
		row('Bridge restarts', 'Restarts of Zigbee2MQTT in one day.', 'Warn at', f('restartWarnCount', 'Bridge restarts warning', 'per day')),
		row('MQTT backlog', "Zigbee2MQTT's outgoing queue.", 'Raise above', f('backlogHigh', 'MQTT backlog above', 'messages'), 'clears below', f('backlogClear', 'MQTT backlog clears below', 'messages'))
	], more: [] },
	{ title: 'Devices offline', rows: [
		row('Offline grace', 'How long a device may be offline before an issue opens.', 'Open after', f('graceMin', 'Offline grace', 'min')),
		row('Silent', 'A device that stops reporting without going offline.',
			'After', f('silenceMultiplier', 'Silent after typical gap', '×'), 'its usual gap, at least', f('silenceMinH', 'Silence at least', 'h'), 'at most', f('silenceMaxH', 'Silence at most', 'h')),
		row('Flapping', 'A device that keeps dropping off and coming back.',
			'At', f('flappingCount', 'Flapping at', 'drops'), 'within', f('flappingWindowH', 'Flapping window', 'h'), 'clears below', f('flappingClearBelow', 'Flapping clears below', 'drops')),
		row('Mass offline', 'Many devices dropping at once: one incident instead of many issues.',
			'At', f('massOfflineDevices', 'Mass offline at', 'devices'), 'or', f('massOfflineRouterPct', 'Mass offline at', '% of routers'), 'within',
			f('massOfflineWindowMin', 'Mass offline window', 'min'), 'clears below', f('massOfflineClearPct', 'Mass offline clears below', '% of routers'))
	], more: [
		row('Grouping under a router', 'End devices dropping together with their router are grouped under it.',
			'Group within', f('routerGroupWindowMin', 'Group end devices with a router within', 'min'))
	] },
	{ title: 'Battery', rows: [
		row('Battery low', 'Percentage as reported by the device.',
			'Warn at', f('batteryLowPct', 'Battery low', '%'), 'critical at', f('batteryCriticalPct', 'Battery critical', '%'), 'OK again above', f('batteryClearPct', 'Battery OK again', '%')),
		row('Rechargeable', 'Devices tagged rechargeable (NiMH reads low from the day it goes in).',
			'Warn at', f('rechargeableLowPct', 'Rechargeable low', '%'), 'critical at', f('rechargeableCriticalPct', 'Rechargeable critical', '%'),
			'OK again above', f('rechargeableClearPct', 'Rechargeable OK again', '%'), 'warn on a drop of', f('rechargeableDropPct', 'Rechargeable drop', '%')),
		row('Coin cell', 'Coin cells are judged by voltage, which is more honest than their percentage.',
			'Warn at', f('voltageLow', 'Coin cell low', 'V'), 'critical at', f('voltageCritical', 'Coin cell critical', 'V'), 'OK again above', f('voltageClear', 'Coin cell OK again', 'V'))
	], more: [
		row('Coin cell full', 'Voltage that counts as a full coin cell; devices at or below it are treated as coin cells.', 'Full at', f('coinCellMaxV', 'Coin cell max voltage', 'V')),
		row('Stale reading', 'Flag a battery reading older than this.', 'Stale after', f('staleBatteryDays', 'Battery stale after', 'days')),
		row('Battery causing issues', 'A low battery is named as the cause of related issues (rejoins, flapping, silence).',
			'At or below', f('causingBatteryPct', 'Battery causing issues at', '%'), 'looking back', f('causingWindowH', 'Battery causing issues window', 'h'))
	] },
	{ title: 'Forecast and reminders', rows: [
		row('Battery forecast', 'Shown in the interface only; never notifies.',
			'Forecast to', f('forecastTargetPct', 'Battery forecast target', '%'), 'warn within', f('forecastWarnDays', 'Forecast warns within', 'days'),
			'clears above', f('forecastClearDays', 'Forecast clears above', 'days')),
		row('Reminders', 'Repeat notifications for issues that stay open.',
			'Critical every', f('reminderCriticalH', 'Remind critical every', 'h'), 'warnings every', f('reminderWarningH', 'Remind warning every', 'h'))
	], more: [
		row('Forecast data', 'History required before forecasting.', 'Needs', f('forecastMinDays', 'Forecast needs', 'days of data'))
	] },
	{ title: 'Links and routes', rows: [
		row('Weak link', '24-hour average link quality.', 'Below', f('lqiWeak', 'Weak link below', 'LQI'), 'clears above', f('lqiWeakClear', 'Weak link clears above', 'LQI')),
		row('Degrading link', "Compared with the device's own normal.",
			'At', f('lqiDegradePct', 'Link degrading at', '% below normal'), 'recovered within', f('lqiRecoverPct', 'Link recovered within', '% of normal')),
		row('Route failures', 'Commands to one device that fail.',
			'Warn at', f('routeFailWarn', 'Route failures warning at', 'per 24 h'), 'critical at', f('routeFailCrit', 'Route failures critical at', 'per 24 h'),
			'clears below', f('routeFailClear', 'Route failures clear below', 'per 24 h')),
		row('Network failures', 'Delivery failures across the whole network.',
			'Above', f('netRouteFactor', 'Network failures above', '× normal per hour'), 'and at least', f('netRouteMin', 'Network failures at least', 'per hour'),
			'clears below', f('netRouteClearFactor', 'Network failures clear below', '× normal per hour'))
	], more: [
		row('Data needed', 'Recent data and history required before link rules judge a device.',
			'Needs data in', f('lqiMinHours', 'Link rules need data in', 'h'), 'baselines after', f('baselineMinDays', 'Baseline needs', 'days'))
	] },
	{ title: 'Rejoins', rows: [
		row('Device rejoins', 'A device that keeps rejoining the network.',
			'At', f('churnAnnounce', 'Rejoin churn at', 'announces'), 'or', f('churnAddrChanges', 'Rejoin churn at', 'address changes'), 'within',
			f('churnWindowH', 'Rejoin churn window', 'h'), 'critical at', f('churnCritical', 'Rejoin churn critical at', 'rejoins in 24 h'),
			'clears after', f('churnClearH', 'Rejoin churn clears after', 'h quiet')),
		row('Network rejoins', 'Many devices rejoining at once.',
			'At', f('netChurnDevices', 'Network churn at', 'devices'), 'within', f('netChurnWindowMin', 'Network churn window', 'min'),
			'clears after', f('netChurnQuietH', 'Network churn clears after', 'h quiet'))
	], more: [] },
	{ title: 'Message storms', rows: [
		row('Device storm', "A device sending far more than its normal.",
			'Above', f('stormFactor', 'Device storm above', '× normal'), 'and at least', f('stormMinPerMin', 'Device storm at least', 'msgs/min'),
			'critical above', f('stormCritPerMin', 'Device storm critical above', 'msgs/min'), 'clears below', f('stormClearFactor', 'Device storm clears below', '× normal')),
		row('Network storm', 'The whole network far above its normal message rate.',
			'Above', f('netStormFactor', 'Network storm above', '× normal'), 'clears below', f('netStormClearFactor', 'Network storm clears below', '× normal')),
		row('Dominant device', 'One device sending a large share of all traffic.',
			'Above', f('dominantPct', 'Dominant device above', '% of messages'), 'clears below', f('dominantClearPct', 'Dominant device clears below', '% of messages'))
	], more: [
		row('Storm timing', 'How long a storm must last, and stay calm before it clears (at most 60 min each).',
			'Lasts at least', f('stormSustainMin', 'Storm lasts at least', 'min'), 'clears after', f('stormClearMin', 'Storm clears after', 'min')),
		row('Dominant timing', 'Measuring window, calm time before clearing (at most 60 min each), and the quietest network judged.',
			'Window', f('dominantWindowMin', 'Dominant device window', 'min'), 'clears after', f('dominantClearMin', 'Dominant device clears after', 'min'),
			'needs', f('dominantMinMsgs', 'Dominant device needs', 'network msgs in window'))
	] },
	{ title: 'Wi-Fi', rows: [
		row('Busy channel', '2.4 GHz channel utilisation: raised after 15 minutes, cleared after 30.',
			'Busy at', f('wifiBusyPct', 'Wi-Fi busy at', '% airtime'), 'clears below', f('wifiClearPct', 'Wi-Fi busy clears below', '% airtime'))
	], more: [] }
];

const fieldsOf = (rows: Row[]) => rows.flatMap((r) => r.parts.filter((p): p is Field => typeof p !== 'string'));
export const thresholdFields = (): Field[] => THRESHOLDS.flatMap((g) => fieldsOf([...g.rows, ...g.more]));
export const groupKeys = (g: Group): Key[] => fieldsOf([...g.rows, ...g.more]).map((x) => x.key);

/** Keys whose value differs from its default (numerically; an emptied field counts as changed). */
export function changed(keys: string[], values: Record<string, unknown>, defaults: Record<string, unknown>): string[] {
	return keys.filter((k) => {
		const v = values[k];
		return v === '' || v === null || v === undefined ? true : Number(v) !== Number(defaults[k]);
	});
}
