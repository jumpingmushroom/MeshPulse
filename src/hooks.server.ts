import { error } from '@sveltejs/kit';
import { sequence, type Handle, type ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { applyAddonEnv } from './lib/server/addon';
import { getAuth } from './lib/server/auth';
import { appRedirect, addonHandle } from './lib/server/ingress';
import { getDb } from './lib/server/db/index';
import { startRuntime } from './lib/server/runtime';
import { needsSetup, setupRedirect } from './lib/server/setup';

export const init: ServerInit = async () => {
	if (building) return;
	const src = await applyAddonEnv();
	if (src) console.log(`add-on mode: mqtt from ${src}`);
	startRuntime();
};

const betterAuthHandle: Handle = async ({ event, resolve }) => {
	const auth = getAuth();
	const session = await auth.api.getSession({ headers: event.request.headers });
	event.locals.user = session?.user ?? null;
	event.locals.session = session?.session ?? null;
	return svelteKitHandler({ event, resolve, auth, building });
};

const PUBLIC = (path: string) => path === '/login' || path === '/setup' || path === '/api/health' || path.startsWith('/api/auth/');

const setupHandle: Handle = ({ event, resolve }) => {
	const r = setupRedirect(event.url.pathname, !!event.locals.user, needsSetup(getDb()));
	if (r === '/setup') appRedirect(event, 303, '/setup');
	if (r === '404') error(404);
	return resolve(event);
};

const guard: Handle = ({ event, resolve }) => {
	if (!event.locals.user && !PUBLIC(event.url.pathname)) appRedirect(event, 303, '/login');
	return resolve(event);
};

export const handle = sequence(addonHandle, betterAuthHandle, setupHandle, guard);
