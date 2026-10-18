import { ChannelError, type Channel, type Message } from './channel';

const TYPES = { critical: 'failure', warning: 'warning', info: 'info', resolved: 'success' } as const;

export function toApprisePayload(m: Message) {
	const parts = [m.summary];
	if (m.action) parts.push(`**Suggested action:** ${m.action}`);
	if (m.fields.length) parts.push(m.fields.map((f) => `- **${f.name}:** ${f.value}`).join('\n'));
	if (m.url) parts.push(m.url);
	return { title: m.title, body: parts.join('\n\n'), type: TYPES[m.severity], format: 'markdown' as const } as
		{ title: string; body: string; type: (typeof TYPES)[keyof typeof TYPES]; format: 'markdown'; urls?: string };
}

export const apprise: Channel = {
	kind: 'apprise',
	async send(config, message, fetchFn = fetch) {
		const base = String(config.apiUrl).replace(/\/+$/, '');
		const key = config.key ? String(config.key) : '';
		const payload = toApprisePayload(message);
		if (!key) payload.urls = String(config.urls ?? '').split('\n').map((u) => u.trim()).filter(Boolean).join(',');
		const res = await fetchFn(key ? `${base}/notify/${encodeURIComponent(key)}` : `${base}/notify`, {
			signal: AbortSignal.timeout(10_000),
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (res.ok) return;
		if (res.status === 429) throw new ChannelError('HTTP 429', (Number(res.headers.get('retry-after')) || 5) * 1000);
		throw new ChannelError(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`.trim());
	}
};

/** Validates the settings form. `hasStoredUrls` lets an empty urls field keep the stored value (urls: undefined). */
export function parseAppriseForm(form: FormData, hasStoredUrls: boolean): { error: string } | { apiUrl: string; key?: string; urls?: string } {
	const apiUrl = String(form.get('apiUrl') ?? '').trim().replace(/\/+$/, '');
	const key = String(form.get('key') ?? '').trim();
	const urls = String(form.get('urls') ?? '').split('\n').map((u) => u.trim()).filter(Boolean).join('\n');
	if (!/^https?:\/\/\S+$/.test(apiUrl)) return { error: 'The Apprise API URL must start with http:// or https://' };
	if (key && !/^[A-Za-z0-9_-]{1,64}$/.test(key)) return { error: 'The key may only contain letters, digits, - and _ (max 64).' };
	if (key && urls) return { error: 'Use either a key or notification URLs, not both.' };
	if (!key && !urls && !hasStoredUrls) return { error: 'Enter a key or notification URLs.' };
	return key ? { apiUrl, key, urls: undefined } : { apiUrl, urls: urls || undefined };
}
