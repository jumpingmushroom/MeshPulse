import type { Finding, RuleId } from '../rules/index';
import type { Settings } from '../settings';

/** Incident rules and the device-level rules that attach to them as silent children. */
export const PARENT_RULES: Partial<Record<RuleId, RuleId[]>> = {
	'network.mass_offline': ['device.offline', 'device.flapping'],
	'network.storm': ['device.storm', 'device.dominant']
};

export type DeviceLookup = (ieee: string) => { type: string; friendlyName?: string; lastSeenAt: number | null; offlineSince: number | null } | undefined;
/** `offlineSince`: the issue's evidence, used when the device has none */
export interface Candidate { key: string; rule: RuleId; ieee: string | null; openedAt: number; offlineSince?: number | null }

export const isRouterOffline = (rule: RuleId, ieee: string | null, devices: DeviceLookup) =>
	rule === 'device.offline' && ieee !== null && devices(ieee)?.type === 'Router';

export const isParent = (rule: RuleId, ieee: string | null, devices: DeviceLookup) => rule in PARENT_RULES || isRouterOffline(rule, ieee, devices);

/** Key of the earliest-opened candidate `child` belongs to, or null. */
export function parentFor(child: Pick<Finding, 'rule' | 'ieee'>, candidates: Candidate[], devices: DeviceLookup, settings: Settings): string | null {
	const matches = (p: Candidate) => {
		if (PARENT_RULES[p.rule]?.includes(child.rule)) return true;
		if (child.rule !== 'device.offline' || child.ieee === null || !isRouterOffline(p.rule, p.ieee, devices)) return false;
		// shortcut: timing only, no real parent links; upgrade with the Phase 4 network map
		// from the router's silence start (Z2M's offline event lags by its availability timeout) to its offline time
		const r = devices(p.ieee!);
		const since = r?.offlineSince ?? p.offlineSince ?? null;
		const from = r?.lastSeenAt ?? since;
		const to = since ?? from;
		const w = settings.routerGroupWindowMin * 60_000;
		const c = devices(child.ieee);
		return from !== null && to !== null && c?.type === 'EndDevice' && c.lastSeenAt !== null && c.lastSeenAt >= from - w && c.lastSeenAt <= to + w;
	};
	let best: Candidate | null = null;
	for (const p of candidates) if (matches(p) && (!best || p.openedAt < best.openedAt)) best = p;
	return best?.key ?? null;
}
