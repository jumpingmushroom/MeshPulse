import { issueKey, RULE_DEFAULTS, type Finding, type RuleId } from '../rules/index';
import type { Settings } from '../settings';
import type { Severity } from '../types';

export interface IssueRow {
	id: number;
	rule: RuleId;
	ieee: string | null;
	severity: Severity;
	state: 'open' | 'acknowledged' | 'resolved';
	openedAt: number;
	updatedAt: number;
	resolvedAt: number | null;
	summary: string;
	action: string;
	evidence: Record<string, unknown>;
	lastNotifiedAt: number | null;
}

export interface Counters {
	seen: Map<string, number>;
	missing: Map<string, number>;
}

export type NotifyKind = 'open' | 'escalate' | 'reminder' | 'resolved';
export interface Notify {
	key: string;
	kind: NotifyKind;
	severity: Severity;
}

export interface LifecycleInput {
	findings: Finding[];
	/** unresolved */
	issues: IssueRow[];
	counters: Counters;
	mutedUntil: (ieee: string) => number | null;
	settings: Settings;
	now: number;
}

export interface LifecycleResult {
	opens: Finding[];
	updates: { id: number; patch: Partial<IssueRow> }[];
	notify: Notify[];
}

const RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };
const H = 3_600_000;
const GUARD_RULES: readonly string[] = ['bridge.offline', 'monitor.mqtt_lost'];

/** Turns this run's findings into issue changes and notifications. Mutates `counters`. */
export function evaluate({ findings, issues, counters, mutedUntil, settings, now }: LifecycleInput): LifecycleResult {
	const out: LifecycleResult = { opens: [], updates: [], notify: [] };
	const found = new Map(findings.map((f) => [issueKey(f.rule, f.ieee), f]));
	const byKey = new Map(issues.map((i) => [issueKey(i.rule, i.ieee), i]));
	const muted = (ieee: string | null) => ieee !== null && (mutedUntil(ieee) ?? 0) > now;
	const guard = [...issues, ...findings].some((x) => GUARD_RULES.includes(x.rule));

	for (const key of counters.seen.keys()) if (!found.has(key)) counters.seen.delete(key);
	for (const key of counters.missing.keys()) if (found.has(key)) counters.missing.delete(key);

	for (const [key, f] of found) {
		const seen = (counters.seen.get(key) ?? 0) + 1;
		counters.seen.set(key, seen);
		if (byKey.has(key)) continue;
		const def = RULE_DEFAULTS[f.rule];
		if (seen < def.minRuns || (guard && def.deviceLevel)) continue;
		out.opens.push(f);
		if (!muted(f.ieee)) out.notify.push({ key, kind: 'open', severity: f.severity });
	}

	for (const [key, i] of byKey) {
		const f = found.get(key);
		const patch: Partial<IssueRow> = {};
		let kind: NotifyKind | null = null;
		let severity = i.severity;
		const unannounced = i.lastNotifiedAt === null; // opened while muted
		if (f) {
			Object.assign(patch, { summary: f.summary, evidence: f.evidence, updatedAt: now });
			if (f.severity !== i.severity) patch.severity = severity = f.severity;
			if (unannounced) kind = 'open'; // late announcement once the mute has expired
			else if (RANK[f.severity] > RANK[i.severity]) kind = 'escalate';
			else if (f.severity === i.severity && i.state !== 'acknowledged' && i.severity !== 'info') {
				const every = (i.severity === 'critical' ? settings.reminderCriticalH : settings.reminderWarningH) * H;
				if (now - i.lastNotifiedAt! >= every) kind = 'reminder';
			}
		} else {
			const missing = (counters.missing.get(key) ?? 0) + 1;
			counters.missing.set(key, missing);
			if (missing < RULE_DEFAULTS[i.rule].resolveRuns) continue;
			counters.missing.delete(key);
			Object.assign(patch, { state: 'resolved', resolvedAt: now, updatedAt: now,
				evidence: { ...i.evidence, durationMs: now - i.openedAt } });
			if (!unannounced) kind = 'resolved'; // never announced: resolve silently
		}
		if (kind && !muted(i.ieee)) {
			patch.lastNotifiedAt = now;
			out.notify.push({ key, kind, severity });
		}
		out.updates.push({ id: i.id, patch });
	}
	return out;
}

/** Insert values for an opened finding; `notified` when an `open` notify was emitted for it. */
export const newIssue = (f: Finding, now: number, notified: boolean): Omit<IssueRow, 'id'> => ({
	rule: f.rule, ieee: f.ieee, severity: f.severity, state: 'open', openedAt: now, updatedAt: now, resolvedAt: null,
	summary: f.summary, action: f.action, evidence: f.evidence, lastNotifiedAt: notified ? now : null
});
