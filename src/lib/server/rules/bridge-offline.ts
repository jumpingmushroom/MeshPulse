import { inGrace, issueKey, type Finding, type RuleContext } from './types';

const CLEAR_MS = 2 * 60_000;

/** No live device message for `ms`, counted from the later of the last one, (re)connect, start and Z2M restart. */
export function deviceSilentFor(ctx: RuleContext, ms: number): boolean {
	const { bridge: b, monitor: m } = ctx.state;
	return ctx.now - Math.max(b.lastDeviceAt ?? 0, m.connectedAt ?? 0, m.startedAt, b.restartedAt ?? 0) >= ms;
}

export const deviceSilent = (ctx: RuleContext) => !inGrace(ctx) && deviceSilentFor(ctx, ctx.settings.bridgeSilenceMin * 60_000);

export function bridgeOffline(ctx: RuleContext): Finding[] {
	const { now, state } = ctx;
	const b = state.bridge;
	const m = state.monitor;
	const open = ctx.open.has(issueKey('bridge.offline', null));
	// disconnected from MQTT: our view of Z2M is stale (mqtt_lost covers it), so only hold an open issue
	if (!m.connected && !open) return [];
	const silentMs = now - (b.lastDeviceAt ?? m.startedAt);
	// no retained bridge/state: count "online" from when we (re)connected
	const upSince = b.onlineSince ?? Math.max(m.connectedAt ?? 0, m.startedAt);
	// clearing needs 2 min of real device messages; a reconnect alone is not enough
	const flowing = silentMs < CLEAR_MS && b.deviceSince !== null && now - b.deviceSince >= CLEAR_MS;
	const bad = !m.connected || (open
		? !(b.state !== 'offline' && now - upSince >= CLEAR_MS && flowing)
		: b.state === 'offline' || deviceSilent(ctx));
	if (!bad) return [];
	const min = Math.round(silentMs / 60_000);
	return [{
		rule: 'bridge.offline',
		ieee: null,
		severity: 'critical',
		summary: !m.connected
			? 'Zigbee2MQTT status unknown while MeshPulse is disconnected from MQTT'
			: b.state === 'offline'
			? 'Zigbee2MQTT is offline'
			: b.state === 'online'
			? `Zigbee network silent: no device messages for ${min} min (Zigbee2MQTT is running)`
			: `No device messages from Zigbee2MQTT for ${min} min`,
		action: m.connected && b.state === 'online'
			? 'Check the Zigbee coordinator: restart the adapter, then Zigbee2MQTT'
			: 'Check that Zigbee2MQTT and the coordinator are running',
		evidence: { state: b.state, lastLiveAt: b.lastLiveAt, lastDeviceAt: b.lastDeviceAt, onlineSince: b.onlineSince }
	}];
}
