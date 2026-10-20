import { isAddon } from '../addon';
import { ChannelError, SEVERITY_LABEL, type Channel, type Message } from './channel';

export type HaTarget = { base: string; token: string };

/** Standalone: the configured URL and token. Add-on mode without a URL: Home Assistant through the Supervisor proxy. */
export function haTarget(config: Record<string, unknown>): HaTarget | null {
	const url = typeof config.url === 'string' ? config.url.replace(/\/+$/, '') : '';
	if (url) return typeof config.token === 'string' && config.token ? { base: url, token: config.token } : null;
	const sup = process.env.SUPERVISOR_TOKEN;
	return isAddon() && sup ? { base: 'http://supervisor/core', token: sup } : null;
}

/** The notify service call body. `link` is used when the message has no URL (add-on: the sidebar panel). */
export function toHaPayload(m: Message, link?: string) {
	const label = m.kind === 'digest' ? 'Weekly digest' : m.severity === 'resolved' ? 'Resolved' : SEVERITY_LABEL[m.severity];
	const lines = [m.summary, ...(m.action ? [`→ ${m.action}`] : []), ...m.fields.map((f) => `${f.name}: ${f.value}`)];
	const url = m.url ?? link;
	return {
		title: `MeshPulse · ${label}`,
		message: lines.join('\n'),
		data: {
			// same tag for an issue's messages: "resolved" replaces the open notification on the phone
			...(m.tag ? { tag: m.tag } : {}),
			group: 'meshpulse',
			...(url ? { url, clickAction: url } : {}), // url: iOS, clickAction: Android
			...(m.severity === 'critical' ? { priority: 'high', ttl: 0, push: { 'interruption-level': 'time-sensitive' } } : {})
		}
	};
}

async function call(t: HaTarget, path: string, fetchFn: typeof fetch, body?: unknown): Promise<Response> {
	const res = await fetchFn(`${t.base}/api/${path}`, {
		signal: AbortSignal.timeout(10_000),
		method: body === undefined ? 'GET' : 'POST',
		headers: { authorization: `Bearer ${t.token}`, 'content-type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	if (res.status === 401 || res.status === 403) throw new ChannelError(`Home Assistant refused the token (HTTP ${res.status})`);
	if (!res.ok) throw new ChannelError(`Home Assistant: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`.trim());
	return res;
}

/** Notify service names (without the `notify.` prefix), phones (`mobile_app_…`) first. */
export async function listNotifyServices(t: HaTarget, fetchFn: typeof fetch = fetch): Promise<string[]> {
	const domains = (await (await call(t, 'services', fetchFn)).json()) as { domain: string; services: Record<string, unknown> }[];
	const names = Object.keys(domains.find((d) => d.domain === 'notify')?.services ?? {});
	const phone = (n: string) => (n.startsWith('mobile_app_') ? 0 : 1);
	return names.sort((a, b) => phone(a) - phone(b) || a.localeCompare(b));
}

// shortcut: the add-on's own sidebar panel, looked up once per process; null when unknown (no link then)
let panel: Promise<string | undefined> | undefined;
function addonPanel(fetchFn: typeof fetch): Promise<string | undefined> {
	if (!isAddon() || !process.env.SUPERVISOR_TOKEN) return Promise.resolve(undefined);
	panel ??= fetchFn('http://supervisor/addons/self/info', { signal: AbortSignal.timeout(5000), headers: { authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}` } })
		.then(async (r) => (r.ok ? ((await r.json()) as { data?: { slug?: string } }).data?.slug : undefined))
		.then((slug) => (slug && /^[\w-]+$/.test(slug) ? `/hassio/ingress/${slug}` : undefined))
		.catch(() => undefined);
	return panel;
}

export const homeassistant: Channel = {
	kind: 'homeassistant',
	async send(config, message, fetchFn = fetch) {
		const t = haTarget(config);
		if (!t) throw new ChannelError('Home Assistant is not configured');
		const services = Array.isArray(config.services) ? config.services.map(String) : [];
		if (!services.length) throw new ChannelError('No notify service selected');
		const payload = toHaPayload(message, message.url ? undefined : await addonPanel(fetchFn));
		// a retry re-sends to every service; the shared tag makes the phone replace, not duplicate
		for (const s of services) await call(t, `services/notify/${encodeURIComponent(s)}`, fetchFn, payload);
	}
};

/** Settings form. Standalone needs a URL and a token (an empty token keeps the stored one); add-on mode needs neither. */
export function parseHomeAssistantForm(form: FormData, hasStoredToken: boolean, addon: boolean):
	{ error: string } | { url: string | undefined; token: string | undefined; services: string[] } {
	const url = String(form.get('url') ?? '').trim().replace(/\/+$/, '');
	const token = String(form.get('token') ?? '').trim();
	const services = form.getAll('services').map(String);
	if (services.some((s) => !/^[a-z0-9_]{1,100}$/.test(s))) return { error: 'Unknown notify service name.' };
	if (addon && !url) return { url: undefined, token: undefined, services };
	if (!/^https?:\/\/\S+$/.test(url)) return { error: 'The Home Assistant URL must start with http:// or https://' };
	if (!token && !hasStoredToken) return { error: 'Enter a long-lived access token.' };
	return { url, token: token || undefined, services };
}

/** A stored token may be reused only for the same Home Assistant origin it was saved with: it must never go to another host. */
export function haTokenKept(cfg: Record<string, unknown> | null | undefined, url: string): boolean {
	const origin = (u: string) => { try { return new URL(u).origin; } catch { return ''; } };
	return !!cfg?.token && typeof cfg.url === 'string' && !!url && origin(cfg.url) === origin(url);
}
