import { describe, expect, it, vi } from 'vitest';
import { heartbeatTick, isHealthy } from './heartbeat';
import { createState } from './types';

const NOW = 1_000_000_000;
const mon = (o = {}) => ({ ...createState(NOW).monitor, connected: true, lastRulesRunAt: NOW - 1000, ...o });

describe('heartbeat', () => {
	it('healthy only when connected and rules ran within 2 min', () => {
		expect(isHealthy(mon(), NOW)).toBe(true);
		expect(isHealthy(mon({ connected: false }), NOW)).toBe(false);
		expect(isHealthy(mon({ lastRulesRunAt: null }), NOW)).toBe(false);
		expect(isHealthy(mon({ lastRulesRunAt: NOW - 120_000 }), NOW)).toBe(true);
		expect(isHealthy(mon({ lastRulesRunAt: NOW - 120_001 }), NOW)).toBe(false);
	});

	it('skipped when unhealthy or no url', async () => {
		const fetch = vi.fn();
		const s = createState(NOW);
		s.monitor = mon({ connected: false });
		expect(await heartbeatTick({ state: s, url: 'http://x/y', fetch }, NOW)).toBe('skipped');
		s.monitor = mon();
		expect(await heartbeatTick({ state: s, url: '', fetch }, NOW)).toBe('skipped');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('sends GET when healthy, never throws', async () => {
		const s = createState(NOW);
		s.monitor = mon();
		const ok = vi.fn().mockResolvedValue({ ok: true });
		expect(await heartbeatTick({ state: s, url: 'http://x/y', fetch: ok }, NOW)).toBe('sent');
		expect(ok.mock.calls[0][0]).toBe('http://x/y');
		const bad = vi.fn().mockResolvedValue({ ok: false, status: 500 });
		expect(await heartbeatTick({ state: s, url: 'http://x/y', fetch: bad }, NOW)).toBe('skipped');
		const boom = vi.fn().mockRejectedValue(new Error('net'));
		expect(await heartbeatTick({ state: s, url: 'http://x/y', fetch: boom }, NOW)).toBe('skipped');
	});
});
