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
	| 'network.mass_offline'
	| 'device.rejoin_churn'
	| 'device.leave'
	| 'network.churn'
	| 'device.interview_failed'
	| 'bridge.mqtt_backlog';

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
	/** last two health samples, newest last */
	health: { ts: number; queued: number | null }[];
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

/**
 * Whether an event at `ts` falls in a restart window, where announces, leaves and counter jumps are normal:
 * `graceMin` after MeshPulse starts or after any Z2M restart in `ctx.events`. A restart noticed from uptime
 * also guards `graceMin` after the process start, since its burst came before the health sample showed it.
 */
export function restartGuard(ctx: RuleContext): (ts: number) => boolean {
	const g = ctx.settings.graceMin * 60_000;
	const starts = [ctx.state.monitor.startedAt, ctx.state.bridge.restartedAt ?? -Infinity];
	for (const e of ctx.events)
		if (e.kind === 'bridge_restart') {
			starts.push(e.ts);
			if (e.detail.reason === 'uptime' && typeof e.detail.to === 'number') starts.push(e.ts - e.detail.to * 1000);
		}
	return (ts) => starts.some((s) => ts >= s && ts < s + g);
}
