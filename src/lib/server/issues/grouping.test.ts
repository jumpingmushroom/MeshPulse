import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings';
import { issueKey, type Finding, type RuleId } from '../rules/index';
import type { Severity } from '../types';
import { evaluate, newIssue, type IssueRow, type Notify } from './lifecycle';
import { parentFor } from './grouping';

const T = 1760000000000;
const MIN = 60_000;

type Dev = { type: string; friendlyName: string; lastSeenAt: number | null; offlineSince: number | null };
const f = (rule: RuleId, ieee: string | null, severity: Severity = 'warning', evidence: Record<string, unknown> = {}): Finding =>
	({ rule, ieee, severity, summary: `${rule} ${ieee ?? ''}`.trim(), action: 'fix', evidence });

/** Applies lifecycle results like the engine does, parentOf included. */
function harness(devices: Record<string, Dev> = {}) {
	const issues: IssueRow[] = [];
	const notes: (Notify & { at: number })[] = [];
	const counters = { seen: new Map<string, number>(), missing: new Map<string, number>() };
	const open = () => issues.filter((i) => i.state !== 'resolved');
	const byKey = (k: string) => open().find((i) => issueKey(i.rule, i.ieee) === k)!;
	return {
		issues, notes,
		run(findings: Finding[], now: number) {
			const r = evaluate({ findings, issues: open(), counters, mutedUntil: () => null, settings: DEFAULT_SETTINGS, now, networkQuiet: false,
				device: (ieee) => devices[ieee] });
			for (const o of r.opens) issues.push({ id: issues.length + 1, ...newIssue(o, now, r.notify.some((n) => n.key === issueKey(o.rule, o.ieee))) });
			for (const { id, patch } of r.updates) Object.assign(issues[id - 1], patch);
			for (const [c, p] of r.parentOf) byKey(c).parentIssueId = byKey(p).id;
			notes.push(...r.notify.map((n) => ({ ...n, at: now })));
			return r;
		},
		get: (rule: RuleId, ieee: string | null) => issues.find((i) => i.rule === rule && i.ieee === ieee)!
	};
}

const ends = (n: number) => Array.from({ length: n }, (_, k) => `0xend${k}`);
const kinds = (notes: Notify[]) => notes.map((n) => `${n.key}:${n.kind}`);

