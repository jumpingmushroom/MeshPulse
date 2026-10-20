import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isAddon, readAddonOptions, supervisorMqtt, addonEnv } from './addon';

const DEF = { z2m_base_topic: 'zigbee2mqtt', mqtt_url: '', mqtt_username: '', mqtt_password: '' };

describe('addon', () => {
	it('detects add-on mode', () => {
		expect(isAddon({ SUPERVISOR_TOKEN: 'x' })).toBe(true);
		expect(isAddon({})).toBe(false);
	});
	it('reads options with defaults', () => {
		const d = mkdtempSync(join(tmpdir(), 'addon-'));
		expect(readAddonOptions(join(d, 'none.json'))).toEqual(DEF);
		writeFileSync(join(d, 'bad.json'), '{');
		expect(readAddonOptions(join(d, 'bad.json'))).toEqual(DEF);
		writeFileSync(join(d, 'empty.json'), '{}');
		expect(readAddonOptions(join(d, 'empty.json'))).toEqual(DEF);
		writeFileSync(join(d, 'ok.json'), JSON.stringify({ mqtt_url: 'mqtt://b:1', z2m_base_topic: 'z' }));
		expect(readAddonOptions(join(d, 'ok.json'))).toMatchObject({ mqtt_url: 'mqtt://b:1', z2m_base_topic: 'z' });
	});
	describe('supervisorMqtt', () => {
		const reply = (data: object, status = 200) => (async () => new Response(JSON.stringify({ result: 'ok', data }), { status })) as unknown as typeof fetch;
		it('builds the url and sends the token', async () => {
			let auth = '';
			const f = (async (_u: unknown, init?: RequestInit) => { auth = (init!.headers as Record<string, string>).Authorization; return reply({ host: 'core-mosquitto', port: 1883, ssl: false, username: 'addons', password: 'p' })(_u as string); }) as unknown as typeof fetch;
			expect(await supervisorMqtt(f, 'tok')).toEqual({ url: 'mqtt://core-mosquitto:1883', username: 'addons', password: 'p' });
			expect(auth).toBe('Bearer tok');
			expect((await supervisorMqtt(reply({ host: 'core-mosquitto', port: 8883, ssl: true, username: 'a', password: 'p' }), 't'))!.url).toBe('mqtts://core-mosquitto:8883');
		});
		it('passes an abort signal', async () => {
			let sig: AbortSignal | undefined;
			await supervisorMqtt((async (_u: unknown, init?: RequestInit) => { sig = init!.signal as AbortSignal; return new Response('{}', { status: 400 }); }) as unknown as typeof fetch, 't');
			expect(sig).toBeInstanceOf(AbortSignal);
		});
		it('returns null on failure', async () => {
			expect(await supervisorMqtt(reply({}, 400), 't')).toBeNull();
			expect(await supervisorMqtt((async () => new Response(JSON.stringify({ result: 'error' }))) as unknown as typeof fetch, 't')).toBeNull();
			expect(await supervisorMqtt(reply({ port: 1883 }), 't')).toBeNull();
			expect(await supervisorMqtt((async () => { throw new DOMException('t', 'AbortError'); }) as unknown as typeof fetch, 't')).toBeNull();
			expect(await supervisorMqtt((async () => { throw new Error('x'); }) as unknown as typeof fetch, 't')).toBeNull();
		});
	});
	describe('addonEnv', () => {
		const svc = { url: 'mqtt://core-mosquitto:1883', username: 'addons', password: 'p' };
		it('option url wins with its own credentials', () => {
			const e = addonEnv({ ...DEF, mqtt_url: 'mqtt://b:1', mqtt_username: 'u', mqtt_password: 'w' }, svc);
			expect(e).toMatchObject({ MQTT_URL: 'mqtt://b:1', MQTT_USERNAME: 'u', MQTT_PASSWORD: 'w', Z2M_BASE_TOPIC: 'zigbee2mqtt', DATABASE_PATH: '/data/meshpulse.db' });
		});
		it('uses the service when no option url, ignoring option credentials', () => {
			const e = addonEnv({ ...DEF, mqtt_username: 'u', mqtt_password: 'w' }, svc);
			expect(e).toMatchObject({ MQTT_URL: svc.url, MQTT_USERNAME: 'addons', MQTT_PASSWORD: 'p' });
		});
		it('sets no MQTT keys with neither', () => {
			const e = addonEnv(DEF, null);
			expect(Object.keys(e).filter((k) => k.startsWith('MQTT_'))).toEqual([]);
			expect(e.DATABASE_PATH).toBe('/data/meshpulse.db');
		});
	});
});
