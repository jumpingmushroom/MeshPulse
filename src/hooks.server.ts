import { redirect } from '@sveltejs/kit';
import { sequence, type Handle, type ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { getAuth } from './lib/server/auth';
import { startRuntime } from './lib/server/runtime';

export const init: ServerInit = async () => {
	if (!building) startRuntime();
};

const betterAuthHandle: Handle = async ({ event, resolve }) => {
	const auth = getAuth();
	const session = await auth.api.getSession({ headers: event.request.headers });
	event.locals.user = session?.user ?? null;
	event.locals.session = session?.session ?? null;
	return svelteKitHandler({ event, resolve, auth, building });
};

const PUBLIC = (path: string) => path === '/login' || path === '/api/health' || path.startsWith('/api/auth/');

const guard: Handle = ({ event, resolve }) => {
	if (!event.locals.user && !PUBLIC(event.url.pathname)) redirect(303, '/login');
	return resolve(event);
};

export const handle = sequence(betterAuthHandle, guard);