describe('grouping', () => {
	it('children opening with their parent stay silent', () => {
		const h = harness();
		const findings = [f('network.mass_offline', null, 'critical'), ...ends(12).map((e) => f('device.offline', e))];
		h.run(findings, T);
		const r = h.run(findings, T + MIN);
		expect(r.opens[0].rule).toBe('network.mass_offline'); // parents first
		expect(kinds(h.notes)).toEqual(['network.mass_offline|:open']);
		const parent = h.get('network.mass_offline', null);
		expect(h.issues.filter((i) => i.parentIssueId === parent.id)).toHaveLength(12);
		expect(parent.evidence.children).toMatchObject({ count: 12 });
		expect(parent.summary).toBe('network.mass_offline; 12 device issues grouped');
		// later runs: no reminders, escalations or late opens for children
		for (let k = 2; k < 10; k++) h.run([f('network.mass_offline', null, 'critical'), ...ends(12).map((e) => f('device.offline', e, 'critical'))], T + k * MIN);
		expect(kinds(h.notes)).toEqual(['network.mass_offline|:open']);
	});

	it('a child firing while its parent is still pending waits and opens attached', () => {
		const h = harness();
		h.run([f('device.offline', '0xend0')], T);
		const r = h.run([f('device.offline', '0xend0'), f('network.mass_offline', null, 'critical')], T + MIN); // parent seen once
		expect(r.opens).toEqual([]);
		h.run([f('device.offline', '0xend0'), f('network.mass_offline', null, 'critical')], T + 2 * MIN);
		expect(h.get('device.offline', '0xend0').parentIssueId).toBe(h.get('network.mass_offline', null).id);
		expect(kinds(h.notes)).toEqual(['network.mass_offline|:open']);
	});

	it('already-open issues are attached retroactively to a parent opened this run, without a notification', () => {
		const h = harness();
		const off = ends(2).map((e) => f('device.offline', e));
		h.run(off, T);
		h.run(off, T + MIN);
		expect(kinds(h.notes)).toEqual(['device.offline|0xend0:open', 'device.offline|0xend1:open']);
		const all = [...off, f('network.mass_offline', null, 'critical')];
		h.run(all, T + 2 * MIN);
		const r = h.run(all, T + 3 * MIN);
		expect(r.parentOf.size).toBe(2);
		expect(kinds(h.notes).slice(2)).toEqual(['network.mass_offline|:open']);
		const parent = h.get('network.mass_offline', null);
		expect(h.get('device.offline', '0xend1').parentIssueId).toBe(parent.id);
		expect(parent.evidence.children).toMatchObject({ count: 2 });
	});

	it('router grouping: end devices last seen within 10 min of the router going offline are its children', () => {
		const off = T - 30 * MIN;
		const devices: Record<string, Dev> = {
			'0xrouter': { type: 'Router', friendlyName: 'Hall plug', lastSeenAt: off, offlineSince: off },
			'0xin': { type: 'EndDevice', friendlyName: 'In', lastSeenAt: off - 10 * MIN, offlineSince: null },
			'0xout': { type: 'EndDevice', friendlyName: 'Out', lastSeenAt: off - 11 * MIN, offlineSince: null }
		};
		const h = harness(devices);
		const findings = ['0xrouter', '0xin', '0xout'].map((d) => f('device.offline', d));
		h.run(findings, T);
		h.run(findings, T + MIN);
		const router = h.get('device.offline', '0xrouter');
		expect(h.get('device.offline', '0xin').parentIssueId).toBe(router.id);
		expect(h.get('device.offline', '0xout').parentIssueId).toBeNull();
		expect(router.summary).toBe('Hall plug offline: 1 devices went silent after it');
		expect(kinds(h.notes)).toEqual(['device.offline|0xrouter:open', 'device.offline|0xout:open']);
	});

	it('router window runs from its silence start, since Z2M marks it offline later', () => {
		const at = (sensor: number) => (ieee: string) => ({ '0xr': { type: 'Router', lastSeenAt: T, offlineSince: T + 10 * MIN },
			'0xe': { type: 'EndDevice', lastSeenAt: sensor, offlineSince: null } })[ieee];
		const cand = [{ key: 'device.offline|0xr', rule: 'device.offline' as const, ieee: '0xr', openedAt: T }];
		const child = f('device.offline', '0xe');
		expect(parentFor(child, cand, at(T - 2 * MIN), DEFAULT_SETTINGS)).toBe('device.offline|0xr');
		expect(parentFor(child, cand, at(T - 10 * MIN), DEFAULT_SETTINGS)).toBe('device.offline|0xr');
		expect(parentFor(child, cand, at(T - 11 * MIN), DEFAULT_SETTINGS)).toBeNull();
		expect(parentFor(child, cand, at(T + 20 * MIN), DEFAULT_SETTINGS)).toBe('device.offline|0xr');
		expect(parentFor(child, cand, at(T + 21 * MIN), DEFAULT_SETTINGS)).toBeNull();
	});

	it('a child already recovering when its parent resolves sends nothing', () => {
		const h = harness();
		const mass = f('network.mass_offline', null, 'critical');
		h.run([mass, f('device.offline', '0xend0')], T);
		h.run([mass, f('device.offline', '0xend0')], T + MIN);
		h.run([f('device.offline', '0xend0')], T + 2 * MIN); // parent missing 1
		const r = h.run([], T + 3 * MIN); // parent resolves, child missing 1
		expect(r.released).toHaveLength(1);
		h.run([], T + 4 * MIN);
		expect(h.get('device.offline', '0xend0').state).toBe('resolved');
		expect(kinds(h.notes)).toEqual(['network.mass_offline|:open', 'network.mass_offline|:resolved']);
	});

	it('an announced child (attached retroactively) is released without a new open; its resolve notifies', () => {
		const h = harness();
		const off = f('device.offline', '0xend0');
		const mass = f('network.mass_offline', null, 'critical');
		h.run([off], T);
		h.run([off], T + MIN);
		h.run([off, mass], T + 2 * MIN);
		h.run([off, mass], T + 3 * MIN);
		h.run([off], T + 4 * MIN);
		h.run([off], T + 5 * MIN); // parent resolves
		expect(h.get('device.offline', '0xend0').parentIssueId).toBeNull();
		h.run([], T + 6 * MIN);
		h.run([], T + 7 * MIN);
		expect(kinds(h.notes)).toEqual(['device.offline|0xend0:open', 'network.mass_offline|:open', 'network.mass_offline|:resolved', 'device.offline|0xend0:resolved']);
	});

	it('a days-old offline issue is not adopted by a new mass outage', () => {
		const h = harness();
		const old = f('device.offline', '0xend0');
		h.run([old], T);
		h.run([old], T + MIN);
		const mass = f('network.mass_offline', null, 'critical');
		const later = T + 3 * 24 * 60 * MIN;
		h.run([old, mass], later);
		const r = h.run([old, mass], later + MIN);
		expect(r.parentOf.size).toBe(0);
		expect(h.get('device.offline', '0xend0').parentIssueId).toBeNull();
	});

	it('released storm children say they are still noisy', () => {
		const h = harness();
		const storm = f('network.storm', null);
		const child = f('device.storm', '0xa');
		h.run([storm, child], T);
		h.run([storm, child], T + MIN);
		h.run([child], T + 2 * MIN);
		h.run([child], T + 3 * MIN);
		expect(h.get('device.storm', '0xa').summary).toBe('device.storm 0xa — still noisy after the network storm');
		expect(kinds(h.notes)).toEqual(['network.storm|:open', 'network.storm|:resolved', 'device.storm|0xa:open']);
	});

	it('router offline time falls back to the evidence offlineSince', () => {
		const devs = (ieee: string) => ({ '0xr': { type: 'Router', lastSeenAt: null, offlineSince: null }, '0xe': { type: 'EndDevice', lastSeenAt: T, offlineSince: null } })[ieee];
		const cand = { key: 'device.offline|0xr', rule: 'device.offline' as const, ieee: '0xr', openedAt: T };
		expect(parentFor(f('device.offline', '0xe'), [cand], devs, DEFAULT_SETTINGS)).toBeNull();
		expect(parentFor(f('device.offline', '0xe'), [{ ...cand, offlineSince: T + 3 * MIN }], devs, DEFAULT_SETTINGS)).toBe('device.offline|0xr');
	});

	it('earliest-opened parent wins', () => {
		const devs = (ieee: string) => ({ '0xr': { type: 'Router', lastSeenAt: T, offlineSince: T }, '0xe': { type: 'EndDevice', lastSeenAt: T, offlineSince: null } })[ieee];
		const router = { key: 'device.offline|0xr', rule: 'device.offline' as const, ieee: '0xr', openedAt: T + MIN };
		const mass = { key: 'network.mass_offline|', rule: 'network.mass_offline' as const, ieee: null, openedAt: T };
		expect(parentFor(f('device.offline', '0xe'), [router, mass], devs, DEFAULT_SETTINGS)).toBe(mass.key);
		expect(parentFor(f('device.offline', '0xe'), [{ ...router, openedAt: T - MIN }, mass], devs, DEFAULT_SETTINGS)).toBe(router.key);
		expect(parentFor(f('battery.low', '0xe'), [router, mass], devs, DEFAULT_SETTINGS)).toBeNull();
	});

	it('children resolving while the parent is open are silent; the parent resolve says how many recovered and releases the rest once', () => {
		const h = harness();
		const mass = f('network.mass_offline', null, 'critical');
		const child = (e: string) => f('device.offline', e);
		h.run([mass, ...ends(3).map(child)], T);
		h.run([mass, ...ends(3).map(child)], T + MIN);
		// two children recover while the parent is open
		h.run([mass, child('0xend2')], T + 2 * MIN);
		h.run([mass, child('0xend2')], T + 3 * MIN);
		expect(h.get('device.offline', '0xend0').state).toBe('resolved');
		expect(kinds(h.notes)).toEqual(['network.mass_offline|:open']);
		// parent resolves, one child still offline
		h.run([child('0xend2')], T + 4 * MIN);
		const r = h.run([child('0xend2')], T + 5 * MIN);
		expect(r.released).toEqual([h.get('device.offline', '0xend2').id]);
		expect(kinds(h.notes).slice(1)).toEqual(['network.mass_offline|:resolved', 'device.offline|0xend2:open']);
		const parent = h.get('network.mass_offline', null);
		expect(parent.summary).toBe('network.mass_offline; 1 device issues grouped; 2 of 3 grouped issues recovered');
		const released = h.get('device.offline', '0xend2');
		expect(released.parentIssueId).toBeNull();
		expect(released.summary).toBe('device.offline 0xend2 — still offline after the incident');
		// exactly one open; then it behaves as a normal issue
		for (let k = 6; k < 12; k++) h.run([child('0xend2')], T + k * MIN);
		expect(h.notes.filter((n) => n.key === 'device.offline|0xend2')).toHaveLength(1);
		h.run([], T + 12 * MIN);
		h.run([], T + 13 * MIN);
		expect(kinds(h.notes).at(-1)).toBe('device.offline|0xend2:resolved');
	});

	it('storm parent groups device.storm and device.dominant', () => {
		const h = harness();
		const findings = [f('network.storm', null), f('device.storm', '0xa'), f('device.dominant', '0xb'), f('battery.low', '0xc')];
		h.run(findings, T);
		h.run(findings, T + MIN);
		const storm = h.get('network.storm', null);
		expect(h.get('device.storm', '0xa').parentIssueId).toBe(storm.id);
		expect(h.get('device.dominant', '0xb').parentIssueId).toBe(storm.id);
		expect(h.get('battery.low', '0xc').parentIssueId).toBeNull();
		expect(kinds(h.notes)).toEqual(['network.storm|:open', 'battery.low|0xc:open']);
	});

	it('bridge.offline still blocks device-level opens; mass_offline no longer does', () => {
		const h = harness();
		const findings = [f('bridge.offline', null, 'critical'), f('battery.low', '0xc')];
		h.run(findings, T);
		expect(h.run(findings, T + MIN).opens.map((o) => o.rule)).toEqual(['bridge.offline']);
		const h2 = harness();
		const f2 = [f('network.mass_offline', null, 'critical'), f('battery.low', '0xc')];
		h2.run(f2, T);
		expect(h2.run(f2, T + MIN).opens.map((o) => o.rule)).toEqual(['network.mass_offline', 'battery.low']);
	});
});

