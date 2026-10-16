import type { Settings } from '../settings';
import type { AppState, NewEvent, Severity } from '../types';
import { batteryLow } from './battery';
import { bridgeOffline } from './bridge-offline';
import { bridgeRestarted } from './bridge-restarted';
import { deviceFlapping } from './device-flapping';
import { deviceOffline } from './device-offline';
import { mqttLost } from './mqtt-lost';
import { permitJoinOpen } from './permit-join';

export type RuleId =
	| 'bridge.offline'
	| 'bridge.restarted'
	| 'bridge.permit_join_open'
	| 'monitor.mqtt_lost'
	| 'device.offline'
	| 'device.flapping'
	| 'battery.low';

export interface EventRow extends NewEvent {
	id: number;
}

export interface RuleContext {
	now: number;
	state: AppState;
	/** last 24 h, ascending */
	events: EventRow[];
	settings: Settings;
	/** issueKey of every open issue */
	open: Set<string>;
}

export interface Finding {
	rule: RuleId;
	ieee: string | null;
	severity: Severity;
	summary: string;
	action: string;
	evidence: Record<string, unknown>;
}

export type Rule = (ctx: RuleContext) => Finding[];

export const issueKey = (rule: string, ieee: string | null) => `${rule}|${ieee ?? ''}`;

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

/** Startup grace after MeshPulse starts or Z2M restarts. */
export function inGrace(ctx: RuleContext): boolean {
	const { monitor, bridge } = ctx.state;
	return ctx.now < Math.max(monitor.startedAt, bridge.restartedAt ?? 0) + ctx.settings.graceMin * 60_000;
}

export function evaluateRules(ctx: RuleContext): Finding[] {
	return RULES.flatMap((rule) => rule(ctx)).filter((f) => {
		const dev = f.ieee === null ? undefined : ctx.state.devices.get(f.ieee);
		return !dev || (dev.removedAt === null && !dev.tags.includes('ignore') && !dev.ignoreRules.includes(f.rule));
	});
}
