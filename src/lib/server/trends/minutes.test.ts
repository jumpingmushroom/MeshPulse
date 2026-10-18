import { describe, expect, it } from 'vitest';
import { MinuteCounters } from './minutes';

const M = 60_000;
const T = 1_000_000 * M;

describe('MinuteCounters', () => {
	it('counts per minute and drops minutes older than 60', () => {
		const c = new MinuteCounters();
		c.add('a', T - 3 * M);
		c.add('a', T - 3 * M + 5);
		c.add('b', T - 2 * M);
		c.add('a', T + 10); // current minute: incomplete
		expect(c.perMinute('a', T + 20, 4)).toEqual([0, 2, 0, 0]);
		expect(c.perMinute(null, T + 20, 3)).toEqual([2, 1, 0]);
		c.add('a', T - 100 * M);
		c.add('a', T + 70 * M); // prunes everything older than 61 minutes
		expect(c.perMinute('a', T + 70 * M, 120).reduce((x, y) => x + y, 0)).toBe(0);
	});

	it('topShare excludes chatty', () => {
		const c = new MinuteCounters();
		for (let i = 0; i < 6; i++) c.add('chat', T - M);
		for (let i = 0; i < 3; i++) c.add('b', T - M);
		c.add('c', T - M);
		expect(c.topShare(T, 5, new Set())).toEqual({ ieee: 'chat', share: 0.6, total: 10 });
		expect(c.topShare(T, 5, new Set(['chat']))).toEqual({ ieee: 'b', share: 0.3, total: 10 });
		expect(new MinuteCounters().topShare(T, 5, new Set())).toBeNull();
	});
});
