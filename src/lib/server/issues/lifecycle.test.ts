import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings';
import type { Finding, RuleId } from '../rules/index';
import type { Severity } from '../types';
import { evaluate, type Counters, type IssueRow } from './lifecycle';

const T = 1760000000000;
const MIN = 60_000;
const H = 60 * MIN;
const DEV = '0xdev';

const f = (severity: Severity = 'warning', rule: RuleId = 'battery.low', ieee: string | null = DEV): Finding =>
	({ rule, ieee, severity, summary: `${rule} ${severity}`, action: 'fix', evidence: { severity } });

const issue = (p: Partial<IssueRow> = {}): IssueRow => ({
	id: 1, rule: 'battery.low', ieee: DEV, severity: 'warning', state: 'open', openedAt: T, updatedAt: T,
	resolvedAt: null, summary: 's', action: 'fix', evidence: {}, lastNotifiedAt: T, ...p
});

const counters = (): Counters => ({ seen: new Map(), missing: new Map() });

function run(findings: Finding[], issues: IssueRow[], c: Counters, now: number, muted: number | null = null) {
	return evaluate({ findings, issues, counters: c, mutedUntil: () => muted, settings: DEFAULT_SETTINGS, now });
}

describe('lifecycle', () => {
	it('opens after 2 runs', () => {
		const c = counters();
		const r1 = run([f()], [], c, T);
		expect(r1.opens).toEqual([]);
		expect(r1.notify).toEqual([]);
		const r2 = run([f()], [], c, T + MIN);
		expect(r2.opens).toEqual([f()]);
		expect(r2.notify).toEqual([{ key: 'battery.low|0xdev', kind: 'open', severity: 'warning' }]);
	});

	it('one bad sample never alerts', () => {
		const c = counters();
		const all = [run([f()], [], c, T), run([], [], c, T + MIN), run([f()], [], c, T + 2 * MIN)];
		expect(all.flatMap((r) => r.opens)).toEqual([]);
		expect(all.flatMap((r) => r.notify)).toEqual([]);
	});

	it('escalates and notifies', () => {
		const r = run([f('critical')], [issue()], counters(), T + MIN);
		expect(r.notify).toEqual([{ key: 'battery.low|0xdev', kind: 'escalate', severity: 'critical' }]);
		expect(r.updates).toEqual([{ id: 1, patch: {
			summary: 'battery.low critical', evidence: { severity: 'critical' }, updatedAt: T + MIN,
			severity: 'critical', lastNotifiedAt: T + MIN } }]);
	});

	it('escalation notifies even when acknowledged', () => {
		const r = run([f('critical')], [issue({ state: 'acknowledged' })], counters(), T + MIN);
		expect(r.notify.map((n) => n.kind)).toEqual(['escalate']);
	});

	it('de-escalates silently', () => {
		const r = run([f('warning')], [issue({ severity: 'critical' })], counters(), T + MIN);
		expect(r.notify).toEqual([]);
		expect(r.updates[0].patch).toMatchObject({ severity: 'warning', updatedAt: T + MIN });
		expect(r.updates[0].patch.lastNotifiedAt).toBeUndefined();
	});

	it('resolves after 2 missing runs with duration', () => {
		const c = counters();
		const i = issue({ state: 'acknowledged' });
		const r1 = run([], [i], c, T + 10 * MIN);
		expect(r1.updates).toEqual([]);
		expect(r1.notify).toEqual([]);
		const r2 = run([], [i], c, T + 11 * MIN);
		expect(r2.updates).toEqual([{ id: 1, patch: {
			state: 'resolved', resolvedAt: T + 11 * MIN, updatedAt: T + 11 * MIN,
			evidence: { durationMs: 11 * MIN }, lastNotifiedAt: T + 11 * MIN } }]);
		expect(r2.notify).toEqual([{ key: 'battery.low|0xdev', kind: 'resolved', severity: 'warning' }]);
	});

	it('a finding in between resets the resolve hold', () => {
		const c = counters();
		run([], [issue()], c, T + MIN);
		run([f()], [issue()], c, T + 2 * MIN);
		expect(run([], [issue()], c, T + 3 * MIN).notify).toEqual([]);
	});

	it('reminds critical after 6 h, warning after 24 h, never info', () => {
		const at = (sev: Severity, h: number) =>
			run([f(sev)], [issue({ severity: sev })], counters(), T + h * H).notify.map((n) => n.kind);
		expect(at('critical', 5.9)).toEqual([]);
		expect(at('critical', 6)).toEqual(['reminder']);
		expect(at('warning', 23.9)).toEqual([]);
		expect(at('warning', 24)).toEqual(['reminder']);
		expect(at('info', 100)).toEqual([]);
		const r = run([f('critical')], [issue({ severity: 'critical' })], counters(), T + 6 * H);
		expect(r.updates[0].patch.lastNotifiedAt).toBe(T + 6 * H);
	});

	it('no reminders when acknowledged', () => {
		const r = run([f('critical')], [issue({ severity: 'critical', state: 'acknowledged' })], counters(), T + 48 * H);
		expect(r.notify).toEqual([]);
	});

	it('muted device opens but never notifies', () => {
		const c = counters();
		const until = T + 1000 * H;
		run([f()], [], c, T, until);
		const open = run([f()], [], c, T + MIN, until);
		expect(open.opens).toHaveLength(1);
		expect(open.notify).toEqual([]);
		const i = issue({ lastNotifiedAt: null });
		expect(run([f('critical')], [i], c, T + 30 * H, until).notify).toEqual([]);
		run([], [i], c, T + 31 * H, until);
		const res = run([], [i], c, T + 32 * H, until);
		expect(res.updates[0].patch.state).toBe('resolved');
		expect(res.notify).toEqual([]);
		// a mute that has expired no longer silences
		expect(run([f('critical')], [i], counters(), T + 30 * H, T).notify.map((n) => n.kind)).toEqual(['escalate']);
	});

	it('flood guard blocks new device issues but keeps updating open ones', () => {
		const c = counters();
		const bridge = issue({ id: 9, rule: 'bridge.offline', ieee: null, severity: 'critical' });
		const open = issue({ ieee: '0xother' });
		const findings = [f('critical', 'bridge.offline', null), f(), f('critical', 'battery.low', '0xother')];
		run(findings, [bridge, open], c, T + MIN);
		const r = run(findings, [bridge, open], c, T + 2 * MIN);
		expect(r.opens).toEqual([]);
		expect(r.notify).toEqual([{ key: 'battery.low|0xother', kind: 'escalate', severity: 'critical' }]);
		// a bridge.offline finding alone (no issue yet) also guards
		const c2 = counters();
		run([f('critical', 'bridge.offline', null), f()], [], c2, T);
		const r2 = run([f('critical', 'bridge.offline', null), f()], [], c2, T + MIN);
		expect(r2.opens.map((o) => o.rule)).toEqual(['bridge.offline']);
		// guard lifted: counters kept advancing, so the device issue opens on the next run
		expect(run([f()], [], c2, T + 2 * MIN).opens.map((o) => o.rule)).toEqual(['battery.low']);
	});
});
