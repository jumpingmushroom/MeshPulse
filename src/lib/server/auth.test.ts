import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// no request in tests: the cookie plugin must see "no event", not a thrown error
vi.mock('$app/server', () => ({ getRequestEvent: () => undefined }));

const dir = mkdtempSync(join(tmpdir(), 'meshpulse-auth-'));
let auth: Awaited<ReturnType<typeof import('./auth').getAuth>>;
let ensureAdmin: typeof import('./auth').ensureAdmin;

beforeAll(async () => {
	process.env.DATABASE_PATH = join(dir, 'test.db');
	process.env.SECRET_KEY = 'test-secret-key-that-is-long-enough-123';
	const mod = await import('./auth');
	auth = mod.getAuth();
	ensureAdmin = mod.ensureAdmin;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('auth', () => {
	it('ensureAdmin creates once then exists', async () => {
		expect(await ensureAdmin(auth, undefined, 'x')).toBe('skipped');
		expect(await ensureAdmin(auth, 'admin@example.com', 'correct-horse-battery')).toBe('created');
		expect(await ensureAdmin(auth, 'admin@example.com', 'correct-horse-battery')).toBe('exists');
	});

	it('sign-up endpoint is rejected', async () => {
		await expect(auth.api.signUpEmail({ body: { email: 'eve@example.com', password: 'password1234', name: 'Eve' } })).rejects.toThrow();
	});

	it('admin can sign in', async () => {
		const res = await auth.api.signInEmail({ body: { email: 'admin@example.com', password: 'correct-horse-battery' } });
		expect(res.token).toBeTruthy();
		await expect(auth.api.signInEmail({ body: { email: 'admin@example.com', password: 'wrong-password' } })).rejects.toThrow();
	});
});
