import { afterEach, describe, expect, it } from 'vitest';
import type { Message } from './channel';
import { haTarget, haTokenKept, homeassistant, listNotifyServices, parseHomeAssistantForm, toHaPayload } from './homeassistant';

const msg = (o: Partial<Message> = {}): Message => ({ severity: 'warning', kind: 'open', title: 'Warning: Battery low in Lock', summary: 'Battery low in Lock',
	action: 'Replace the battery', fields: [], url: 'https://mp.example/issues/7', tag: 'meshpulse-issue-7', ...o });
const calls: { url: string; init: RequestInit }[] = [];
const fake = (status = 200, body: unknown = []) => (async (url: string | URL | Request, init?: RequestInit) => {
	calls.push({ url: String(url), init: init ?? {} });
	return new Response(JSON.stringify(body), { status });
}) as typeof fetch;
afterEach(() => { calls.length = 0; delete process.env.SUPERVISOR_TOKEN; });

describe('haTarget', () => {
	it('standalone uses the configured URL and token', () => {
		expect(haTarget({ url: 'https://ha.example:8123/', token: 't' })).toEqual({ base: 'https://ha.example:8123', token: 't' });
	});
	it('add-on mode without a URL goes through the Supervisor proxy', () => {
		process.env.SUPERVISOR_TOKEN = 'sup';
		expect(haTarget({})).toEqual({ base: 'http://supervisor/core', token: 'sup' });
	});
	it('nothing configured outside add-on mode is null', () => expect(haTarget({})).toBeNull());
});

describe('toHaPayload', () => {
	it('title, text with the action, tag and link for both phone platforms', () => {
		expect(toHaPayload(msg())).toEqual({ title: 'MeshPulse · Warning', message: 'Battery low in Lock\n→ Replace the battery',
			data: { tag: 'meshpulse-issue-7', group: 'meshpulse', url: 'https://mp.example/issues/7', clickAction: 'https://mp.example/issues/7' } });
	});
	it('critical is high priority and time-sensitive', () => {
		expect(toHaPayload(msg({ severity: 'critical' })).data).toMatchObject({ priority: 'high', ttl: 0, push: { 'interruption-level': 'time-sensitive' } });
	});
	it('resolved replaces the open one (same tag), no link fallback needed', () => {
		const p = toHaPayload(msg({ severity: 'resolved', kind: 'resolved', title: 'Resolved: Battery low in Lock', action: undefined, url: undefined }), '/hassio/ingress/x_meshpulse');
		expect(p).toMatchObject({ title: 'MeshPulse · Resolved', message: 'Battery low in Lock', data: { tag: 'meshpulse-issue-7', url: '/hassio/ingress/x_meshpulse' } });
	});
	it('digest fields become lines', () => {
		expect(toHaPayload(msg({ kind: 'digest', severity: 'info', title: 'Weekly digest', fields: [{ name: 'Health score', value: '85 now' }], tag: undefined, url: undefined })).message)
			.toBe('Battery low in Lock\n→ Replace the battery\nHealth score: 85 now');
	});
});

describe('send', () => {
	it('posts to every selected notify service with the bearer token', async () => {
		await homeassistant.send({ url: 'https://ha.example', token: 'tok', services: ['mobile_app_a', 'mobile_app_b'] }, msg(), fake());
		expect(calls.map((c) => c.url)).toEqual(['https://ha.example/api/services/notify/mobile_app_a', 'https://ha.example/api/services/notify/mobile_app_b']);
		expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer tok');
		expect(JSON.parse(String(calls[0].init.body)).data.tag).toBe('meshpulse-issue-7');
	});
	it('a refused token says so', async () => {
		await expect(homeassistant.send({ url: 'https://ha.example', token: 'bad', services: ['mobile_app_a'] }, msg(), fake(401))).rejects.toThrow('Home Assistant refused the token');
	});
	it('one dead service does not stop the others; the error names it', async () => {
		const f = (async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), init: init ?? {} });
			return new Response('{}', { status: String(url).endsWith('/old_phone') ? 404 : 200 });
		}) as typeof fetch;
		await expect(homeassistant.send({ url: 'https://ha.example', token: 't', services: ['old_phone', 'mobile_app_new'] }, msg(), f)).rejects.toThrow('old_phone');
		expect(calls.map((c) => c.url.split('/').pop())).toEqual(['old_phone', 'mobile_app_new']);
	});
	it('redirects are refused, never followed with the token', async () => {
		await homeassistant.send({ url: 'https://ha.example', token: 't', services: ['a'] }, msg(), fake());
		expect(calls[0].init.redirect).toBe('error');
	});
	it('add-on mode: a 401 means the add-on lacks API access', async () => {
		process.env.SUPERVISOR_TOKEN = 'sup';
		await expect(homeassistant.send({ services: ['a'] }, msg(), fake(401))).rejects.toThrow('no access to the Home Assistant API');
	});
	it('no services selected is an error, not a silent drop', async () => {
		await expect(homeassistant.send({ url: 'https://ha.example', token: 't', services: [] }, msg(), fake())).rejects.toThrow('No notify service selected');
	});
});

describe('listNotifyServices', () => {
	it('lists notify services, phones first', async () => {
		const body = [{ domain: 'light', services: { turn_on: {} } }, { domain: 'notify', services: { persistent_notification: {}, mobile_app_pixel: {}, notify: {}, mobile_app_iphone: {} } }];
		expect(await listNotifyServices({ base: 'https://ha.example', token: 't' }, fake(200, body))).toEqual(['mobile_app_iphone', 'mobile_app_pixel', 'notify', 'persistent_notification']);
		expect(calls[0].url).toBe('https://ha.example/api/services');
	});
});

describe('parseHomeAssistantForm', () => {
	const form = (o: Record<string, string | string[]>) => {
		const f = new FormData();
		for (const [k, v] of Object.entries(o)) for (const x of [v].flat()) f.append(k, x);
		return f;
	};
	it('standalone needs an http(s) URL and a token (or a stored one)', () => {
		expect(parseHomeAssistantForm(form({ url: 'ha.local', token: 't' }), false, false)).toEqual({ error: 'The Home Assistant URL must start with http:// or https://' });
		expect(parseHomeAssistantForm(form({ url: 'http://ha.local:8123/' }), false, false)).toEqual({ error: 'Enter a long-lived access token.' });
		expect(parseHomeAssistantForm(form({ url: 'http://ha.local:8123/', services: ['mobile_app_a'] }), true, false)).toEqual({ url: 'http://ha.local:8123', token: undefined, services: ['mobile_app_a'] });
	});
	it('add-on mode needs neither; service names are validated', () => {
		expect(parseHomeAssistantForm(form({ services: ['mobile_app_a', 'notify'] }), false, true)).toEqual({ url: undefined, token: undefined, services: ['mobile_app_a', 'notify'] });
		expect(parseHomeAssistantForm(form({ services: ['../x'] }), false, true)).toEqual({ error: 'Unknown notify service name.' });
	});
});

describe('haTokenKept', () => {
	const cfg = { url: 'https://ha.example:8123', token: 'enc' };
	it('same origin keeps the stored token', () => expect(haTokenKept(cfg, 'https://ha.example:8123/')).toBe(true));
	it('another host, port or scheme never gets it', () => {
		for (const u of ['https://evil.example:8123', 'https://ha.example:8124', 'http://ha.example:8123', '', 'not a url']) expect(haTokenKept(cfg, u), u).toBe(false);
	});
	it('nothing stored, nothing kept', () => expect(haTokenKept({ url: 'https://ha.example:8123' }, 'https://ha.example:8123')).toBe(false));
});
