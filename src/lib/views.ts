// Pure view helpers shared by the pages (server loads and components).
import { deviceScore } from './score';
import type { RuleId } from './server/rules/types';
import type { AppState, DeviceState, Severity } from './server/types';

export const FOREVER = 253402300799000; // 9999-12-31, the "mute forever" sentinel

const RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };

export type Status = 'green' | 'amber' | 'red';

export function sortIssues<T extends { severity: Severity; openedAt: number }>(issues: T[]): T[] {
	return [...issues].sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.openedAt - a.openedAt);
}

export interface DeviceRow {
	ieee: string;
	name: string;
	type: DeviceState['type'];
	battery: number | null;
	voltage: number | null;
	batteryPowered: boolean;
	availability: DeviceState['availability'];
	lastSeenAt: number | null;
	lqi: number | null;
	mutedUntil: number | null;
	openIssues: number;
	score: number;
	worst: Severity | null;
	ignored: boolean;
	lqi24: number | null;
	lqiBase: number | null;
	msgH: number | null;
}

// the coordinator is the network itself, not a device to watch
const watched = (state: Pick<AppState, 'devices'>) =>
	[...state.devices.values()].filter((d) => d.removedAt === null && d.type !== 'Coordinator');

export function deviceRows(state: Pick<AppState, 'devices'>, openIssues: { ieee: string | null; severity: Severity }[],
	stats: Map<string, { lqi24: number | null; lqiBase: number | null; msgH: number | null }> = new Map()): DeviceRow[] {
	const by = new Map<string, { severity: Severity }[]>();
	for (const i of openIssues) if (i.ieee) by.set(i.ieee, [...(by.get(i.ieee) ?? []), i]);
	return watched(state).map((d) => ({
		ieee: d.ieee, name: d.friendlyName, type: d.type, battery: d.battery, voltage: d.voltage,
		batteryPowered: d.powerSource === 'Battery' || d.battery !== null || d.voltage !== null,
		availability: d.availability, lastSeenAt: d.lastSeenAt, lqi: d.lqi, mutedUntil: d.mutedUntil,
		openIssues: by.get(d.ieee)?.length ?? 0, score: deviceScore(by.get(d.ieee) ?? []),
		worst: (by.get(d.ieee) ?? []).reduce<Severity | null>((w, i) => (w === null || RANK[i.severity] > RANK[w] ? i.severity : w), null),
		ignored: d.tags.includes('ignore'),
		lqi24: stats.get(d.ieee)?.lqi24 ?? null, lqiBase: stats.get(d.ieee)?.lqiBase ?? null, msgH: stats.get(d.ieee)?.msgH ?? null
	}));
}

export type SortKey = 'name' | 'type' | 'availability' | 'lastSeenAt' | 'lqi' | 'battery' | 'voltage' | 'openIssues' | 'score' | 'msgH';

/** Unknown (null) values sort last in both directions. */
export function sortRows(rows: DeviceRow[], key: SortKey, asc: boolean): DeviceRow[] {
	return [...rows].sort((a, b) => {
		const [x, y] = [a[key], b[key]];
		if (x === y) return 0;
		if (x === null) return 1;
		if (y === null) return -1;
		return (x < y ? -1 : 1) * (asc ? 1 : -1);
	});
}

export interface RowFilter { q: string; routers: boolean; battery: boolean; offline: boolean; issues: boolean }

export function filterRows(rows: DeviceRow[], f: RowFilter): DeviceRow[] {
	const q = f.q.trim().toLowerCase();
	return rows.filter((r) => (!q || r.name.toLowerCase().includes(q)) && (!f.routers || r.type === 'Router') && (!f.battery || r.batteryPowered)
		&& (!f.offline || r.availability === 'offline') && (!f.issues || r.openIssues > 0));
}

export function counters(state: Pick<AppState, 'devices'>) {
	const ds = watched(state);
	const routers = ds.filter((d) => d.type === 'Router');
	const online = (xs: DeviceState[]) => xs.filter((d) => d.availability === 'online').length;
	return {
		devicesOnline: online(ds), devicesTotal: ds.length,
		routersOnline: online(routers), routersTotal: routers.length
	};
}

