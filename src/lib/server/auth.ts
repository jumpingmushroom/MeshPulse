import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { loadConfig } from './config';
import { getDb } from './db/index';
import * as schema from './db/schema';

export type Auth = ReturnType<typeof create>;
let auth: Auth | undefined;

// Lazy so imports (builds, tests) never open the database.
function create() {
	const config = loadConfig();
	return betterAuth({
		database: drizzleAdapter(getDb(), { provider: 'sqlite', schema }),
		secret: config.secretKey,
		baseURL: config.publicUrl,
		// Better Auth defaults to Secure cookies in production, which browsers drop over plain http.
		advanced: { useSecureCookies: config.publicUrl?.startsWith('https:') ?? false },
		emailAndPassword: { enabled: true, disableSignUp: true },
		plugins: [sveltekitCookies(getRequestEvent)]
	});
}

export function getAuth(): Auth {
	return (auth ??= create());
}

/** Seeds the single admin account from env (sign-up is disabled). */
export async function ensureAdmin(auth: Auth, email?: string, password?: string): Promise<'created' | 'exists' | 'skipped'> {
	if (!email || !password) return 'skipped';
	const ctx = await auth.$context;
	// Single-admin app: any existing account (e.g. made via /setup) blocks seeding another.
	if ((await ctx.internalAdapter.listUsers(1)).length) return 'exists';
	await createAdmin(auth, email, password);
	return 'created';
}

/** The admin user plus its email/password credential. */
export async function createAdmin(auth: Auth, email: string, password: string): Promise<void> {
	const ctx = await auth.$context;
	const u = await ctx.internalAdapter.createUser({ email, name: 'Admin', emailVerified: true }, { method: 'admin' });
	await ctx.internalAdapter.linkAccount({ providerId: 'credential', accountId: u.id, userId: u.id, password: await ctx.password.hash(password) });
}
