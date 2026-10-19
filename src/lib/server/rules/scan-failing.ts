import type { Finding, RuleContext } from './types';

export function scanFailing(ctx: RuleContext): Finding[] {
	if ((ctx.active?.scanFailStreak ?? 0) < 3) return [];
	return [{
		rule: 'active.scan_failing',
		ieee: null,
		severity: 'info',
		summary: 'Network scan keeps failing',
		action: `Check that the MQTT user may publish on ${ctx.active!.baseTopic ?? 'zigbee2mqtt'}/bridge/request/# and that Zigbee2MQTT is healthy`,
		evidence: { failedInARow: ctx.active!.scanFailStreak }
	}];
}
