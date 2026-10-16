// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Auth } from './lib/server/auth';

type Session = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;

declare global {
	namespace App {
		interface Locals {
			user: Session['user'] | null;
			session: Session['session'] | null;
		}
	}
}

export {};
