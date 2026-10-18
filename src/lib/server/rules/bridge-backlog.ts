import { issueKey, type Finding, type RuleContext } from './types';

export function bridgeBacklog(ctx: RuleContext): Finding[] {
	const s = ctx.settings;
	const [prev, last] = ctx.health.length >= 2 ? ctx.health.slice(-2).map((h) => h.queued ?? 0) : [0, 0];
	const bad = ctx.open.has(issueKey('bridge.mqtt_backlog', null)) ? last >= s.backlogClear : prev > s.backlogHigh && last > s.backlogHigh;
	if (!bad) return [];
	return [{
		rule: 'bridge.mqtt_backlog',
		ieee: null,
		severity: 'warning',
		summary: `Zigbee2MQTT has ${last} messages queued for MQTT`,
		action: 'Zigbee2MQTT is falling behind publishing to MQTT — check the broker and the Zigbee2MQTT host',
		evidence: { queued: last, previous: prev, high: s.backlogHigh, clearBelow: s.backlogClear }
	}];
}
