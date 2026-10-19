import { issueKey, RULE_DEFAULTS, type Finding, type RuleId } from '../rules/index';
import type { Settings } from '../settings';
import type { Severity } from '../types';
import { isParent, isRouterOffline, parentFor, type Candidate, type DeviceLookup } from './grouping';

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
	parentIssueId: number | null;
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
	/** no device message for 60 s: Z2M marks devices offline when the coordinator stops hearing them, so hold new device.offline */
	networkQuiet: boolean;
	device: DeviceLookup;
	/** parent ieee from the latest network scan, if known */
	realParent?: (ieee: string) => string | null;
}

export interface LifecycleResult {
	opens: Finding[];
	updates: { id: number; patch: Partial<IssueRow> }[];
	notify: Notify[];
	/** child key -> parent key, for opens and for open issues attached this run */
	parentOf: Map<string, string>;
	/** ids of children whose parent resolved (their patch clears parentIssueId) */
	released: number[];
}

export const RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };
const H = 3_600_000;
const GUARD_RULES: readonly string[] = ['bridge.offline', 'monitor.mqtt_lost'];

const RELEASE_SUFFIX: Partial<Record<RuleId, string>> = {
	'device.offline': ' — still offline after the incident',
	'device.flapping': ' — still flapping after the incident',
	'device.storm': ' — still noisy after the network storm',
	'device.dominant': ' — still noisy after the network storm'
};

interface Plan { i: IssueRow; key: string; f?: Finding; patch: Partial<IssueRow>; kind: NotifyKind | null; severity: Severity }
type Children = { names: string[]; recovered: number };

const evidenceSince = (e: Record<string, unknown>) => (typeof e.offlineSince === 'number' ? e.offlineSince : null);

