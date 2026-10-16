import { afterEach, expect, it } from 'vitest';
import { createState } from '../../../lib/server/types';
import { GET } from './+server';

afterEach(() => { delete (globalThis as { __meshpulse?: unknown }).__meshpulse; });

it('returns 503 then 200', async () => {
	const state = createState(Date.now());
	(globalThis as { __meshpulse?: unknown }).__meshpulse = { config: {}, db: {}, state };
	let res = await GET();
	expect(res.status).toBe(503);
	expect(await res.json()).toEqual({ mqtt: false, lastMessageAt: null, lastRulesRunAt: null });
	state.monitor.connected = true;
	state.monitor.lastRulesRunAt = Date.now();
	state.bridge.lastLiveAt = 5;
	res = await GET();
	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({ mqtt: true, lastMessageAt: 5, lastRulesRunAt: state.monitor.lastRulesRunAt });
});
