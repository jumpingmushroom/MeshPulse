import { deviceSilent } from './bridge-offline';
import { inGrace, issueKey, type Finding, type RuleContext } from './types';

export function massOffline(ctx: RuleContext): Finding[] {
	const { now, state, settings: s } = ctx;
	const open = ctx.open.has(issueKey('network.mass_offline', null));
	if (inGrace(ctx)) return [];
	// one Critical per outage: a dead bridge or silent coordinator is bridge.offline's; an open one holds through it
	if (!open && (ctx.open.has(issueKey('bridge.offline', null)) || state.bridge.state === 'offline' || deviceSilent(ctx))) return [];
	const devices = [...state.devices.values()].filter((d) => d.removedAt === null && d.type !== 'Coordinator' && !d.tags.includes('ignore'));
	const routersTotal = devices.filter((d) => d.type === 'Router').length;
	// only devices still offline count, so a resolved outage can't refire from the same events;
	// open holds on 24 h of events so long-dead devices can't keep it open forever
	const since = open ? 0 : now - s.massOfflineWindowMin * 60_000;
	const recent = new Set(ctx.events.filter((e) => e.kind === 'availability' && e.ts >= since && e.detail.to === 'offline').map((e) => e.ieee));
	const hit = devices.filter((d) => d.availability === 'offline' && recent.has(d.ieee));
	const routersOffline = hit.filter((d) => d.type === 'Router').length;
	const pct = routersTotal ? (routersOffline / routersTotal) * 100 : 0;
	const bad = open
		? hit.length >= s.massOfflineDevices || pct >= s.massOfflineClearPct
		: hit.length >= s.massOfflineDevices || pct >= s.massOfflineRouterPct;
	if (!bad) return [];
	return [{
		rule: 'network.mass_offline',
		ieee: null,
		severity: 'critical',
		summary: open ? `${hit.length} devices are still offline` : `${hit.length} devices went offline within ${s.massOfflineWindowMin} min`,
		action: 'Check the Zigbee coordinator and router power',
		evidence: { count: hit.length, routersOffline, routersTotal, names: hit.slice(0, 10).map((d) => d.friendlyName) }
	}];
}
