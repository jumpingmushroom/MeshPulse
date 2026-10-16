import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDb } from './db/index';

let auth: ReturnType<typeof create> | undefined;

// Lazy so imports (builds, tests) never open the database.
function create() {
	return betterAuth({
		database: drizzleAdapter(getDb(), { provider: 'sqlite' }),
		emailAndPassword: { enabled: true, disableSignUp: true }
	});
}

export function getAuth() {
	return (auth ??= create());
}
