import { describe, expect, it } from 'vitest';
import { createState } from '../types';
import { activeGuard, due } from './schedule';

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

	it('runs once on the DST change night (25 Oct 2026, Oslo)', () => {
		for (const t of ['03:30', '04:00'] as const) {
			let last = '';
			const days: string[] = [];
			for (let ms = Date.UTC(2026, 9, 25, 0, 0); ms <= Date.UTC(2026, 9, 25, 6, 0); ms += 60_000) {
				const d = due(ms, t, last, TZ);
				if (d) { days.push(d); last = d; }
			}
			expect(days).toEqual(['2026-10-25']);
		}
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
		expect(activeGuard(s, new Set(), now, false)).toBeNull();
		expect(activeGuard(s, new Set(), now, true)).toBe('A request is already running');
		s.bridge.restartedAt = now - 30 * 60_000;
		expect(activeGuard(s, new Set(), now, true)).toBe('Zigbee2MQTT or MeshPulse restarted less than an hour ago');
		expect(activeGuard(s, new Set(['network.storm|']), now, true)).toBe('An outage is open (network.storm)');
		s.bridge.state = 'offline';
		expect(activeGuard(s, new Set(['network.storm|']), now, true)).toBe('Zigbee2MQTT bridge is not online');
		s.monitor.connected = false;
		expect(activeGuard(s, new Set(), now, true)).toBe('MQTT is disconnected');
	});
	it('treats MeshPulse starting less than an hour ago as a restart', () => {
		const s = healthy();
		s.monitor.startedAt = now - 10 * 60_000;
		expect(activeGuard(s, new Set(), now, false)).toBe('Zigbee2MQTT or MeshPulse restarted less than an hour ago');
	});
});
