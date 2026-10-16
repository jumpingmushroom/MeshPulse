import type { Finding, Rule, RuleContext, RuleId } from './types';
import { batteryLow } from './battery';
import { bridgeOffline } from './bridge-offline';
import { bridgeRestarted } from './bridge-restarted';
import { deviceFlapping } from './device-flapping';
import { deviceOffline } from './device-offline';
import { mqttLost } from './mqtt-lost';
import { permitJoinOpen } from './permit-join';

export * from './types';

export const RULES: Rule[] = [bridgeOffline, bridgeRestarted, permitJoinOpen, mqttLost, deviceOffline, deviceFlapping, batteryLow];

const d = (minRuns: number, deviceLevel: boolean) => ({ minRuns, resolveRuns: 2, deviceLevel });
export const RULE_DEFAULTS: Record<RuleId, { minRuns: number; resolveRuns: number; deviceLevel: boolean }> = {
	'bridge.offline': d(2, false),
	'bridge.restarted': d(2, false),
	'bridge.permit_join_open': d(1, false),
	'monitor.mqtt_lost': d(1, false),
	'device.offline': d(2, true),
	'device.flapping': d(2, true),
	'battery.low': d(2, true)
};

export function evaluateRules(ctx: RuleContext): Finding[] {
	return RULES.flatMap((rule) => rule(ctx)).filter((f) => {
		const dev = f.ieee === null ? undefined : ctx.state.devices.get(f.ieee);
		return !dev || (dev.removedAt === null && !dev.tags.includes('ignore') && !dev.ignoreRules.includes(f.rule));
	});
}
