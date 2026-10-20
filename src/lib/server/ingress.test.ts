import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addonAccess, assertAddonEnv, addonHandle, appRedirect, prefixResponse } from './ingress';

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

describe('assertAddonEnv', () => {
	it('refuses ADDRESS_HEADER in add-on mode only', () => {
		expect(() => assertAddonEnv({ SUPERVISOR_TOKEN: 't', ADDRESS_HEADER: 'X-Forwarded-For' })).toThrow('ADDRESS_HEADER');
		expect(() => assertAddonEnv({ SUPERVISOR_TOKEN: 't' })).not.toThrow();
		expect(() => assertAddonEnv({ ADDRESS_HEADER: 'X-Forwarded-For' })).not.toThrow();
	});
});

describe('prefixResponse', () => {
	const P = '/api/hassio_ingress/abc';
	const act = (body: object) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'content-length': '99' } });
	it('prefixes the action location, keeps the rest', async () => {
		const r = await prefixResponse(act({ type: 'success', status: 204, location: '/devices/x?range=24h' }), P, true);
		expect(await r.json()).toEqual({ type: 'success', status: 204, location: P + '/devices/x?range=24h' });
	});
	it('does not prefix twice', async () => {
		const r = await prefixResponse(act({ type: 'redirect', status: 303, location: P + '/x' }), P, true);
		expect((await r.json()).location).toBe(P + '/x');
	});
	it('prefixes relative 3xx only', async () => {
		const loc = (l: string) => prefixResponse(new Response(null, { status: 308, headers: { location: l } }), P, false).then((r) => r.headers.get('location'));
		expect(await loc('/login')).toBe(P + '/login');
		expect(await loc('//evil.com')).toBe('//evil.com');
		expect(await loc('https://x')).toBe('https://x');
	});
	it('leaves non-action JSON and HTML alone', async () => {
		const j = act({ location: '/x' });
		expect(await (await prefixResponse(j, P, false)).json()).toEqual({ location: '/x' });
		const h = new Response('<p>', { headers: { 'content-type': 'text/html' } });
		expect(await (await prefixResponse(h, P, true)).text()).toBe('<p>');
	});
	it('addonHandle rewrites with a valid X-Ingress-Path only', async () => {
		const go = async (headers: Record<string, string>) => {
			const event = { url: new URL('http://x/d'), request: new Request('http://x/d', { method: 'POST', headers: { 'x-sveltekit-action': 'true', ...headers } }), locals: {}, getClientAddress: () => '172.30.32.2' };
			const resolve = async () => act({ type: 'success', status: 204, location: '/d' });
			return (await (await addonHandle({ event, resolve } as never)).json()).location;
		};
		expect(await go(H)).toBe(P + '/d');
		expect(await go({})).toBe('/d');
	});
});
