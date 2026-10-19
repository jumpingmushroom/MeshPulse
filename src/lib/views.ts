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
}

// the coordinator is the network itself, not a device to watch
const watched = (state: Pick<AppState, 'devices'>) =>
	[...state.devices.values()].filter((d) => d.removedAt === null && d.type !== 'Coordinator');

export function deviceRows(state: Pick<AppState, 'devices'>, openIssues: { ieee: string | null; severity: Severity }[]): DeviceRow[] {
	const by = new Map<string, { severity: Severity }[]>();
	for (const i of openIssues) if (i.ieee) by.set(i.ieee, [...(by.get(i.ieee) ?? []), i]);
	return watched(state).map((d) => ({
		ieee: d.ieee, name: d.friendlyName, type: d.type, battery: d.battery, voltage: d.voltage,
		batteryPowered: d.powerSource === 'Battery' || d.battery !== null || d.voltage !== null,
		availability: d.availability, lastSeenAt: d.lastSeenAt, lqi: d.lqi, mutedUntil: d.mutedUntil,
		openIssues: by.get(d.ieee)?.length ?? 0, score: deviceScore(by.get(d.ieee) ?? [])
	}));
}

export type SortKey = 'name' | 'type' | 'availability' | 'lastSeenAt' | 'lqi' | 'battery' | 'voltage' | 'openIssues' | 'score';

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

export function counters(state: Pick<AppState, 'devices'>, batteryLowPct: number) {
	const ds = watched(state);
	const routers = ds.filter((d) => d.type === 'Router');
	const online = (xs: DeviceState[]) => xs.filter((d) => d.availability === 'online').length;
	return {
		devicesOnline: online(ds), devicesTotal: ds.length,
		routersOnline: online(routers), routersTotal: routers.length,
		batteriesLow: ds.filter((d) => d.battery !== null && d.battery <= batteryLowPct).length
	};
}

export function formatTime(ms: number | null, tz: string): string {
	return ms === null ? '—' : new Date(ms).toLocaleString('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' });
}

export function formatAgo(ms: number | null, now: number): string {
	if (ms === null) return 'never';
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

/** Issue evidence as readable [key, value] pairs: *At/*Since are times, *Ms are durations, nulls hidden. */
export function evidenceRows(evidence: Record<string, unknown>, tz: string): [string, string][] {
	return Object.entries(evidence).flatMap(([k, v]): [string, string][] => {
		if (v === null || v === undefined) return [];
		if (typeof v === 'number' && /(At|Since)$/.test(k)) return [[k, formatTime(v, tz)]];
		if (typeof v === 'number' && k.endsWith('Ms')) return [[k, formatDuration(v)]];
		return [[k, typeof v === 'object' ? JSON.stringify(v) : String(v)]];
	});
}

/** Event detail as short text: "offline → online", "20% → 100%" for swaps, else "key: value" pairs. */
export function formatDetail(kind: string, detail: Record<string, unknown> | null): string {
	if (!detail) return '';
	const { from, to } = detail;
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
}

/** Shopping list order: low now (lowest charge first), then by forecast days left, then the rest (lowest charge first). */
export function batteryRows(devices: DeviceState[], daysLeft: Map<string, number>, lastSwap: Map<string, number>, lowPct = 25): BatteryRow[] {
	const pct = (r: BatteryRow) => r.battery ?? 101;
	const group = (r: BatteryRow) => (r.low ? 0 : r.daysLeft !== null ? 1 : 2);
	return devices.filter((d) => d.powerSource === 'Battery' && d.removedAt === null).map((d) => ({
		ieee: d.ieee, name: d.friendlyName, battery: d.battery, voltage: d.voltage,
		daysLeft: daysLeft.get(d.ieee) ?? null, lastSwapAt: lastSwap.get(d.ieee) ?? null,
		low: d.batteryLow === true || (d.battery !== null && d.battery <= lowPct)
	})).sort((a, b) => group(a) - group(b) || (group(a) === 1 ? a.daysLeft! - b.daysLeft! : 0) || pct(a) - pct(b));
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
	'battery.stale': 'Battery stale'
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
