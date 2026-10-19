import type { Settings } from '../../lib/server/settings';

/** Numeric thresholds by group: [key, label, unit, help]. Every numeric DEFAULT_SETTINGS key appears once. */
export const GROUPS: [string, [keyof Settings, string, string, string][]][] = [
	['Bridge', [
		['bridgeSilenceMin', 'Bridge silence', 'min', 'Time without any device message before "Zigbee network silent" fires. Raise it on a small or quiet mesh.'],
		['permitJoinMaxMin', 'Permit join max', 'min', 'Warn when joining stays open longer than this.'],
		['mqttLostSec', 'MQTT lost after', 's', 'Seconds without MQTT traffic before the broker link counts as lost.'],
		['restartWarnCount', 'Bridge restarts warning', 'per day', 'Warn when the bridge restarts this often in a day.']
	]],
	['Availability', [
		['graceMin', 'Offline grace', 'min', 'How long a device may be offline before an issue opens.'],
		['silenceMultiplier', 'Silent after typical gap ×', '', 'A device is silent after this many times its typical gap between messages.'],
		['silenceMinH', 'Silence at least', 'h', 'Never flag silence shorter than this.'],
		['silenceMaxH', 'Silence at most', 'h', 'Always flag silence longer than this.'],
		['flappingCount', 'Flapping at', 'drops', 'Offline drops within the window that raise flapping.'],
		['flappingClearBelow', 'Flapping clears below', 'drops', 'Drops within the window below which flapping clears.'],
		['flappingWindowH', 'Flapping window', 'h', 'Period the drops are counted over.']
	]],
	['Battery', [
		['batteryLowPct', 'Battery low', '%', 'Warn at or below this charge.'],
		['batteryCriticalPct', 'Battery critical', '%', 'Critical at or below this charge.'],
		['batteryClearPct', 'Battery OK again', '%', 'The issue clears above this charge.'],
		['voltageLow', 'Coin cell low', 'V', 'Warn at or below this voltage.'],
		['voltageCritical', 'Coin cell critical', 'V', 'Critical at or below this voltage.'],
		['voltageClear', 'Coin cell OK again', 'V', 'The issue clears above this voltage.'],
		['coinCellMaxV', 'Coin cell max voltage', 'V', 'Voltage that counts as a full coin cell.'],
		['staleBatteryDays', 'Battery stale after', 'days', 'Flag a battery reading older than this.']
	]],
	['Link quality', [
		['lqiWeak', 'Weak link below', 'LQI', 'Raise a weak link below this LQI.'],
		['lqiWeakClear', 'Weak link clears above', 'LQI', 'The issue clears above this LQI.'],
		['lqiMinHours', 'Link rules need data in', 'h', 'Hours of recent data required, at most 24.'],
		['lqiDegradePct', 'Link degrading at', '% below normal', 'Raise when LQI falls this far below the device baseline.'],
		['lqiRecoverPct', 'Link recovered within', '% of normal', 'Clears when LQI is back within this of baseline.'],
		['baselineMinDays', 'Baseline needs', 'days', 'Days of history before baselines are trusted.']
	]],
	['Routes', [
		['routeFailWarn', 'Route failures warning at', 'per 24 h', 'Warn at this many route failures in 24 hours.'],
		['routeFailCrit', 'Route failures critical at', 'per 24 h', 'Critical at this many in 24 hours.'],
		['routeFailClear', 'Route failures clear below', 'per 24 h', 'Clears below this many in 24 hours.'],
		['netRouteFactor', 'Network failures above', '× normal per hour', 'Network-wide failure rate that raises an issue.'],
		['netRouteMin', 'Network failures at least', 'per hour', 'Ignore network failure rates below this.'],
		['netRouteClearFactor', 'Network failures clear below', '× normal per hour', 'Clears below this multiple of normal.']
	]],
	['Forecast and reminders', [
		['forecastTargetPct', 'Battery forecast target', '%', 'Forecast the date a battery reaches this charge.'],
		['forecastWarnDays', 'Forecast warns within', 'days', 'Warn when the target is this close.'],
		['forecastClearDays', 'Forecast clears above', 'days', 'Clears when the target is further away than this.'],
		['forecastMinDays', 'Forecast needs', 'days of data', 'History required before forecasting.'],
		['reminderCriticalH', 'Remind critical every', 'h', 'Repeat reminders for open critical issues.'],
		['reminderWarningH', 'Remind warning every', 'h', 'Repeat reminders for open warnings.']
	]],
	['Churn', [
		['churnAnnounce', 'Rejoin churn at', 'announces', 'Device announces within the window that raise churn.'],
		['churnAddrChanges', 'Rejoin churn at', 'address changes', 'Address changes within the window that raise churn.'],
		['churnWindowH', 'Rejoin churn window', 'h', 'Period counted over; must not exceed the quiet time.'],
		['churnCritical', 'Rejoin churn critical at', 'rejoins in 24 h', 'Critical at this many rejoins in 24 hours.'],
		['churnClearH', 'Rejoin churn clears after', 'h quiet', 'Quiet time before clearing, at most 24.'],
		['netChurnDevices', 'Network churn at', 'devices', 'Devices rejoining within the window that raise network churn.'],
		['netChurnWindowMin', 'Network churn window', 'min', 'Period counted over.'],
		['netChurnQuietH', 'Network churn clears after', 'h quiet', 'Quiet time before clearing, at most 24.']
	]],
	['Storms', [
		['stormFactor', 'Device storm above', '× normal', 'Message rate that raises a device storm.'],
		['stormMinPerMin', 'Device storm at least', 'msgs/min', 'Ignore rates below this.'],
		['stormCritPerMin', 'Device storm critical above', 'msgs/min', 'Critical above this rate.'],
		['stormSustainMin', 'Storm lasts at least', 'min', 'Rate must hold this long, at most 60.'],
		['stormClearFactor', 'Device storm clears below', '× normal', 'Clears below this multiple of normal.'],
		['stormClearMin', 'Storm clears after', 'min', 'Calm time before clearing, at most 60.'],
		['netStormFactor', 'Network storm above', '× normal', 'Network message rate that raises a storm.'],
		['netStormClearFactor', 'Network storm clears below', '× normal', 'Clears below this multiple of normal.'],
		['dominantPct', 'Dominant device above', '% of messages', 'Share of network traffic from one device.'],
		['dominantClearPct', 'Dominant device clears below', '% of messages', 'Clears below this share.'],
		['dominantWindowMin', 'Dominant device window', 'min', 'Period the share is measured over, at most 60.'],
		['dominantClearMin', 'Dominant device clears after', 'min', 'Calm time before clearing, at most 60.'],
		['dominantMinMsgs', 'Dominant device needs', 'network msgs in window', 'Ignore quiet networks below this.']
	]],
	['Mass offline', [
		['massOfflineDevices', 'Mass offline at', 'devices', 'Devices going offline within the window.'],
		['massOfflineRouterPct', 'Mass offline at', '% of routers', 'Or this share of routers.'],
		['massOfflineWindowMin', 'Mass offline window', 'min', 'Period the drops are counted over.'],
		['massOfflineClearPct', 'Mass offline clears below', '% of routers', 'Clears below this share.'],
		['routerGroupWindowMin', 'Group end devices with a router within', 'min', 'End devices dropping with their router are grouped under it.']
	]],
	['Battery escalation', [
		['causingBatteryPct', 'Battery causing issues at', '%', 'A low battery at or below this is named as the cause of related issues.'],
		['causingWindowH', 'Battery causing issues window', 'h', 'How far back related issues are looked for.']
	]],
	['MQTT backlog', [
		['backlogHigh', 'MQTT backlog above', 'messages', 'Queue length that raises an issue.'],
		['backlogClear', 'MQTT backlog clears below', 'messages', 'Clears below this queue length.']
	]]
];
