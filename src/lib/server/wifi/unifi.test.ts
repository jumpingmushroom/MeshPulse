import { describe, expect, it } from 'vitest';
import fixture from './fixtures/stat-device.json';
import { createUnifi, parseDevices, type Transport } from './unifi';

type Res = { status: number; headers?: Record<string, string | string[]>; body?: unknown };
type Call = Parameters<Transport>[0];

function fake(routes: Record<string, Res | Res[] | Error>) {
	const calls: Call[] = [];
	const t: Transport = async (req) => {
		calls.push(req);
		const path = new URL(req.url).pathname;
		let r = routes[`${req.method} ${path}`];
		if (Array.isArray(r)) r = r.length > 1 ? r.shift()! : r[0];
		if (!r) return { status: 404, headers: {}, body: '' };
		if (r instanceof Error) throw r;
		return { status: r.status, headers: r.headers ?? {}, body: JSON.stringify(r.body ?? {}) };
	};
	return { t, calls };
}

const login = { status: 200, headers: { 'set-cookie': ['TOKEN=abc; path=/; httponly'], 'x-csrf-token': 'csrf1' } };
const ok = { status: 200, body: { meta: { rc: 'ok' }, data: [] } };
const mk = (t: Transport, site = 'default') =>
	createUnifi({ url: 'https://ctl.local', site, user: 'u', password: 'p', transport: t });

describe('parseDevices', () => {
	it('parses the real fixture', () => {
		const aps = parseDevices(fixture);
		expect(aps).toHaveLength(6);
		expect(aps.map((a) => a.radio24?.channel)).toEqual([6, 1, 6, 11, 1, 11]);
		expect(aps.every((a) => typeof a.radio24?.cuTotal === 'number')).toBe(true);
		expect(aps[0]).toMatchObject({ name: 'dtc-wap-uhd-01', model: 'U7HD', mac: '18:e8:29:b7:48:43' });
		expect(aps[0].radio24?.width).toBe(20);
	});
	it('gives radio24 null when there is no ng radio', () => {
		const aps = parseDevices({ data: [{ type: 'uap', mac: 'a', name: 'x', model: 'm', radio_table: [{ radio: 'na', channel: 36 }] }] });
		expect(aps).toEqual([{ mac: 'a', name: 'x', model: 'm', radio24: null }]);
	});
	it('handles missing stats, string width and auto channel', () => {
		const [a, b] = parseDevices({
			data: [
				{ type: 'uap', mac: 'a', radio_table: [{ radio: 'ng', channel: 3, ht: '40' }] },
				{ type: 'uap', mac: 'b', radio_table: [{ radio: 'ng', channel: 'auto' }] }
			]
		});
		expect(a.radio24).toMatchObject({ channel: 3, width: 40, cuTotal: null, numSta: null });
		expect(b.radio24).toBeNull();
	});
	it('throws on garbage', () => {
		for (const g of [null, 'x', {}, { data: 1 }, { data: [1] }])
			expect(() => parseDevices(g)).toThrow('Unexpected stat/device response');
	});
});

describe('createUnifi', () => {
	it('UniFi OS: login, csrf, proxy path', async () => {
		const { t, calls } = fake({
			'POST /api/auth/login': login,
			'GET /proxy/network/api/s/default/stat/device': ok
		});
		const u = mk(t);
		expect(await u.devices()).toEqual([]);
		expect(u.kind()).toBe('unifi-os');
		expect(calls[0].body).toContain('"username":"u"');
		expect(calls[1].headers['x-csrf-token']).toBe('csrf1');
		expect(calls[1].headers.cookie).toBe('TOKEN=abc');
		await u.devices();
		expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
	});
	it('Network App: falls back to /api/login and uses a custom site', async () => {
		const { t, calls } = fake({
			'POST /api/login': { status: 200, headers: { 'set-cookie': 'unifises=s1; Path=/' } },
			'GET /api/s/abc123/stat/device': {
				status: 200,
				body: { data: [{ type: 'udm', version: '9.0.1' }] }
			}
		});
		const u = mk(t, 'abc123');
		await u.devices();
		expect(u.kind()).toBe('network-app');
		expect(u.version()).toBe('9.0.1');
		expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
			'/api/auth/login',
			'/api/login',
			'/api/s/abc123/stat/device'
		]);
		expect(calls[2].headers.cookie).toBe('unifises=s1');
	});
	it('re-logins once on 401 then succeeds', async () => {
		const { t, calls } = fake({
			'POST /api/auth/login': login,
			'GET /proxy/network/api/s/default/stat/device': [{ status: 401 }, ok]
		});
		await mk(t).devices();
		expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
	});
	it('throws after a second 401', async () => {
		const { t, calls } = fake({
			'POST /api/auth/login': login,
			'GET /proxy/network/api/s/default/stat/device': { status: 401 }
		});
		await expect(mk(t).devices()).rejects.toThrow('Wrong user or password');
		expect(calls).toHaveLength(4);
	});
	it('wrong password', async () => {
		for (const status of [400, 401]) {
			const { t } = fake({ 'POST /api/auth/login': { status, body: { meta: { msg: 'api.err.Invalid' } } } });
			await expect(mk(t).devices()).rejects.toThrow('Wrong user or password');
		}
	});
	it('MFA', async () => {
		const { t } = fake({ 'POST /api/auth/login': { status: 499, body: { code: 'MFA_AUTH_REQUIRED' } } });
		await expect(mk(t).devices()).rejects.toThrow('This account uses MFA — create a local account without MFA');
		const n = fake({
			'POST /api/login': { status: 400, body: { meta: { msg: 'api.err.Ubic2faTokenRequired' } } }
		});
		await expect(mk(n.t).devices()).rejects.toThrow('This account uses MFA');
	});
	it('unknown site', async () => {
		for (const r of [
			{ status: 400, body: {} },
			{ status: 200, body: { meta: { rc: 'error', msg: 'api.err.NoSiteContext' }, data: [] } }
		]) {
			const { t } = fake({ 'POST /api/auth/login': login, 'GET /proxy/network/api/s/nope/stat/device': r });
			await expect(mk(t, 'nope').devices()).rejects.toThrow('Unknown site "nope"');
		}
	});
	it('unreachable', async () => {
		const { t } = fake({ 'POST /api/auth/login': new Error('ECONNREFUSED') });
		await expect(mk(t).devices()).rejects.toThrow('Controller not reachable: ECONNREFUSED');
	});
	it('unexpected response', async () => {
		const { t } = fake({
			'POST /api/auth/login': login,
			'GET /proxy/network/api/s/default/stat/device': { status: 200, body: { nope: 1 } }
		});
		await expect(mk(t).devices()).rejects.toThrow('Unexpected stat/device response');
	});
	it('logout posts to the right path and swallows errors', async () => {
		const { t, calls } = fake({
			'POST /api/auth/login': login,
			'GET /proxy/network/api/s/default/stat/device': ok,
			'POST /api/auth/logout': new Error('x')
		});
		const u = mk(t);
		await u.logout(); // not logged in: no request
		expect(calls).toHaveLength(0);
		await u.devices();
		await u.logout();
		expect(calls.at(-1)!.url).toContain('/api/auth/logout');
	});
});
