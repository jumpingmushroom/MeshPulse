import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from './crypto';

describe('crypto', () => {
	it('round-trips', () => {
		expect(decrypt(encrypt('https://discord.com/api/webhooks/1/abc', 's3cret'), 's3cret')).toBe('https://discord.com/api/webhooks/1/abc');
	});
	it('throws with the wrong secret', () => {
		expect(() => decrypt(encrypt('hello', 'right'), 'wrong')).toThrow();
	});
	it('two encryptions differ', () => {
		expect(encrypt('hello', 'k')).not.toBe(encrypt('hello', 'k'));
	});
});
