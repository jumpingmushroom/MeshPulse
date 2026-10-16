// Pure view helpers shared by the pages (server loads and components).
import type { AppState, DeviceState, Severity } from './server/types';

const RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };

export type Status = 'green' | 'amber' | 'red';

/** Worst unresolved issue decides; info-only counts as green. */
export function overallStatus(issues: { severity: Severity }[]): Status {
	const worst = Math.max(0, ...issues.map((i) => RANK[i.severity]));
	return worst === 2 ? 'red' : worst === 1 ? 'amber' : 'green';
}

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
}

// the coordinator is the network itself, not a device to watch
const watched = (state: Pick<AppState, 'devices'>) =>
	[...state.devices.values()].filter((d) => d.removedAt === null && d.type !== 'Coordinator');

export function deviceRows(state: Pick<AppState, 'devices'>, openIssues: { ieee: string | null }[]): DeviceRow[] {
	const count = new Map<string, number>();
	for (const i of openIssues) if (i.ieee) count.set(i.ieee, (count.get(i.ieee) ?? 0) + 1);
	return watched(state).map((d) => ({
		ieee: d.ieee, name: d.friendlyName, type: d.type, battery: d.battery, voltage: d.voltage,
		batteryPowered: d.powerSource === 'Battery' || d.battery !== null || d.voltage !== null,
		availability: d.availability, lastSeenAt: d.lastSeenAt, lqi: d.lqi, mutedUntil: d.mutedUntil,
		openIssues: count.get(d.ieee) ?? 0
	}));
}

export type SortKey = 'name' | 'type' | 'availability' | 'lastSeenAt' | 'lqi' | 'battery' | 'voltage' | 'openIssues';

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
		batteriesLow: ds.filter((d) => d.battery !== null && d.battery < batteryLowPct).length
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
