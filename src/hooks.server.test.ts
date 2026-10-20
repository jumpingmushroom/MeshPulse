import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn(async () => null);
// real sequence() needs SvelteKit's request store; same chaining semantics
vi.mock('@sveltejs/kit/hooks', () => ({
	sequence: (...hs: Array<(i: { event: unknown; resolve: (e: unknown) => unknown }) => unknown>) => ({ event, resolve }: { event: unknown; resolve: (e: unknown) => unknown }) =>
		hs.reduceRight<(e: unknown) => unknown>((next, h) => (e) => h({ event: e, resolve: next }), resolve)(event)
}));
vi.mock('$app/env', () => ({ building: false }));
vi.mock('./lib/server/auth', () => ({ getAuth: () => ({ api: { getSession } }) }));
vi.mock('better-auth/svelte-kit', () => ({ svelteKitHandler: ({ event, resolve }: { event: unknown; resolve: (e: unknown) => unknown }) => resolve(event) }));
vi.mock('./lib/server/db/index', () => ({ getDb: () => ({}) }));
vi.mock('./lib/server/setup', () => ({ needsSetup: () => false, setupRedirect: () => null }));
vi.mock('./lib/server/runtime', () => ({ startRuntime: () => {} }));

import { handle } from './hooks.server';

const saved = process.env.SUPERVISOR_TOKEN;
beforeEach(() => getSession.mockClear());
afterEach(() => { if (saved === undefined) delete process.env.SUPERVISOR_TOKEN; else process.env.SUPERVISOR_TOKEN = saved; });

const run = (addr: string, path = '/') => {
	const event = { url: new URL('http://x' + path), request: new Request('http://x' + path), locals: {} as Record<string, unknown>, getClientAddress: () => addr };
	const resolve = vi.fn(async () => new Response('ok'));
	return { event, resolve, p: Promise.resolve().then(() => handle({ event, resolve } as never)) };
};

describe('handle', () => {
	it('add-on: proxy reaches resolve as Home Assistant, Better Auth untouched', async () => {
		process.env.SUPERVISOR_TOKEN = 't';
		const { event, resolve, p } = run('172.30.32.2');
		expect((await p).status).toBe(200);
		expect(resolve).toHaveBeenCalledOnce();
		expect(event.locals.user).toEqual({ email: 'Home Assistant' });
		expect(getSession).not.toHaveBeenCalled();
	});
	it('add-on: other addresses get 403', async () => {
		process.env.SUPERVISOR_TOKEN = 't';
		await expect(run('10.0.0.5').p).rejects.toMatchObject({ status: 403 });
		expect(getSession).not.toHaveBeenCalled();
	});
	it('normal mode: unauthenticated / redirects to /login', async () => {
		delete process.env.SUPERVISOR_TOKEN;
		await expect(run('10.0.0.5').p).rejects.toMatchObject({ status: 303, location: '/login' });
		expect(getSession).toHaveBeenCalled();
	});
});
