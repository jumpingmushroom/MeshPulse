import { describe, expect, it } from 'vitest';
import { ChannelError, type Message } from './channel';
import { apprise, parseAppriseForm, toApprisePayload } from './apprise';

const msg = (p: Partial<Message> = {}): Message => ({ severity: 'warning', kind: 'open', title: 'Warning: x', summary: 'It broke', fields: [], ...p });
const form = (o: Record<string, string>) => new Map(Object.entries(o)) as unknown as FormData;
function fakeFetch(status = 200, headers: Record<string, string> = {}) {
	const calls: { url: string; body: Record<string, unknown> }[] = [];
	const fn = (async (url: string, init: RequestInit) => {
		calls.push({ url, body: JSON.parse(String(init.body)) });
		return new Response('nope', { status, headers });
	}) as unknown as typeof fetch;
	return { calls, fn };
}

describe('apprise', () => {
	it('maps severities to apprise types', () => {
		const t = (severity: Message['severity']) => toApprisePayload(msg({ severity })).type;
		expect([t('critical'), t('warning'), t('info'), t('resolved')]).toEqual(['failure', 'warning', 'info', 'success']);
	});
	it('builds a markdown body', () => {
		const p = toApprisePayload(msg({ action: 'Fix it', fields: [{ name: 'LQI', value: '12' }], url: 'http://x/issues/1' }));
		expect(p).toMatchObject({ title: 'Warning: x', format: 'markdown' });
		expect(p.body).toBe('It broke\n\n**Suggested action:** Fix it\n\n- **LQI:** 12\n\nhttp://x/issues/1');
	});
	it('posts to /notify/<key> with a stored key', async () => {
		const f = fakeFetch();
		await apprise.send({ apiUrl: 'http://a:8000/', key: 'home', urls: 'ignored' }, msg(), f.fn);
		expect(f.calls[0].url).toBe('http://a:8000/notify/home');
		expect(f.calls[0].body.urls).toBeUndefined();
	});
	it('posts urls to /notify when no key', async () => {
		const f = fakeFetch();
		await apprise.send({ apiUrl: 'http://a:8000', urls: 'tgram://1:a/b\nmailto://u:p@h' }, msg(), f.fn);
		expect(f.calls[0].url).toBe('http://a:8000/notify');
		expect(f.calls[0].body.urls).toBe('tgram://1:a/b,mailto://u:p@h');
	});
	it('429 sets retryAfterMs; other non-2xx throw', async () => {
		await expect(apprise.send({ apiUrl: 'http://a', key: 'k' }, msg(), fakeFetch(429, { 'retry-after': '7' }).fn))
			.rejects.toMatchObject({ retryAfterMs: 7000 });
		const e = await apprise.send({ apiUrl: 'http://a', key: 'k' }, msg(), fakeFetch(424).fn).catch((x) => x);
		expect(e).toBeInstanceOf(ChannelError);
		expect(e.retryAfterMs).toBeUndefined();
	});
});

describe('parseAppriseForm', () => {
	it('rejects both key and urls', () => {
		expect(parseAppriseForm(form({ apiUrl: 'http://a', key: 'k', urls: 'tgram://x' }), false)).toHaveProperty('error');
	});
	it('rejects non-http apiUrl', () => {
		expect(parseAppriseForm(form({ apiUrl: 'ftp://a', key: 'k' }), false)).toHaveProperty('error');
	});
	it('rejects a bad key and neither key nor urls', () => {
		expect(parseAppriseForm(form({ apiUrl: 'http://a', key: 'a/b' }), false)).toHaveProperty('error');
		expect(parseAppriseForm(form({ apiUrl: 'http://a' }), false)).toHaveProperty('error');
	});
	it('accepts key, urls, and keeps stored urls when empty', () => {
		expect(parseAppriseForm(form({ apiUrl: 'http://a', key: 'home_1' }), false)).toEqual({ apiUrl: 'http://a', key: 'home_1', urls: undefined });
		expect(parseAppriseForm(form({ apiUrl: 'http://a', urls: ' tgram://x \n\n' }), false)).toEqual({ apiUrl: 'http://a', urls: 'tgram://x' });
		expect(parseAppriseForm(form({ apiUrl: 'http://a' }), true)).toEqual({ apiUrl: 'http://a', urls: undefined });
	});
});
