import { describe, expect, it } from 'vitest';
import { createState } from '../types';
import { openDb } from '../db/index';
import { getSettings, parseSettingsForm, saveFormSettings, saveSettings } from '../settings';
import { activeGuard, due, lastDay, setActive } from './schedule';

const TZ = 'Europe/Oslo';
const H = 3_600_000;

describe('due', () => {
	it('is null before the time, the day after it, and null once that day ran', () => {
		const at = (iso: string) => Date.parse(iso);
		expect(due(at('2026-10-20T03:29:00+02:00'), '03:30', '2026-10-19', TZ)).toBeNull();
		expect(due(at('2026-10-20T03:31:00+02:00'), '03:30', '2026-10-19', TZ)).toBe('2026-10-20');
		expect(due(at('2026-10-20T03:31:00+02:00'), '03:30', '2026-10-20', TZ)).toBeNull();
		expect(due(at('2026-10-20T03:31:00+02:00'), '03:30', '', TZ)).toBe('2026-10-20');
	});

	it('fires once on the DST change night (25 Oct 2026, Oslo), at the right time', () => {
		for (const [t, fire] of [['03:30', Date.UTC(2026, 9, 25, 2, 30)], ['04:00', Date.UTC(2026, 9, 25, 3, 0)]] as const) {
			let last = '';
			const fired: number[] = [];
			for (let ms = Date.UTC(2026, 9, 25, 0, 0); ms <= Date.UTC(2026, 9, 25, 6, 0); ms += 60_000) {
				const d = due(ms, t, last, TZ);
				if (d) { fired.push(ms); last = d; }
				// without the day update it keeps answering the same day: the day key, not the test, stops a second run
				if (d) expect(due(ms + 60_000, t, '', TZ)).toBe(d);
			}
			expect(fired).toEqual([fire]);
		}
	});
});

describe('active switches', () => {
	const thresholds = () => {
		const base = new FormData();
		for (const [k, v] of Object.entries(getSettings(openDb(':memory:')))) if (typeof v !== 'boolean') base.set(k, String(v));
		return base;
	};

	it('a thresholds save leaves both switches on', () => {
		const db = openDb(':memory:');
		saveSettings(db, { activeCoordinatorCheck: true, activeNetworkScan: true });
		const r = parseSettingsForm(thresholds());
		if ('error' in r) throw new Error(r.error);
		saveFormSettings(db, r.settings);
		expect(getSettings(db)).toMatchObject({ activeCoordinatorCheck: true, activeNetworkScan: true });
	});

	it('turning on seeds today as the last run day; off leaves it alone', () => {
		const db = openDb(':memory:');
		const now = Date.parse('2026-10-20T10:00:00+02:00');
		setActive(db, { activeCoordinatorCheck: true, activeNetworkScan: false }, now, TZ);
		expect(lastDay(db, 'coordinator_check')).toBe('2026-10-20');
		expect(lastDay(db, 'networkmap')).toBe('');
		expect(due(now, '03:30', lastDay(db, 'coordinator_check'), TZ)).toBeNull();
		setActive(db, { activeCoordinatorCheck: true, activeNetworkScan: false }, now + 24 * H, TZ); // still on: no reseed
		expect(lastDay(db, 'coordinator_check')).toBe('2026-10-20');
		setActive(db, { activeCoordinatorCheck: false, activeNetworkScan: false }, now + 48 * H, TZ);
		expect(lastDay(db, 'coordinator_check')).toBe('2026-10-20');
		expect(getSettings(db).activeCoordinatorCheck).toBe(false);
	});
});

describe('activeGuard', () => {
	const now = 100 * H;
	const healthy = () => {
		const s = createState(now - 2 * H);
		s.monitor.connected = true;
		s.bridge.state = 'online';
		return s;
	};
	it('returns the first matching reason', () => {
		const s = healthy();
		expect(activeGuard(s, new Set(), now, false, TZ)).toBeNull();
		expect(activeGuard(s, new Set(), now, true, TZ)).toBe('A request is already running');
		s.bridge.restartedAt = now - 30 * 60_000;
		expect(activeGuard(s, new Set(), now, true, TZ)).toBe('Zigbee2MQTT or MeshPulse restarted less than an hour ago — try again after 05:30');
		expect(activeGuard(s, new Set(['network.storm|']), now, true, TZ)).toBe('An outage is open (network.storm)');
		s.bridge.state = 'offline';
		expect(activeGuard(s, new Set(['network.storm|']), now, true, TZ)).toBe('Zigbee2MQTT bridge is not online');
		s.monitor.connected = false;
		expect(activeGuard(s, new Set(), now, true, TZ)).toBe('MQTT is disconnected');
	});
	it('treats MeshPulse starting less than an hour ago as a restart', () => {
		const s = healthy();
		s.monitor.startedAt = now - 10 * 60_000;
		expect(activeGuard(s, new Set(), now, false, TZ)).toBe('Zigbee2MQTT or MeshPulse restarted less than an hour ago — try again after 05:50');
	});
});
