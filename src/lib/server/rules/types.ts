import type { Settings } from '../settings';
import type { History } from '../trends/history';
import type { AppState, NewEvent, Severity } from '../types';

export type RuleId =
	| 'bridge.offline'
	| 'bridge.restarted'
	| 'bridge.permit_join_open'
	| 'monitor.mqtt_lost'
	| 'device.offline'
	| 'device.flapping'
	| 'battery.low'
	| 'lqi.weak'
	| 'lqi.degrading'
	| 'route.failures'
	| 'network.route_errors'
	| 'battery.forecast'
	| 'network.mass_offline';

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
	/** issueKey of every open issue at critical */
	openCritical?: Set<string>;
	history: History;
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

/** Startup grace after MeshPulse starts or Z2M restarts. */
export function inGrace(ctx: RuleContext): boolean {
	const { monitor, bridge } = ctx.state;
	return ctx.now < Math.max(monitor.startedAt, bridge.restartedAt ?? 0) + ctx.settings.graceMin * 60_000;
}
