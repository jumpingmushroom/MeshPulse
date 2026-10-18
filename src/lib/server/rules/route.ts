import { baselineOf } from '../trends/history';
import { issueKey, type Finding, type RuleContext } from './types';

const H = 3_600_000;

export function routeFailures(ctx: RuleContext): Finding[] {
	const s = ctx.settings;
	const counts = new Map<string, number>();
	// ping failures belong to device.offline / device.flapping; they only count network-wide
	for (const e of ctx.events) if (e.kind === 'route_error' && e.ieee && e.detail.kind === 'command_failed') counts.set(e.ieee, (counts.get(e.ieee) ?? 0) + 1);
	const out: Finding[] = [];
	for (const [ieee, count] of counts) {
		const d = ctx.state.devices.get(ieee);
		const open = ctx.open.has(issueKey('route.failures', ieee));
		// do not open for an offline device (device.offline covers it), but hold an open issue so a flap does not resolve and reopen it
		if (!d || (d.availability === 'offline' && !open)) continue;
		if (count < (open ? s.routeFailClear : s.routeFailWarn)) continue;
		out.push({
			rule: 'route.failures',
			ieee,
			severity: count >= s.routeFailCrit ? 'critical' : 'warning',
			summary: `Messages to ${d.friendlyName} are failing (${count} in 24 h)`,
			action: 'Check the router path to the device: move it closer to a router or add one nearby',
			evidence: { count, warn: s.routeFailWarn, critical: s.routeFailCrit, clearBelow: s.routeFailClear }
		});
	}
	return out;
}

export function networkRouteErrors(ctx: RuleContext): Finding[] {
	const s = ctx.settings;
	const b = baselineOf(ctx.history, '', 'route_errors_hourly');
	if (!b) return [];
	/** route errors in the hour ending `ago` hours before now */
	const inHour = (ago: number) => ctx.events.filter((e) => e.kind === 'route_error' && e.ts > ctx.now - (ago + 1) * H && e.ts <= ctx.now - ago * H).length;
	const lastHour = inHour(0);
	if (ctx.open.has(issueKey('network.route_errors', null))) {
		// zero always counts as calm, or a zero baseline would never let it stop
		const calm = (n: number) => n === 0 || n < s.netRouteClearFactor * b.value;
		if (calm(lastHour) && calm(inHour(1))) return [];
	} else if (b.days < s.baselineMinDays || lastHour <= s.netRouteFactor * b.value || lastHour < s.netRouteMin) return [];
	return [{
		rule: 'network.route_errors',
		ieee: null,
		severity: 'warning',
		summary: `Zigbee network has unusually many delivery failures (${lastHour} in the last hour, normally about ${Math.round(b.value)})`,
		action: 'Check for a router that went offline and for Wi-Fi or other 2.4 GHz interference near the coordinator',
		evidence: { lastHour, baseline: b.value, baselineDays: b.days, factor: s.netRouteFactor, min: s.netRouteMin }
	}];
}
