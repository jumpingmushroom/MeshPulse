import { describe, expect, it } from 'vitest';
import { ctx, dev, ev, H, LAMP, MIN, NOW } from '../../../../tests/helpers/ctx';
import { route } from '../mqtt/route';
import { evaluate, newIssue, type IssueRow } from '../issues/lifecycle';
import { evaluateRules, issueKey, type RuleContext } from './index';
import { networkRouteErrors, routeFailures } from './route';

/** `n` route errors spread over the window ending `endAgo` ms before NOW */
const errs = (n: number, ieee: string | null, span = 20 * H, endAgo = 0, kind = 'command_failed') =>
	Array.from({ length: n }, (_, i) => ev({ ts: NOW - endAgo - Math.floor((i * span) / n) - 1, ieee, kind: 'route_error', detail: { kind, code: 'MAC_NO_ACK' } }));

function setup(events: ReturnType<typeof errs>, opts: { open?: string; openIeee?: string | null; baseline?: { value: number; days: number } } = {}): RuleContext {
	const c = ctx();
	c.events = events.sort((a, b) => a.ts - b.ts);
	if (opts.open) c.open.add(issueKey(opts.open, opts.openIeee ?? null));
	if (opts.baseline) c.history.baselines.set('|route_errors_hourly', opts.baseline);
	return c;
}

describe('route.failures', () => {
	it('4 in 24 h: none; 5: warning; 20: critical', () => {
		expect(routeFailures(setup(errs(4, LAMP)))).toEqual([]);
		expect(routeFailures(setup(errs(5, LAMP)))).toEqual([{
			rule: 'route.failures', ieee: LAMP, severity: 'warning', summary: 'Messages to living/lamp are failing (5 in 24 h)',
			action: 'Check the router path to the device: move it closer to a router or add one nearby',
			evidence: { count: 5, warn: 5, critical: 20, clearBelow: 2 }
		}]);
		expect(routeFailures(setup(errs(20, LAMP)))[0].severity).toBe('critical');
	});

	it('open stays while at 2 or more, stops below 2', () => {
		expect(routeFailures(setup(errs(2, LAMP), { open: 'route.failures', openIeee: LAMP }))).toHaveLength(1);
		expect(routeFailures(setup(errs(1, LAMP), { open: 'route.failures', openIeee: LAMP }))).toEqual([]);
	});

	it('does not open for an offline device, but holds an open issue', () => {
		const c = setup(errs(30, LAMP));
		dev(c, LAMP).availability = 'offline';
		expect(routeFailures(c)).toEqual([]);
		c.open.add(issueKey('route.failures', LAMP));
		expect(routeFailures(c)).toHaveLength(1);
	});

	it('commands sent while the device was offline do not open an issue once it is back', () => {
		const c = ctx();
		dev(c, LAMP).availability = 'offline';
		const fail = { level: 'error', message: `Publish 'set' 'state' to 'living/lamp' failed: 'Error: ZCL command ${LAMP}/1 genOnOff.on({}, {}) failed (Data request failed with error: 'NWK_NO_ROUTE' (0xcd))'` };
		for (let i = 0; i < 25; i++) for (const fx of route(c.state, { ts: NOW - H + i * MIN, topic: 'zigbee2mqtt/bridge/logging', payload: fail, retain: false }, 'zigbee2mqtt'))
			if (fx.kind === 'event') c.events.push(ev(fx.event));
		expect(c.events).toHaveLength(25);
		dev(c, LAMP).availability = 'online';
		expect(routeFailures(c)).toEqual([]);
	});

	it('open at critical stays critical down to the warning threshold', () => {
		const c = setup(errs(5, LAMP), { open: 'route.failures', openIeee: LAMP });
		expect(routeFailures(c)[0].severity).toBe('warning');
		c.openCritical = new Set([issueKey('route.failures', LAMP)]);
		expect(routeFailures(c)[0].severity).toBe('critical');
		c.events = errs(4, LAMP);
		expect(routeFailures(c)[0].severity).toBe('warning');
	});

	it('ignores ping failures (availability rules cover them)', () => {
		expect(routeFailures(setup(errs(30, LAMP, 20 * H, 0, 'ping_failed')))).toEqual([]);
	});

	it('a flapping device with command failures opens once and never resolves or reopens', () => {
		const c = setup(errs(6, LAMP));
		const issues: IssueRow[] = [];
		const counters = { seen: new Map(), missing: new Map() };
		const kinds: string[] = [];
		for (let k = 0; k < 30; k++) {
			const now = NOW + k * MIN;
			// online for 3 runs, then offline/online every 2 runs
			dev(c, LAMP).availability = k >= 3 && Math.floor(k / 2) % 2 === 0 ? 'offline' : 'online';
			const open = issues.filter((i) => i.state !== 'resolved');
			const run = { ...c, now, open: new Set(open.map((i) => issueKey(i.rule, i.ieee))) };
			c.state.bridge.lastDeviceAt = now;
			const r = evaluate({ device: (ieee) => c.state.devices.get(ieee), findings: evaluateRules(run), issues: open, counters, mutedUntil: () => null, settings: c.settings, now, networkQuiet: false });
			for (const f of r.opens) issues.push({ id: issues.length + 1, ...newIssue(f, now, true) });
			for (const { id, patch } of r.updates) Object.assign(issues[id - 1], patch);
			kinds.push(...r.notify.filter((n) => n.key.startsWith('route.failures|')).map((n) => n.kind));
		}
		expect(kinds).toEqual(['open']);
		expect(issues.filter((i) => i.rule === 'route.failures')).toHaveLength(1);
	});

	it('ignores network-only errors and other events', () => {
		const c = setup(errs(30, null));
		c.events.push(ev({ ts: NOW - MIN, ieee: LAMP, kind: 'availability', detail: { from: 'online', to: 'offline' } }));
		expect(routeFailures(c)).toEqual([]);
	});
});