export function formatTime(ms: number | null, tz: string): string {
	return ms === null ? '—' : new Date(ms).toLocaleString('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' });
}

export function formatAgo(ms: number | null, now: number): string {
	if (ms === null) return '—';
	const min = Math.floor((now - ms) / 60_000);
	if (min < 1) return 'just now';
	if (min < 60) return `${min} min ago`;
	if (min < 48 * 60) return `${Math.floor(min / 60)} h ago`;
	return `${Math.floor(min / 1440)} d ago`;
}

/** "3 h 12 min", "2 d 4 h", "5 min" */
export function formatDuration(ms: number): string {
	const min = Math.round(ms / 60_000);
	const [d, h, m] = [Math.floor(min / 1440), Math.floor(min / 60) % 24, min % 60];
	const parts = d ? [`${d} d`, h && `${h} h`] : h ? [`${h} h`, m && `${m} min`] : [`${m} min`];
	return parts.filter(Boolean).join(' ');
}

export function formatVoltage(v: number | null): string {
	if (v === null) return '—';
	const two = v.toFixed(2);
	return two.endsWith('0') ? v.toFixed(1) : two;
}

/** "batteryLow" -> "Battery low" */
export function humanise(key: string): string {
	const w = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
	return w.charAt(0).toUpperCase() + w.slice(1);
}

export const EVIDENCE_LABELS: Record<string, string> = {
	offlineSince: 'Offline since', lastSeenAt: 'Last seen', typicalGapMs: 'Typical gap', thresholdMs: 'Threshold',
	availability: 'Availability', avg: 'Average LQI', avg12h: 'Average LQI, 12 h', hours: 'Hours of data', hours12h: 'Hours of data, 12 h',
	threshold: 'Threshold', clearAbove: 'Clears above', baseline: 'Baseline', baselineDays: 'Baseline days',
	battery: 'Battery', voltage: 'Voltage', daysLeft: 'Days left', drop: 'Drop since it went in', basedOnDays: 'Based on days', count: 'Count',
	perMin: 'Messages per minute', factor: 'Factor', windowH: 'Window (h)', windowMin: 'Window (min)', changes: 'Changes',
	announces: 'Announces', leftAt: 'Left at', failedAt: 'Failed at', names: 'Devices', devices: 'Device count', top: 'Top senders', downSince: 'Down since',
	wifi: 'Wi-Fi at the time', routersOffline: 'Routers offline', routersTotal: 'Routers total', lastReportAt: 'Last report', typicalGapH: 'Typical gap (h)'
};

/** Issue evidence as readable [key, value] pairs: *At/*Since are times, *Ms are durations, nulls hidden. */
export function evidenceRows(evidence: Record<string, unknown>, tz: string, byName: Map<string, string> = new Map()): [string, string | { text: string; href: string }[]][] {
	// device lists ("names": string[], "top": {name, perMin}[]) become links when every name resolves to an ieee
	const links = (v: unknown) => {
		if (!Array.isArray(v) || !v.length) return null;
		const out = v.map((x) => {
			const name = typeof x === 'string' ? x : x && typeof x === 'object' && typeof (x as { name?: unknown }).name === 'string' ? (x as { name: string }).name : null;
			const ieee = name === null ? undefined : byName.get(name);
			const rate = x && typeof x === 'object' ? (x as { perMin?: unknown }).perMin : undefined;
			return ieee === undefined ? null : { text: rate === undefined ? name! : `${name} (${rate}/min)`, href: `/devices/${ieee}` };
		});
		return out.every((x) => x !== null) ? out : null;
	};
	return Object.entries(evidence).flatMap(([k, v]): [string, string | { text: string; href: string }[]][] => {
		if (v === null || v === undefined) return [];
		if (k === 'level') return []; // internal rule variant, e.g. battery.low
		const l = EVIDENCE_LABELS[k] ?? humanise(k);
		if (k === 'wifi') {
			if (!Array.isArray(v)) return [[l, 'Unavailable']];
			return [[l, v.map((a: { ap: string; channel: number | null; overlaps: boolean; cuTotal: number | null; cuMaxHour: number | null; changedAt: number | null }) => [a.ap,
				a.channel === null ? 'no 2.4 GHz radio' : `channel ${a.channel}`, ...(a.overlaps ? ['overlaps Zigbee'] : []),
				...(a.cuTotal === null ? [] : [`${a.cuTotal} % now${a.cuMaxHour === null ? '' : `, ${a.cuMaxHour} % max last hour`}`]),
				...(a.changedAt === null ? [] : [`changed channel ${formatTime(a.changedAt, tz)}`])].join(' · ')).join('\n')]];
		}
		const ls = links(v);
		if (ls) return [[l, ls]];
		if (typeof v === 'number' && /(At|Since)$/.test(k)) return [[l, formatTime(v, tz)]];
		if (typeof v === 'number' && k.endsWith('Ms')) return [[l, formatDuration(v)]];
		if (typeof v === 'boolean') return [[l, v ? 'Yes' : 'No']];
		if (k === 'battery' && typeof v === 'number') return [[l, `${v} %`]];
		if (k === 'drop' && typeof v === 'number') return [[l, `${v} points`]];
		return [[l, typeof v === 'object' ? JSON.stringify(v) : String(v)]];
	});
}

