import { count } from 'drizzle-orm';
import { createAdmin, type Auth } from './auth';
import type { Db } from './db/index';
import { user } from './db/schema';

let known = false; // once a user exists it never goes away, so stop querying

export function needsSetup(db: Db): boolean {
	if (known) return false;
	known = db.select({ n: count() }).from(user).get()!.n > 0;
	return !known;
}

export function validateSetup(email: string, password: string, confirm: string): { field: 'email' | 'password' | 'confirm'; message: string } | null {
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { field: 'email', message: 'Enter a valid email address' };
	if (password.length < 12) return { field: 'password', message: 'Use at least 12 characters' };
	if (password !== confirm) return { field: 'confirm', message: 'The passwords do not match' };
	return null;
}

let chain: Promise<unknown> = Promise.resolve();

/** Serialised so two simultaneous submits cannot both create an admin. */
export function createFirstAdmin(auth: Auth, db: Db, email: string, password: string): Promise<'created' | 'done'> {
	const run = chain.then(async () => {
		if (!needsSetup(db)) return 'done' as const;
		await createAdmin(auth, email, password);
		known = true;
		return 'created' as const;
	});
	chain = run.catch(() => undefined);
	return run;
}

export function setupRedirect(path: string, hasUser: boolean, setupNeeded: boolean): '/setup' | '404' | null {
	if (path === '/setup') return hasUser || !setupNeeded ? '404' : null;
	if (setupNeeded && path !== '/api/health' && !path.startsWith('/api/auth/')) return '/setup';
	return null;
}
