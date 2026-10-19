import { describe, expect, it } from 'vitest';
import type { Finding, RuleContext } from '../rules/types';
import { withWifi } from './correlate';

const MIN = 60_000;
const now = Date.UTC(2026, 9, 19, 12, 0);
const ap = (o: Partial<NonNullable<RuleContext['wifi']>['aps'][number]> = {}) => ({ mac: 'aa', name: 'bas-wap-upro-01', area: 'Basement', channel: 1, width: 20, overlaps: true,
	cuTotal: 50, cuMaxHour: 72, busyFor: 0, clearFor: 0, changedAt: null, ...o });
const snap = (aps = [ap()], fresh = true): NonNullable<RuleContext['wifi']> =>
	({ zigbeeChannel: 11, lastZigbeeChannel: 11, fresh, aps, enabled: true, failures: 0, lastError: null });
const f = (rule: Finding['rule'], ieee: string | null): Finding => ({ rule, ieee, severity: 'warning', summary: 'S.', action: 'A', evidence: {} });
const run = (fs: Finding[], s: RuleContext['wifi'], open = new Set<string>(), areas: (i: string) => string[] = () => ['Basement']) =>
	withWifi(fs, open, s, areas, 60, 'UTC', now, now - 2 * MIN);

describe('withWifi', () => {
	it('adds evidence and the correlation line for a device in an area with a busy overlapping AP', () => {
		const [r] = run([f('lqi.weak', 'x')], snap());
		expect(r.summary).toBe('S. Wi-Fi may be involved: bas-wap-upro-01 on channel 1 (overlaps Zigbee 11) was 72 % busy');
		expect(r.evidence.wifi).toEqual([{ ap: 'bas-wap-upro-01', channel: 1, overlaps: true, cuTotal: 50, cuMaxHour: 72, changedAt: null }]);
		expect(r.severity).toBe('warning');
	});
	it('uses all APs for network findings and ignores APs of other areas for devices', () => {
		const s = snap([ap(), ap({ mac: 'bb', name: 'up', area: 'Upstairs' })]);
		expect((run([f('network.mass_offline', null)], s)[0].evidence.wifi as unknown[]).length).toBe(2);
		expect((run([f('device.offline', 'x')], s)[0].evidence.wifi as unknown[]).length).toBe(1);
	});
	it('lists an AP once when the device matches two areas, one of which has the AP', () => {
		const s = snap([ap(), ap({ mac: 'bb', name: 'up', area: 'Upstairs' }), ap({ mac: 'cc', name: 'far', area: 'Garage' })]);
		const [r] = run([f('route.failures', 'x')], s, new Set(), () => ['Basement', 'Basement 2']);
		expect((r.evidence.wifi as { ap: string }[]).map((a) => a.ap)).toEqual(['bas-wap-upro-01']);
	});
	it('leaves findings of open keys untouched', () => {
		const x = f('lqi.weak', 'x');
		expect(run([x], snap(), new Set(['lqi.weak|x']))[0]).toBe(x);
	});
	it('says unavailable when the last poll is older than 15 minutes', () => {
		const [r] = withWifi([f('lqi.weak', 'x')], new Set(), snap(), () => ['Basement'], 60, 'UTC', now, now - 20 * MIN);
		expect(r.evidence.wifi).toBe('unavailable');
		expect(r.summary).toBe('S.');
	});
	it('stores the line as evidence.wifiNote too', () => {
		const [r] = run([f('lqi.weak', 'x')], snap());
		expect(r.evidence.wifiNote).toBe('Wi-Fi may be involved: bas-wap-upro-01 on channel 1 (overlaps Zigbee 11) was 72 % busy');
	});
	it('caps a network line at the 2 most relevant APs', () => {
		const aps = [ap({ mac: '1', name: 'a', cuMaxHour: 65 }), ap({ mac: '2', name: 'b', cuMaxHour: 90 }), ap({ mac: '3', name: 'c', cuMaxHour: 70 })];
		const [r] = run([f('network.mass_offline', null)], snap(aps));
		expect(r.evidence.wifiNote).toBe('Wi-Fi may be involved: b on channel 1 (overlaps Zigbee 11) was 90 % busy; c on channel 1 (overlaps Zigbee 11) was 70 % busy; and 1 more');
		expect((r.evidence.wifi as unknown[]).length).toBe(3);
	});
	it('mentions a recent channel change', () => {
		const [r] = run([f('lqi.weak', 'x')], snap([ap({ cuMaxHour: 10, changedAt: now - 20 * MIN })]));
		expect(r.summary).toContain('bas-wap-upro-01 on channel 1 (overlaps Zigbee 11) changed channel at 11:40');
	});
	it('adds no line for a quiet AP and skips other rules and wifi.*', () => {
		expect(run([f('lqi.weak', 'x')], snap([ap({ cuMaxHour: 10 })]))[0].summary).toBe('S.');
		const o = f('battery.low', 'x'), w = f('wifi.busy_air', 'wifi:aa');
		expect(run([o, w], snap())).toEqual([o, w]);
	});
	it('leaves findings identical with Wi-Fi off', () => {
		const x = [f('lqi.weak', 'x')];
		expect(withWifi(x, new Set(), undefined, () => [], 60, 'UTC', now, now)).toEqual(x);
		expect(run(x, { ...snap(), enabled: false })).toEqual(x);
	});
});