describe('network.route_errors', () => {
	const hour = (n: number, endAgo = 0) => errs(n, null, H - 1, endAgo, 'ping_failed'); // pings still count network-wide

	it('30 in the last hour, baseline 5 over 3 days: warning', () => {
		expect(networkRouteErrors(setup(hour(30), { baseline: { value: 5, days: 3 } }))).toEqual([{
			rule: 'network.route_errors', ieee: null, severity: 'warning',
			summary: 'Zigbee network has unusually many delivery failures (30 in the last hour, normally about 5)',
			action: expect.any(String),
			evidence: { lastHour: 30, baseline: 5, baselineDays: 3, factor: 3, min: 10 }
		}]);
	});

	it('needs at least 10, more than 3x baseline, and 3 baseline days', () => {
		expect(networkRouteErrors(setup(hour(9), { baseline: { value: 0.5, days: 3 } }))).toEqual([]);
		expect(networkRouteErrors(setup(hour(15), { baseline: { value: 5, days: 3 } }))).toEqual([]);
		expect(networkRouteErrors(setup(hour(30), { baseline: { value: 5, days: 2 } }))).toEqual([]);
		expect(networkRouteErrors(setup(hour(30)))).toEqual([]);
		// errors from 2 h ago do not count as the last hour
		expect(networkRouteErrors(setup(hour(30, H + MIN), { baseline: { value: 5, days: 3 } }))).toEqual([]);
	});

	it('open stops only when each of the last 2 h is below 1.5x baseline', () => {
		const open = (events: ReturnType<typeof errs>, value = 5) =>
			networkRouteErrors(setup(events, { open: 'network.route_errors', baseline: { value, days: 3 } }));
		expect(open([...hour(8), ...hour(3, H)])).toHaveLength(1);
		expect(open([...hour(3), ...hour(8, H)])).toHaveLength(1);
		expect(open([...hour(7), ...hour(7, H)])).toEqual([]);
		// a zero baseline still lets a quiet network stop
		expect(open([], 0)).toEqual([]);
		expect(open(hour(1), 0)).toHaveLength(1);
	});
});
