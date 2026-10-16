import type { Finding, RuleContext } from './index';

const H = 3_600_000;

export function bridgeRestarted(ctx: RuleContext): Finding[] {
	const restarts = ctx.events.filter((e) => e.kind === 'bridge_restart' && e.ts > ctx.now - 24 * H).map((e) => e.ts);
	const last = Math.max(...restarts);
	if (!restarts.length || ctx.now - last >= H) return [];
	const n = restarts.length;
	return [{
		rule: 'bridge.restarted',
		ieee: null,
		severity: n >= ctx.settings.restartWarnCount ? 'warning' : 'info',
		summary: n > 1 ? `Zigbee2MQTT restarted ${n} times in 24 h` : 'Zigbee2MQTT restarted',
		action: n > 1 ? 'Check the Zigbee2MQTT logs for crashes' : 'No action needed unless it repeats',
		evidence: { lastRestartAt: last, restarts24h: n }
	}];
}
