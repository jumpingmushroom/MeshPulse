import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addonAccess, addonHandle, appRedirect } from './ingress';

const saved = process.env.SUPERVISOR_TOKEN;
beforeEach(() => { process.env.SUPERVISOR_TOKEN = 't'; });
afterEach(() => { if (saved === undefined) delete process.env.SUPERVISOR_TOKEN; else process.env.SUPERVISOR_TOKEN = saved; });

const H = { 'x-ingress-path': '/api/hassio_ingress/abc' };
const thrown = (f: () => unknown) => { try { f(); } catch (e) { return e as { status: number; location?: string }; } throw new Error('did not throw'); };

describe('addonAccess', () => {
	it('allows only the proxy, plus /api/health', () => {
		expect(addonAccess('/', '172.30.32.2')).toBe('allow');
		expect(addonAccess('/', '10.0.0.5')).toBe('forbid');
		expect(addonAccess('/api/health', '10.0.0.5')).toBe('allow');
	});
});

describe('appRedirect', () => {
	it('prefixes in add-on mode', () => {
		expect(thrown(() => appRedirect({ request: new Request('http://x/', { headers: H }) }, 303, '/login')).location).toBe('/api/hassio_ingress/abc/login');
	});
	it('does not prefix outside add-on mode', () => {
		delete process.env.SUPERVISOR_TOKEN;
		expect(thrown(() => appRedirect({ request: new Request('http://x/', { headers: H }) }, 303, '/login')).location).toBe('/login');
	});
	it('ignores a malformed prefix', () => {
		expect(thrown(() => appRedirect({ request: new Request('http://x/', { headers: { 'x-ingress-path': '//evil.com' } }) }, 303, '/login')).location).toBe('/login');
	});
});

const run = (path: string, addr: string, headers: Record<string, string> = {}) => {
	const event = { url: new URL('http://x' + path), request: new Request('http://x' + path, { headers }), locals: {} as Record<string, unknown>, getClientAddress: () => addr };
	const resolve = async () => new Response('ok');
	return { event, p: Promise.resolve().then(() => addonHandle({ event, resolve } as never)) };
};

describe('addonHandle', () => {
	it('403 for a spoofed forwarded header', async () => {
		await expect(run('/', '10.0.0.5', { 'x-forwarded-for': '172.30.32.2' }).p).rejects.toMatchObject({ status: 403 });
	});
	it('proxy gets the Home Assistant user', async () => {
		const { event, p } = run('/devices', '172.30.32.2');
		expect((await p).status).toBe(200);
		expect(event.locals.user).toEqual({ email: 'Home Assistant' });
	});
	it('/login and /setup redirect to the prefixed root', async () => {
		for (const path of ['/login', '/setup']) await expect(run(path, '172.30.32.2', H).p).rejects.toMatchObject({ status: 303, location: '/api/hassio_ingress/abc/' });
	});
	it('passes through outside add-on mode', async () => {
		delete process.env.SUPERVISOR_TOKEN;
		const { event, p } = run('/', '10.0.0.5');
		expect((await p).status).toBe(200);
		expect(event.locals.user).toBeUndefined();
	});
});