/** Event detail as short text: "offline → online", "20% → 100%" for swaps, else "key: value" pairs. */
export function formatDetail(kind: string, detail: Record<string, unknown> | null): string {
	if (!detail) return '';
	const { from, to } = detail;
	const plain: Record<string, string> = { device_announce: 'Device announced', device_joined: 'Joined the network', device_leave: 'Left the network' };
	if (kind in plain) return plain[kind]; // detail is only the friendly name, already in the Device column
	if (kind === 'wifi_channel' && typeof detail.ap === 'string') return `${detail.ap}: channel ${detail.from ?? '—'} → ${detail.to ?? '—'}${detail.fromWidth !== detail.toWidth ? `, width ${detail.fromWidth ?? '—'} → ${detail.toWidth ?? '—'} MHz` : ''}`;
	if (kind === 'device_interview') return typeof detail.status === 'string' ? `Interview ${detail.status}` : 'Interview';
	if (kind === 'route_error' && typeof detail.kind === 'string') return `${humanise(detail.kind.replace(/_/g, " "))}${detail.code != null ? `, code ${detail.code}` : ''}`;
	if (typeof detail.delta === 'number' && Object.keys(detail).length === 1) return `+${detail.delta}`;
	if ('to' in detail && Object.keys(detail).every((k) => k === 'from' || k === 'to')) {
		const u = kind === 'battery_swap' ? '%' : '';
		return `${from ?? '—'}${from == null ? '' : u} → ${to ?? '—'}${to == null ? '' : u}`;
	}
	return Object.entries(detail).map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`).join(', ');
}

export interface BatteryRow {
	ieee: string;
	name: string;
	battery: number | null;
	voltage: number | null;
	daysLeft: number | null;
	lastSwapAt: number | null;
	low: boolean;
	/** Sparkline path of the last 30 days; empty when < 2 points. */
	trend: string;
}

/** Shopping list order: low now (lowest charge first), then by forecast days left, then the rest (lowest charge first). */
export function batteryRows(devices: DeviceState[], daysLeft: Map<string, number>, lastSwap: Map<string, number>, lowPct: (d: DeviceState) => number = () => 25, trends: Map<string, string> = new Map()): BatteryRow[] {
	const pct = (r: BatteryRow) => r.battery ?? 101;
	const group = (r: BatteryRow) => (r.low ? 0 : r.daysLeft !== null ? 1 : 2);
	return devices.filter((d) => d.powerSource === 'Battery' && d.removedAt === null).map((d) => ({
		ieee: d.ieee, name: d.friendlyName, battery: d.battery, voltage: d.voltage,
		daysLeft: daysLeft.get(d.ieee) ?? null, lastSwapAt: lastSwap.get(d.ieee) ?? null,
		trend: trends.get(d.ieee) ?? '',
		low: d.batteryLow === true || (d.battery !== null && d.battery <= lowPct(d))
	})).sort((a, b) => group(a) - group(b) || (group(a) === 1 ? a.daysLeft! - b.daysLeft! : 0) || pct(a) - pct(b));
}

export function splitBatteries(rows: BatteryRow[], days = 30) {
	const withFc = rows.filter((r) => r.daysLeft !== null).sort((a, b) => a.daysLeft! - b.daysLeft!);
	return {
		soon: withFc.filter((r) => r.daysLeft! <= days), later: withFc.filter((r) => r.daysLeft! > days),
		none: rows.filter((r) => r.daysLeft === null).sort((a, b) => a.name.localeCompare(b.name))
	};
}

/** "about 18 days", "about 1 day", "less than a day" */
export function formatDaysLeft(days: number): string {
	const n = Math.round(days);
	return n < 1 ? 'less than a day' : `about ${n} ${n === 1 ? 'day' : 'days'}`;
}

/** Top bar summary: unresolved top-level issues (children are not counted, like the score) and MQTT staleness. */
export function navSummary(
	open: { severity: Severity; parentIssueId: number | null }[],
	monitor: { connected: boolean; downSince: number | null; startedAt: number }
): { count: number; worst: Severity | null; stale: boolean; staleSince: number | null } {
	const top = open.filter((i) => i.parentIssueId === null);
	const worst = top.reduce<Severity | null>((w, i) => (w === null || RANK[i.severity] > RANK[w] ? i.severity : w), null);
	return { count: top.length, worst, stale: !monitor.connected, staleSince: monitor.connected ? null : (monitor.downSince ?? monitor.startedAt) };
}

export const RULE_LABELS: Record<RuleId, string> = {
	'bridge.offline': 'Bridge offline',
	'bridge.restarted': 'Bridge restarted',
	'bridge.permit_join_open': 'Permit join open',
	'monitor.mqtt_lost': 'MQTT connection lost',
	'device.offline': 'Device offline',
	'device.flapping': 'Device flapping',
	'battery.low': 'Battery low',
	'battery.dropping': 'Rechargeable dropping',
	'lqi.weak': 'Weak link',
	'lqi.degrading': 'Degrading link',
	'route.failures': 'Route failures',
	'network.route_errors': 'Route errors',
	'battery.forecast': 'Battery forecast',
	'network.mass_offline': 'Mass offline',
	'device.rejoin_churn': 'Rejoin churn',
	'device.leave': 'Device left',
	'network.churn': 'Network churn',
	'device.interview_failed': 'Interview failed',
	'bridge.mqtt_backlog': 'MQTT backlog',
	'device.storm': 'Device storm',
	'device.dominant': 'Dominant device',
	'network.storm': 'Network storm',
	'battery.stale': 'Battery stale',
	'coordinator.missing_router': 'Missing from coordinator',
	'active.scan_failing': 'Network scan failing',
	'wifi.channel_overlap': 'Wi-Fi overlaps Zigbee',
	'wifi.busy_air': 'Busy Wi-Fi channel',
	'wifi.unreachable': 'UniFi unreachable'
};

export const scoreLabel = (s: Status): 'Good' | 'Fair' | 'Poor' => ({ green: 'Good', amber: 'Fair', red: 'Poor' } as const)[s];

/** "7 grouped issues: 1 device offline, 6 device silent" (most frequent rule first) */
export function groupedSummary(children: { rule: string }[]): string {
	const n = new Map<string, number>();
	for (const c of children) n.set(c.rule, (n.get(c.rule) ?? 0) + 1);
	const parts = [...n].sort((a, b) => b[1] - a[1]).map(([r, k]) => `${k} ${(RULE_LABELS[r as RuleId] ?? r).toLowerCase()}`);
	return `${children.length} grouped issue${children.length === 1 ? '' : 's'}: ${parts.join(', ')}`;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const dot = (s: string) => (/[.!?]$/.test(s) ? s : s + '.');

/** Overview banner from the sorted top-level open issues. */
export function banner(top: { severity: Severity; summary: string; action: string }[]): { tone: 'ok' | 'warn' | 'crit'; kicker: string; title: string; sub: string } {
	if (!top.length) return { tone: 'ok', kicker: 'All good', title: 'All good', sub: 'No open issues.' };
	const crit = top.filter((i) => i.severity === 'critical').length;
	if (!crit) return { tone: 'warn', kicker: 'Needs attention', title: `${plural(top.length, 'unresolved issue')}`, sub: `Nothing critical. Start with: ${dot(top[0].action)}` };
	const warn = top.filter((i) => i.severity === 'warning').length;
	return {
		tone: 'crit', kicker: 'Critical', title: top[0].summary,
		sub: `${plural(crit, 'critical issue')}${warn ? ` and ${plural(warn, 'warning')}` : ''}. Start with: ${dot(top[0].action)}`
	};
}

/** Hours of history since the first hourly sample; done after `days`. */
export function learning(firstHour: number | null, now: number, days = 3): { hours: number; done: boolean } {
	const hours = firstHour === null ? 0 : Math.max(0, Math.floor((now - firstHour) / 3_600_000));
	return { hours, done: hours >= days * 24 };
}

/** Current, peak and quietest messages per minute over the series. */
export function peakQuiet(points: { t: number; v: number }[], tz: string): { now: number | null; peak: string; quiet: string } | null {
	if (points.length < 2) return null;
	const hm = (t: number) => new Date(t).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
	const peak = points.reduce((a, p) => (p.v > a.v ? p : a));
	const quiet = points.reduce((a, p) => (p.v < a.v ? p : a));
	return { now: Math.round(points[points.length - 1].v), peak: `${Math.round(peak.v)}/min at ${hm(peak.t)}`, quiet: hm(quiet.t) };
}

/** Battery forecasts within `within` days for devices that exist and are not removed, soonest first. */
export function batteriesDue(rows: { ieee: string; days: number }[], state: Pick<AppState, 'devices'>, within = 30): { name: string; days: number }[] {
	return rows.flatMap((r) => {
		const d = state.devices.get(r.ieee);
		return d && d.removedAt === null && r.days <= within ? [{ name: d.friendlyName, days: Math.round(r.days) }] : [];
	}).sort((a, b) => a.days - b.days);
}

/** Wi-Fi issues use `wifi:<mac>` in the ieee slot; the AP name is in the evidence. */
export const isWifiKey = (ieee: string | null) => !!ieee?.startsWith('wifi:');
export const wifiApName = (ieee: string | null, evidence: Record<string, unknown> | null) => (isWifiKey(ieee) ? String(evidence?.ap ?? ieee!.slice(5)) : undefined);

/** The device an issue page may act on: present and not removed. */
export function liveDevice<D extends { removedAt: number | null }>(devices: Map<string, D>, ieee: string | null): D | undefined {
	const d = ieee ? devices.get(ieee) : undefined;
	return d && d.removedAt === null ? d : undefined;
}

/** Which device chart best shows the evidence for a rule. */
export function chartFor(rule: string): 'battery' | 'lqi' | 'msgs' | null {
	if (rule.startsWith('battery.')) return 'battery';
	if (rule.startsWith('lqi.') || rule === 'route.failures') return 'lqi';
	return rule === 'device.storm' || rule === 'device.dominant' ? 'msgs' : null;
}

export function setupNotice(i: { connected: boolean; connectedAt: number | null; lastError: string | null; bridgeSeen: boolean; mqttUrl: string; baseTopic: string; now: number }): { kind: 'mqtt' | 'z2m'; text: string } | null {
	if (!i.connected) {
		let url = 'the configured URL';
		try { const u = new URL(i.mqttUrl); u.username = ''; u.password = ''; url = u.href.replace(/\/$/, ''); } catch { /* keep placeholder */ }
		return { kind: 'mqtt', text: `MeshPulse can't reach the MQTT broker at ${url}${i.lastError ? `: ${i.lastError}` : ''}. Check the URL, username and password.` };
	}
	if (i.bridgeSeen || i.connectedAt === null || i.now - i.connectedAt < 120_000) return null;
	return { kind: 'z2m', text: `Connected, but nothing from Zigbee2MQTT on ${i.baseTopic}/bridge/…. Check Z2M_BASE_TOPIC (now ${i.baseTopic}) and that the MQTT user may subscribe to ${i.baseTopic}/#.` };
}
