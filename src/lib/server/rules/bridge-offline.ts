import { inGrace, issueKey, type Finding, type RuleContext } from './types';

const CLEAR_MS = 2 * 60_000;

export function bridgeOffline(ctx: RuleContext): Finding[] {
	const { now, state, settings } = ctx;
	const b = state.bridge;
	const m = state.monitor;
	const open = ctx.open.has(issueKey('bridge.offline', null));
	// disconnected from MQTT: our view of Z2M is stale (mqtt_lost covers it), so only hold an open issue
	if (!m.connected && !open) return [];
	const silentMs = now - (b.lastLiveAt ?? m.startedAt);
	// a new silence finding counts from reconnect too; clearing an open one needs real live messages
	const newSilentMs = now - Math.max(b.lastLiveAt ?? m.startedAt, m.connectedAt ?? 0);
	// no retained bridge/state: count "online" from when we (re)connected
	const upSince = b.onlineSince ?? Math.max(m.connectedAt ?? 0, m.startedAt);
	const bad = !m.connected || (open
		? !(b.state !== 'offline' && now - upSince >= CLEAR_MS && silentMs < CLEAR_MS)
		: b.state === 'offline' || (!inGrace(ctx) && newSilentMs >= settings.bridgeSilenceMin * 60_000));
	if (!bad) return [];
	return [{
		rule: 'bridge.offline',
		ieee: null,
		severity: 'critical',
		summary: !m.connected
			? 'Zigbee2MQTT status unknown while MeshPulse is disconnected from MQTT'
			: b.state === 'offline'
			? 'Zigbee2MQTT is offline'
			: `No messages from Zigbee2MQTT for ${Math.round(silentMs / 60_000)} min`,
		action: 'Check that Zigbee2MQTT and the coordinator are running',
		evidence: { state: b.state, lastLiveAt: b.lastLiveAt, onlineSince: b.onlineSince }
	}];
}
