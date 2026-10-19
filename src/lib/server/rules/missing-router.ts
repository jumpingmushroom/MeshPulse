import type { Finding, RuleContext } from './types';

export function missingRouter(ctx: RuleContext): Finding[] {
	return (ctx.active?.missingRouters ?? []).flatMap((ieee) => {
		const d = ctx.state.devices.get(ieee);
		if (!d || d.removedAt !== null || d.tags.includes('ignore')) return [];
		return [{
			rule: 'coordinator.missing_router' as const,
			ieee,
			severity: 'warning' as const,
			summary: `${d.friendlyName} is missing from the coordinator`,
			action: `Re-pair ${d.friendlyName} so the coordinator knows it again`,
			evidence: {}
		}];
	});
}
