import { expect, it } from 'vitest';
import { createLimiter } from './login-limit';

const MIN = 60_000;

it('blocks after max failures within the window', () => {
	const l = createLimiter(3, 15 * MIN);
	for (let i = 0; i < 3; i++) {
		expect(l.blocked('ip', i)).toBe(false);
		l.fail('ip', i);
	}
	expect(l.blocked('ip', 3)).toBe(true);
	expect(l.blocked('other', 3)).toBe(false);
});

it('forgets failures older than the window', () => {
	const l = createLimiter(2, 15 * MIN);
	l.fail('ip', 0);
	l.fail('ip', 1);
	expect(l.blocked('ip', 15 * MIN - 1)).toBe(true);
	expect(l.blocked('ip', 15 * MIN + 1)).toBe(false);
	l.fail('ip', 15 * MIN + 2);
	expect(l.blocked('ip', 15 * MIN + 3)).toBe(false);
});

it('resets on success', () => {
	const l = createLimiter(2, 15 * MIN);
	l.fail('ip', 0);
	l.fail('ip', 1);
	l.reset('ip');
	expect(l.blocked('ip', 2)).toBe(false);
});

it('evicts IPs whose failures are all outside the window', () => {
	const l = createLimiter(2, 15 * MIN);
	l.fail('old', 0);
	l.fail('new', 15 * MIN + 1);
	expect(l.size()).toBe(1);
});