describe('real parents', () => {
	const w = DEFAULT_SETTINGS.routerGroupWindowMin * MIN;
	const devs: Record<string, Dev> = {
		'0xr1': { type: 'Router', friendlyName: 'r1', lastSeenAt: T - 2 * MIN, offlineSince: T },
		'0xr2': { type: 'Router', friendlyName: 'r2', lastSeenAt: T - 2 * MIN, offlineSince: T },
		'0xe': { type: 'EndDevice', friendlyName: 'e', lastSeenAt: T - w / 2, offlineSince: null }
	};
	const cands = [
		{ key: issueKey('device.offline', '0xr1'), rule: 'device.offline' as RuleId, ieee: '0xr1', openedAt: T },
		{ key: issueKey('device.offline', '0xr2'), rule: 'device.offline' as RuleId, ieee: '0xr2', openedAt: T + 1 }
	];
	const child = { rule: 'device.offline' as RuleId, ieee: '0xe' };
	const d = (i: string) => devs[i];
	it('attaches to the real parent, not an earlier timing match', () => {
		expect(parentFor(child, cands, d, DEFAULT_SETTINGS)).toBe(cands[0].key);
		expect(parentFor(child, cands, d, DEFAULT_SETTINGS, () => '0xr2')).toBe(cands[1].key);
	});
	it('attaches to the real parent outside the timing window, and not to a timing match', () => {
		const far: Record<string, Dev> = { ...devs, '0xe': { ...devs['0xe'], lastSeenAt: T - 5 * w } };
		const f2 = (i: string) => far[i];
		expect(parentFor(child, cands, f2, DEFAULT_SETTINGS)).toBeNull();
		expect(parentFor(child, cands, f2, DEFAULT_SETTINGS, () => '0xr2')).toBe(cands[1].key);
		expect(parentFor(child, [cands[0]], d, DEFAULT_SETTINGS, () => '0xr2')).toBeNull();
	});
	it('falls back to timing when the child has no known parent', () => {
		expect(parentFor(child, cands, d, DEFAULT_SETTINGS, () => null)).toBe(cands[0].key);
	});
});
