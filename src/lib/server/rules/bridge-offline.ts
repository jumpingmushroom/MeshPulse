import { inGrace, issueKey, type Finding, type RuleContext } from './index';

const CLEAR_MS = 2 * 60_000;

export function bridgeOffline(ctx: RuleContext): Finding[] {
	const { now, state, settings } = ctx;
	const b = state.bridge;
	const lastLive = b.lastLiveAt ?? state.monitor.startedAt;
	const silentMs = now - lastLive;
	const bad = ctx.open.has(issueKey('bridge.offline', null))
		? !(b.state === 'online' && b.onlineSince !== null && now - b.onlineSince >= CLEAR_MS && silentMs < CLEAR_MS)
		: b.state === 'offline' || (!inGrace(ctx) && silentMs >= settings.bridgeSilenceMin * 60_000);
	if (!bad) return [];
	return [{
		rule: 'bridge.offline',
		ieee: null,
		severity: 'critical',
		summary: b.state === 'offline'
			? 'Zigbee2MQTT is offline'
			: `No messages from Zigbee2MQTT for ${Math.round(silentMs / 60_000)} min`,
		action: 'Check that Zigbee2MQTT and the coordinator are running',
		evidence: { state: b.state, lastLiveAt: b.lastLiveAt, onlineSince: b.onlineSince }
	}];
}
