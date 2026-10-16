import type { Finding, RuleContext } from './types';

export function permitJoinOpen(ctx: RuleContext): Finding[] {
	const b = ctx.state.bridge;
	if (!b.permitJoin || b.permitJoinSince === null) return [];
	const openMs = ctx.now - b.permitJoinSince;
	if (openMs <= ctx.settings.permitJoinMaxMin * 60_000) return [];
	return [{
		rule: 'bridge.permit_join_open',
		ieee: null,
		severity: 'warning',
		summary: `Joining has been open for ${Math.round(openMs / 60_000)} min`,
		action: 'Disable permit join in Zigbee2MQTT',
		evidence: { permitJoinSince: b.permitJoinSince }
	}];
}