/** Turns this run's findings into issue changes and notifications. Mutates `counters`. */
export function evaluate({ findings, issues, counters, mutedUntil, settings, now, networkQuiet, device, realParent }: LifecycleInput): LifecycleResult {
	const out: LifecycleResult = { opens: [], updates: [], notify: [], parentOf: new Map(), released: [] };
	const found = new Map(findings.map((f) => [issueKey(f.rule, f.ieee), f]));
	const byKey = new Map(issues.map((i) => [issueKey(i.rule, i.ieee), i]));
	const keyOf = new Map(issues.map((i) => [i.id, issueKey(i.rule, i.ieee)]));
	const muted = (ieee: string | null) => ieee !== null && (mutedUntil(ieee) ?? 0) > now;
	const guard = [...issues, ...findings].some((x) => GUARD_RULES.includes(x.rule));

	for (const key of counters.seen.keys()) if (!found.has(key)) counters.seen.delete(key);
	for (const key of counters.missing.keys()) if (found.has(key)) counters.missing.delete(key);

	let opening: Finding[] = [];
	for (const [key, f] of found) {
		const seen = (counters.seen.get(key) ?? 0) + 1;
		counters.seen.set(key, seen);
		if (byKey.has(key)) continue;
		const def = RULE_DEFAULTS[f.rule];
		if (seen < def.minRuns || (guard && def.deviceLevel) || (networkQuiet && f.rule === 'device.offline')) continue;
		opening.push(f);
	}

	const plans: Plan[] = [];
	for (const [key, i] of byKey) {
		const f = found.get(key);
		const plan: Plan = { i, key, f, patch: {}, kind: null, severity: i.severity };
		plans.push(plan);
		const { patch } = plan;
		const unannounced = i.lastNotifiedAt === null; // opened while muted, or as a child
		if (f) {
			Object.assign(patch, { summary: f.summary, evidence: f.evidence, updatedAt: now });
			if (f.severity !== i.severity) patch.severity = plan.severity = f.severity;
			if (unannounced) plan.kind = 'open'; // late announcement once the mute has expired
			else if (RANK[f.severity] > RANK[i.severity]) plan.kind = 'escalate';
			else if (f.severity === i.severity && i.state !== 'acknowledged' && i.severity !== 'info') {
				const every = (i.severity === 'critical' ? settings.reminderCriticalH : settings.reminderWarningH) * H;
				if (now - i.lastNotifiedAt! >= every) plan.kind = 'reminder';
			}
		} else {
			const missing = (counters.missing.get(key) ?? 0) + 1;
			counters.missing.set(key, missing);
			if (missing < RULE_DEFAULTS[i.rule].resolveRuns) continue;
			counters.missing.delete(key);
			Object.assign(patch, { state: 'resolved', resolvedAt: now, updatedAt: now,
				evidence: { ...i.evidence, durationMs: now - i.openedAt } });
			if (!unannounced) plan.kind = 'resolved'; // never announced: resolve silently
		}
	}

	// grouping: top-level parents, open or firing this run (pending ones not yet opened hold their children back)
	const resolving = new Set(plans.filter((p) => p.patch.state === 'resolved').map((p) => p.i.id));
	let tops: Candidate[] = [
		...plans.filter((p) => p.i.parentIssueId === null && !resolving.has(p.i.id) && isParent(p.i.rule, p.i.ieee, device))
			.map((p) => ({ key: p.key, rule: p.i.rule, ieee: p.i.ieee, openedAt: p.i.openedAt, offlineSince: evidenceSince(p.i.evidence) })),
		...[...found].filter(([k, f]) => !byKey.has(k) && isParent(f.rule, f.ieee, device))
			.map(([key, f]) => ({ key, rule: f.rule, ieee: f.ieee, openedAt: now, offlineSince: evidenceSince(f.evidence) }))
	];
	const isRouter = (f: Finding) => isRouterOffline(f.rule, f.ieee, device);
	// routers first: a router that joins a mass outage stops being a parent of its own
	for (const f of [...opening.filter(isRouter), ...opening.filter((f) => !isRouter(f))]) {
		const key = issueKey(f.rule, f.ieee);
		const p = parentFor(f, tops, device, settings, realParent);
		if (p === null) continue;
		out.parentOf.set(key, p);
		tops = tops.filter((t) => t.key !== key);
	}
	const opened = new Set(opening.map((f) => issueKey(f.rule, f.ieee)));
	opening = opening.filter((f) => { const p = out.parentOf.get(issueKey(f.rule, f.ieee)); return p === undefined || byKey.has(p) || opened.has(p); });
	for (const [c, p] of out.parentOf) if (!byKey.has(p) && !opened.has(p)) out.parentOf.delete(c); // held for the pending parent
	const fresh = tops.filter((t) => opened.has(t.key));
	const tally = new Map<string, Children>();
	const add = (parent: string, ieee: string | null, recovered: boolean) => {
		const t = tally.get(parent) ?? { names: [], recovered: 0 };
		tally.set(parent, t);
		if (recovered) t.recovered++;
		else t.names.push((ieee && device(ieee)?.friendlyName) || ieee || '');
	};
	for (const p of plans) {
		const parentId = p.i.parentIssueId;
		if (parentId === null) {
			if (resolving.has(p.i.id) || tops.some((t) => t.key === p.key) || !fresh.length) continue;
			// an old offline/flapping issue is not part of a new incident
			const stale = (t: Candidate) => (p.i.rule === 'device.offline' || p.i.rule === 'device.flapping') && p.i.openedAt < t.openedAt - settings.massOfflineWindowMin * 60_000;
			const parent = parentFor(p.i, fresh.filter((t) => !stale(t)), device, settings, realParent);
			if (parent === null) continue;
			out.parentOf.set(p.key, parent); // retroactive: update only
			p.kind = null;
			add(parent, p.i.ieee, false);
		} else if (!resolving.has(parentId) && keyOf.has(parentId)) {
			p.kind = null; // the parent is open: children stay silent
			add(keyOf.get(parentId)!, p.i.ieee, resolving.has(p.i.id));
		} else if (resolving.has(p.i.id)) {
			p.kind = null;
			if (keyOf.has(parentId)) add(keyOf.get(parentId)!, p.i.ieee, true);
		} else {
			// the parent resolved: an unannounced child still firing gets one normal open; others just lose the parent
			p.patch.parentIssueId = null;
			p.kind = p.f && p.i.lastNotifiedAt === null ? 'open' : null;
			if (p.kind) p.patch.summary = `${p.f!.summary}${RELEASE_SUFFIX[p.i.rule] ?? ''}`;
			out.released.push(p.i.id);
		}
	}
	for (const [c, p] of out.parentOf) if (opened.has(c)) add(p, found.get(c)!.ieee, false);

	const label = (f: Pick<Finding, 'rule' | 'ieee' | 'summary'>, n: number) => !n ? f.summary : isRouterOffline(f.rule, f.ieee, device)
		? `${device(f.ieee!)?.friendlyName ?? f.ieee} offline: ${n} devices went silent after it` : `${f.summary}; ${n} device issues grouped`;
	for (const p of plans) {
		const t = tally.get(p.key);
		const prev = p.i.evidence.children as Children | undefined;
		if (!t && !prev) continue;
		const recovered = (prev?.recovered ?? 0) + (t?.recovered ?? 0);
		if (p.patch.state === 'resolved') {
			const released = plans.filter((q) => q.i.parentIssueId === p.i.id && out.released.includes(q.i.id)).length;
			if (recovered + released) p.patch.summary = `${p.i.summary}; ${recovered} of ${recovered + released} grouped issues recovered`;
			continue;
		}
		const names = t?.names ?? [];
		p.patch.evidence = { ...(p.patch.evidence ?? p.i.evidence), children: { count: names.length, names, recovered } };
		if (p.f) p.patch.summary = label(p.f, names.length);
	}

	const parentsFirst = (f: Finding) => (tops.some((t) => t.key === issueKey(f.rule, f.ieee)) ? 0 : 1);
	for (const f of [...opening].sort((a, b) => parentsFirst(a) - parentsFirst(b))) {
		const key = issueKey(f.rule, f.ieee);
		const names = tally.get(key)?.names ?? [];
		out.opens.push(names.length ? { ...f, summary: label(f, names.length), evidence: { ...f.evidence, children: { count: names.length, names, recovered: 0 } } } : f);
		if (!out.parentOf.has(key) && RULE_DEFAULTS[f.rule].notify && !muted(f.ieee)) out.notify.push({ key, kind: 'open', severity: f.severity });
	}
	for (const { i, key, patch, kind, severity } of plans) {
		if (kind && RULE_DEFAULTS[i.rule].notify && !muted(i.ieee)) {
			patch.lastNotifiedAt = now;
			out.notify.push({ key, kind, severity });
		}
		if (Object.keys(patch).length) out.updates.push({ id: i.id, patch });
	}
	return out;
}

/** Insert values for an opened finding; `notified` when an `open` notify was emitted for it. */
export const newIssue = (f: Finding, now: number, notified: boolean): Omit<IssueRow, 'id'> => ({
	rule: f.rule, ieee: f.ieee, severity: f.severity, state: 'open', openedAt: now, updatedAt: now, resolvedAt: null,
	summary: f.summary, action: f.action, evidence: f.evidence, lastNotifiedAt: notified ? now : null, parentIssueId: null
});
