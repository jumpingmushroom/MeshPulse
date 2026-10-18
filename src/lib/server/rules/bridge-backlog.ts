import { issueKey, type Finding, type RuleContext } from './types';

const FRESH_MS = 30 * 60_000;

export function bridgeBacklog(ctx: RuleContext): Finding[] {
	const s = ctx.settings;
	// stale samples (Z2M down or not publishing health) prove nothing either way
	const fresh = ctx.health.filter((h) => h.ts >= ctx.now - FRESH_MS);
	const [prev, last] = [fresh.at(-2)?.queued ?? null, fresh.at(-1)?.queued ?? null];
	const bad = ctx.open.has(issueKey('bridge.mqtt_backlog', null))
		? last === null || last >= s.backlogClear
		: prev !== null && last !== null && prev > s.backlogHigh && last > s.backlogHigh;
	if (!bad) return [];
	return [{
		rule: 'bridge.mqtt_backlog',
		ieee: null,
		severity: 'warning',
		summary: last === null ? 'Zigbee2MQTT had a backlog of messages queued for MQTT' : `Zigbee2MQTT has ${last} messages queued for MQTT`,
		action: 'Zigbee2MQTT is falling behind publishing to MQTT — check the broker and the Zigbee2MQTT host',
		evidence: { queued: last, previous: prev, high: s.backlogHigh, clearBelow: s.backlogClear }
	}];
}
