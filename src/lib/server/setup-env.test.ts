import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('$app/server', () => ({ getRequestEvent: () => undefined }));

const dir = mkdtempSync(join(tmpdir(), 'meshpulse-setup-env-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('setup after an env-seeded admin', () => {
	it('is not needed, 404s, and refuses to create a second user', async () => {
		process.env.DATABASE_PATH = join(dir, 'test.db');
		process.env.SECRET_KEY = 'test-secret-key-that-is-long-enough-123';
		const { getAuth, ensureAdmin } = await import('./auth');
		const { getDb } = await import('./db/index');
		const s = await import('./setup');
		const auth = getAuth();
		const db = getDb();
		expect(s.needsSetup(db)).toBe(true);
		expect(await ensureAdmin(auth, 'env@x.io', 'twelve-chars-e')).toBe('created');
		expect(s.needsSetup(db)).toBe(false);
		expect(s.setupRedirect('/setup', false, s.needsSetup(db))).toBe('404');
		expect(await s.createFirstAdmin(auth, db, 'b@x.io', 'twelve-chars-2')).toBe('done');
		expect(db.$client.prepare('select count(*) c from user').get()).toEqual({ c: 1 });
	}, 30_000);
});
