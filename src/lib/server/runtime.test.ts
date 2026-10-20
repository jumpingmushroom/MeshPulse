import { describe, expect, it } from 'vitest';
import { seedAdmin } from './runtime';

describe('seedAdmin', () => {
	it('does not touch Better Auth in add-on mode', () => {
		let called = false;
		seedAdmin({ adminEmail: undefined, adminPassword: undefined }, true, () => {
			called = true;
			throw new Error('unreachable');
		});
		expect(called).toBe(false);
	});
});
