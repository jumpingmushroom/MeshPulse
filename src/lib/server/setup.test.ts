import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('$app/server', () => ({ getRequestEvent: () => undefined }));

const dir = mkdtempSync(join(tmpdir(), 'meshpulse-setup-'));
let auth: Awaited<ReturnType<typeof import('./auth').getAuth>>;
let db: ReturnType<typeof import('./db/index').getDb>;
let s: typeof import('./setup');

beforeAll(async () => {
	process.env.DATABASE_PATH = join(dir, 'test.db');
	process.env.SECRET_KEY = 'test-secret-key-that-is-long-enough-123';
	const a = await import('./auth');
	auth = a.getAuth();
	db = (await import('./db/index')).getDb();
	s = await import('./setup');
}, 30_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('setup', () => {
	it('needsSetup is true with no users and false after createFirstAdmin; concurrent submits create one user', async () => {
		expect(s.needsSetup(db)).toBe(true);
		const r = await Promise.all([s.createFirstAdmin(auth, db, 'a@x.io', 'twelve-chars-1'), s.createFirstAdmin(auth, db, 'b@x.io', 'twelve-chars-2')]);
		expect(r.sort()).toEqual(['created', 'done']);
		expect(db.$client.prepare('select count(*) c from user').get()).toEqual({ c: 1 });
		expect(s.needsSetup(db)).toBe(false);
	});

	it('the created admin can sign in', async () => {
		const res = await auth.api.signInEmail({ body: { email: 'a@x.io', password: 'twelve-chars-1' } });
		expect(res.token).toBeTruthy();
	});

	it('validateSetup', () => {
		expect(s.validateSetup('nope', 'twelve-chars-x', 'twelve-chars-x')?.field).toBe('email');
		expect(s.validateSetup('a@x.io', 'short', 'short')).toEqual({ field: 'password', message: 'Use at least 12 characters' });
		expect(s.validateSetup('a@x.io', 'twelve-chars-x', 'twelve-chars-y')).toEqual({ field: 'confirm', message: 'The passwords do not match' });
		expect(s.validateSetup('a@x.io', 'twelve-chars-x', 'twelve-chars-x')).toBeNull();
	});

	it('setupRedirect', () => {
		expect(s.setupRedirect('/', false, true)).toBe('/setup');
		expect(s.setupRedirect('/login', false, true)).toBe('/setup');
		expect(s.setupRedirect('/setup', false, true)).toBeNull();
		expect(s.setupRedirect('/api/health', false, true)).toBeNull();
		expect(s.setupRedirect('/api/auth/get-session', false, true)).toBeNull();
		expect(s.setupRedirect('/setup', false, false)).toBe('404');
		expect(s.setupRedirect('/setup', true, false)).toBe('404');
		expect(s.setupRedirect('/', true, false)).toBeNull();
	});
});
