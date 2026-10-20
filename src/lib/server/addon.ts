import { readFileSync } from 'node:fs';

export type AddonOptions = { z2m_base_topic: string; mqtt_url: string; mqtt_username: string; mqtt_password: string };
type Mqtt = { url: string; username: string; password: string } | null;

export const isAddon = (env: Record<string, string | undefined> = process.env): boolean => !!env.SUPERVISOR_TOKEN;

export function readAddonOptions(path = '/data/options.json'): AddonOptions {
	let o: Record<string, unknown> = {};
	try {
		const j = JSON.parse(readFileSync(path, 'utf8'));
		if (j && typeof j === 'object') o = j;
	} catch {
		// missing or invalid file: defaults
	}
	const s = (k: string, d = '') => (typeof o[k] === 'string' ? (o[k] as string) : d);
	return { z2m_base_topic: s('z2m_base_topic') || 'zigbee2mqtt', mqtt_url: s('mqtt_url'), mqtt_username: s('mqtt_username'), mqtt_password: s('mqtt_password') };
}

export async function supervisorMqtt(fetchFn: typeof fetch, token: string): Promise<Mqtt> {
	try {
		const r = await fetchFn('http://supervisor/services/mqtt', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
		if (!r.ok) return null;
		const b = (await r.json()) as { result?: string; data?: { host?: string; port?: number; ssl?: boolean; username?: string; password?: string } };
		const d = b.data;
		if (b.result !== 'ok' || !d?.host || !d.port) return null;
		return { url: `${d.ssl ? 'mqtts' : 'mqtt'}://${d.host}:${d.port}`, username: d.username ?? '', password: d.password ?? '' };
	} catch {
		return null;
	}
}

export function addonEnv(o: AddonOptions, mqtt: Mqtt): Record<string, string> {
	const env: Record<string, string> = { Z2M_BASE_TOPIC: o.z2m_base_topic, DATABASE_PATH: '/data/meshpulse.db' };
	const m = o.mqtt_url ? { url: o.mqtt_url, username: o.mqtt_username, password: o.mqtt_password } : mqtt;
	if (m) {
		env.MQTT_URL = m.url;
		if (m.username) env.MQTT_USERNAME = m.username;
		if (m.password) env.MQTT_PASSWORD = m.password;
	}
	return env;
}

/** Merge the add-on overlay into process.env before any loadConfig(); null outside add-on mode. */
export async function applyAddonEnv(): Promise<'options' | 'service' | 'none' | null> {
	if (!isAddon()) return null;
	const o = readAddonOptions();
	const mqtt = o.mqtt_url ? null : await supervisorMqtt(fetch, process.env.SUPERVISOR_TOKEN!);
	Object.assign(process.env, addonEnv(o, mqtt));
	return o.mqtt_url ? 'options' : mqtt ? 'service' : 'none';
}
