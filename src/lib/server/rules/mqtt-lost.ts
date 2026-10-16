import type { Finding, RuleContext } from './types';

export function mqttLost(ctx: RuleContext): Finding[] {
	const m = ctx.state.monitor;
	if (m.connected) return [];
	const since = m.downSince ?? m.startedAt; // never connected since start
	if (ctx.now - since <= ctx.settings.mqttLostSec * 1000) return [];
	return [{
		rule: 'monitor.mqtt_lost',
		ieee: null,
		severity: 'critical',
		summary: 'MeshPulse lost its connection to the MQTT broker',
		action: 'Check that the MQTT broker is running and reachable',
		evidence: { downSince: since }
	}];
}
