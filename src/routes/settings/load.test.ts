import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../../lib/server/db/index';
import { createState } from '../../lib/server/types';
import { saveWifiConfig } from '../../lib/server/wifi/config';

const db = openDb(':memory:');
vi.mock('../../lib/server/runtime', () => ({ getRuntime: () => ({ db, state: createState(0), config: { tz: 'UTC', heartbeatUrl: '', secretKey: 'k' } }) }));

describe('settings page load', () => {
	it('never carries the Wi-Fi config or its encrypted password', async () => {
		saveWifiConfig(db, 'k', { url: 'https://x', site: 'default', user: 'u', password: 'hunter2' });
		const { load } = await import('./+page.server');
		const out = JSON.stringify(await (load as (e: unknown) => unknown)({}));
		expect(out).not.toContain('wifiConfig');
		expect(out).not.toContain('hunter2');
		const stored = JSON.stringify(db.$client.prepare("select value from settings where key='wifiConfig'").get());
		const blob = JSON.parse(JSON.parse(stored).value).password as string;
		expect(out).not.toContain(blob);
	});
});
