import { describe, expect, it } from 'vitest';
import { ctx, dev, flip, LAMP, MIN, NOW } from '../../../../tests/helpers/ctx';
import { evaluate, newIssue, type IssueRow } from '../issues/lifecycle';
import type { DeviceState } from '../types';
import { evaluateRules, issueKey, type RuleContext } from './index';
import { massOffline } from './mass-offline';

/** Adds `n` online devices of `type`; returns their ieees. */
function add(c: RuleContext, n: number, type: DeviceState['type']): string[] {
	return Array.from({ length: n }, (_, i) => {
		const ieee = `0x${type}${c.state.devices.size}`;
		c.state.devices.set(ieee, { ...dev(c, LAMP), ieee, friendlyName: `${type}_${i}`, type, recentSeen: [] });
		return ieee;
	});
}

/** Each device goes offline, spread over the `spanMin` minutes before now. */
function drop(c: RuleContext, ieees: string[], spanMin = 4) {
	ieees.forEach((ieee, i) => {
		const ts = c.now - Math.round((i * spanMin * MIN) / ieees.length) - 1000;
		Object.assign(dev(c, ieee), { availability: 'offline', offlineSince: ts });
		c.events.push(flip(ieee, ts, 'online', 'offline'));
	});
	c.events.sort((a, b) => a.ts - b.ts);
}

const setup = (ends: number, routers = 0) => {
	const c = ctx();
	return { c, ends: add(c, ends, 'EndDevice'), routers: add(c, routers, 'Router') };
};

describe('network.mass_offline', () => {
	it('10 devices offline within 5 min: critical', () => {
		const { c, ends } = setup(10);
		drop(c, ends);
		expect(massOffline(c)).toEqual([{
			rule: 'network.mass_offline', ieee: null, severity: 'critical',
			summary: '10 devices went offline within 5 min',
			action: 'Check the Zigbee coordinator and router power',
			evidence: { count: 10, routersOffline: 0, routersTotal: 2, names: ends.map((e) => dev(c, e).friendlyName) }
		}]);
	});

	it('9 devices: nothing', () => {
		const { c, ends } = setup(9);
		drop(c, ends);
		expect(massOffline(c)).toEqual([]);
	});

	it('20 % of routers: critical; just below: nothing', () => {
		const { c, routers } = setup(0, 8); // 10 routers with lamp and hall_plug
		drop(c, routers.slice(0, 2));
		expect(massOffline(c)).toMatchObject([{ evidence: { count: 2, routersOffline: 2, routersTotal: 10 } }]);
		add(c, 1, 'Router');
		expect(massOffline(c)).toEqual([]);
	});

	it('ignores offline events outside the window and devices already back online', () => {
		const { c, ends } = setup(12);
		drop(c, ends.slice(0, 10), 4);
		dev(c, ends[0]).availability = 'online';
		expect(massOffline(c)).toEqual([]);
		c.events = [];
		drop(c, ends.slice(0, 10), 4);
		c.events.find((e) => e.ieee === ends[9])!.ts = c.now - 5 * MIN - 1;
		expect(massOffline(c)).toEqual([]);
	});

	it('is suppressed while bridge.offline is open or the network is silent', () => {
		const { c, ends } = setup(12);
		drop(c, ends);
		c.open.add(issueKey('bridge.offline', null));
		expect(massOffline(c)).toEqual([]);
		c.open.clear();
		c.state.bridge.lastDeviceAt = NOW - 5 * MIN;
		expect(massOffline(c)).toEqual([]);
		c.state.bridge.lastDeviceAt = NOW;
		c.state.bridge.state = 'offline';
		expect(massOffline(c)).toEqual([]);
	});

	it('respects startup grace', () => {
		const { c, ends } = setup(12);
		drop(c, ends);
		c.state.monitor.startedAt = NOW - 10 * MIN;
		expect(massOffline(c)).toEqual([]);
	});

	it('when open, holds until offline devices and routers drop below the clear thresholds', () => {
		const { c, ends, routers } = setup(10, 18); // 20 routers
		drop(c, ends);
		c.events = []; // long ago: only current availability matters once open
		c.open.add(issueKey('network.mass_offline', null));
		expect(massOffline(c)).toMatchObject([{ summary: '10 devices are still offline', evidence: { count: 10 } }]);
		dev(c, ends[0]).availability = 'online';
		expect(massOffline(c)).toEqual([]);
		dev(c, ends[1]).availability = 'online';
		drop(c, routers.slice(0, 1)); // 1 of 20 routers = 5 %
		c.events = [];
		expect(massOffline(c)).toHaveLength(1);
		dev(c, routers[0]).availability = 'online';
		expect(massOffline(c)).toEqual([]);
	});

	it('an outage of 12 devices opens one Critical, no device issues, resolves once and never reopens', () => {
		const { c, ends } = setup(12);
		const issues: IssueRow[] = [];
		const counters = { seen: new Map(), missing: new Map() };
		const notes: string[] = [];
		for (let k = 0; k < 40; k++) {
			const now = NOW + k * MIN;
			c.state.bridge.lastDeviceAt = now;
			if (k === 1) drop({ ...c, now }, ends, 0.9);
			if (k === 15) for (const e of ends) Object.assign(dev(c, e), { availability: 'online', offlineSince: null, lastSeenAt: now });
			const open = issues.filter((i) => i.state !== 'resolved');
			const run = { ...c, now, open: new Set(open.map((i) => issueKey(i.rule, i.ieee))) };
			const r = evaluate({ findings: evaluateRules(run), issues: open, counters, mutedUntil: () => null, settings: c.settings, now });
			for (const f of r.opens) issues.push({ id: issues.length + 1, ...newIssue(f, now, true) });
			for (const { id, patch } of r.updates) Object.assign(issues[id - 1], patch);
			notes.push(...r.notify.map((n) => `${n.key}:${n.kind}:${n.severity}`));
		}
		expect(notes).toEqual(['network.mass_offline|:open:critical', 'network.mass_offline|:resolved:critical']);
		expect(issues.map((i) => i.rule)).toEqual(['network.mass_offline']);
	});
});
