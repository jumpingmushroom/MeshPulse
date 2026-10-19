import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../../lib/server/db/index';
import { createState } from '../../lib/server/types';
import { getWifiConfig, saveWifiConfig } from '../../lib/server/wifi/config';

const db = openDb(':memory:');
vi.mock('../../lib/server/runtime', () => ({ getRuntime: () => ({ db, state: createState(0), config: { tz: 'UTC', heartbeatUrl: '', secretKey: 'k' } }) }));
const created: { url: string; password: string }[] = [];
vi.mock('../../lib/server/wifi/unifi', () => ({
	createUnifi: (o: { url: string; password: string }) => {
		created.push(o);
		return { devices: async () => [], describe: () => 'ok', logout: async () => {} };
	}
}));

const saved = { url: 'https://192.168.1.1', site: 'default', user: 'u', password: 'hunter2' };
const post = (fields: Record<string, string>) => {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return { request: new Request('http://x', { method: 'POST', body }) } as never;
};
const run = async (name: 'saveWifi' | 'testWifi', fields: Record<string, string>) => {
	const { actions } = await import('./+page.server');
	return (actions[name] as unknown as (e: never) => Promise<{ status?: number; data?: { error?: string } }>)(post(fields));
};

beforeEach(() => {
	created.length = 0;
	saveWifiConfig(db, 'k', saved);
});

describe('stored Wi-Fi password reuse', () => {
	it('test reuses it for the same controller (scheme, host, port normalised)', async () => {
		await run('testWifi', { url: 'https://192.168.1.1:443', site: 'default', user: 'u' });
		expect(created).toEqual([expect.objectContaining({ password: 'hunter2' })]);
	});
	it('test refuses to send it to another URL or site', async () => {
		for (const f of [{ url: 'http://evil.example' }, { url: 'https://192.168.1.1:8443' }, { url: saved.url, site: 'other' }]) {
			const r = await run('testWifi', { site: 'default', user: 'u', ...f });
			expect(r.status).toBe(400);
			expect(r.data?.error).toBe('Enter the password for the new controller');
		}
		expect(created).toEqual([]);
	});
	it('save keeps the password for the same controller, rejects a new one without a password', async () => {
		expect((await run('saveWifi', { ...saved, password: '' })).status).toBeUndefined();
		expect(getWifiConfig(db, 'k')?.password).toBe('hunter2');
		const r = await run('saveWifi', { ...saved, url: 'http://evil.example', password: '' });
		expect(r.status).toBe(400);
		expect(r.data?.error).toBe('Enter the password for the new controller');
		expect(getWifiConfig(db, 'k')).toEqual(saved);
		expect((await run('saveWifi', { ...saved, url: 'http://new.example', password: 'pw2' })).status).toBeUndefined();
		expect(getWifiConfig(db, 'k')?.password).toBe('pw2');
	});
});
