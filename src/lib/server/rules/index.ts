import type { Finding, Rule, RuleContext, RuleId } from './types';
import { batteryLow } from './battery';
import { bridgeBacklog } from './bridge-backlog';
import { bridgeOffline } from './bridge-offline';
import { bridgeRestarted } from './bridge-restarted';
import { deviceLeave, interviewFailed, networkChurn, rejoinChurn } from './churn';
import { deviceFlapping } from './device-flapping';
import { deviceOffline } from './device-offline';
import { batteryForecast } from './forecast';
import { lqiDegrading, lqiWeak } from './lqi';
import { massOffline } from './mass-offline';
import { mqttLost } from './mqtt-lost';
import { permitJoinOpen } from './permit-join';
import { networkRouteErrors, routeFailures } from './route';
import { deviceDominant, deviceStorm, networkStorm } from './storm';

export * from './types';

export const RULES: Rule[] = [bridgeOffline, bridgeRestarted, permitJoinOpen, mqttLost, deviceOffline, deviceFlapping, batteryLow, lqiWeak, lqiDegrading, routeFailures, networkRouteErrors,
	batteryForecast, massOffline, rejoinChurn, deviceLeave, networkChurn, interviewFailed, bridgeBacklog,
	deviceStorm, deviceDominant, networkStorm];

const d = (minRuns: number, deviceLevel: boolean, notify = true) => ({ minRuns, resolveRuns: 2, deviceLevel, notify });
export const RULE_DEFAULTS: Record<RuleId, { minRuns: number; resolveRuns: number; deviceLevel: boolean; notify: boolean }> = {
	'bridge.offline': d(2, false),
	'bridge.restarted': d(2, false),
	'bridge.permit_join_open': d(1, false),
	'monitor.mqtt_lost': d(1, false),
	'device.offline': d(2, true),
	'device.flapping': d(2, true),
	'battery.low': d(2, true),
	'lqi.weak': d(2, true),
	'lqi.degrading': d(2, true),
	'route.failures': d(2, true),
	'network.route_errors': d(2, false),
	'battery.forecast': d(1, true, false), // UI only
	'network.mass_offline': d(2, false),
	'device.rejoin_churn': d(2, true),
	'device.leave': d(2, true),
	'network.churn': d(2, false),
	'device.interview_failed': d(2, true),
	'bridge.mqtt_backlog': d(2, false),
	'device.storm': d(2, true),
	'device.dominant': d(2, true),
	'network.storm': d(2, false)
};

export function evaluateRules(ctx: RuleContext): Finding[] {
	return RULES.flatMap((rule) => rule(ctx)).filter((f) => {
		const dev = f.ieee === null ? undefined : ctx.state.devices.get(f.ieee);
		return !dev || (dev.removedAt === null && !dev.tags.includes('ignore') && !dev.ignoreRules.includes(f.rule));
	});
}
