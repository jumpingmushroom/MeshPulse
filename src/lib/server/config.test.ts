import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, resolveSecretKey } from './config';

const tmp = () => mkdtempSync(join(tmpdir(), 'mp-cfg-'));

describe('loadConfig', () => {
	it('applies defaults', () => {
		const c = loadConfig({ SECRET_KEY: 'x' });
		expect(c.baseTopic).toBe('zigbee2mqtt');
		expect(c.databasePath).toBe('/data/meshpulse.db');
		expect(c.tz).toBe('Europe/Oslo');
		expect(c.mqttUrl).toBe('mqtt://mosquitto:1883');
	});

	it('falls back to Europe/Oslo for an invalid TZ', () => {
		expect(loadConfig({ SECRET_KEY: 'x', TZ: 'Mars/Olympus' }).tz).toBe('Europe/Oslo');
		expect(loadConfig({ SECRET_KEY: 'x', TZ: 'UTC' }).tz).toBe('UTC');
	});

	it('does not require SECRET_KEY', () => {
		expect(loadConfig({ DATABASE_PATH: ':memory:' }).secretSource).toBe('memory');
	});
});

describe('resolveSecretKey', () => {
	it('env key wins and writes no file', () => {
		const dir = tmp();
		expect(resolveSecretKey('x', join(dir, 'meshpulse.db'))).toEqual({ key: 'x', source: 'env' });
		expect(existsSync(join(dir, 'secret.key'))).toBe(false);
	});

	it('generates, saves with mode 0600 and reuses', () => {
		const dir = tmp();
		const db = join(dir, 'meshpulse.db');
		const file = join(dir, 'secret.key');
		const a = resolveSecretKey(undefined, db);
		expect(a.source).toBe('generated');
		expect(Buffer.from(a.key, 'base64').length).toBe(32);
		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(resolveSecretKey(undefined, db)).toEqual({ key: a.key, source: 'file' });
	});

	it('blank file is regenerated', () => {
		const dir = tmp();
		const file = join(dir, 'secret.key');
		writeFileSync(file, '  \n');
		const r = resolveSecretKey(undefined, join(dir, 'meshpulse.db'));
		expect(r.source).toBe('generated');
		expect(r.key.length).toBeGreaterThan(0);
		expect(readFileSync(file, 'utf8')).toBe(r.key);
	});

	it('memory database keeps the key in memory', () => {
		expect(resolveSecretKey(undefined, ':memory:').source).toBe('memory');
		expect(existsSync(join(process.cwd(), 'secret.key'))).toBe(false);
	});

	it.skipIf(process.getuid?.() === 0)('unwritable dir names the path', () => {
		const dir = tmp();
		chmodSync(dir, 0o500);
		expect(() => resolveSecretKey(undefined, join(dir, 'meshpulse.db'))).toThrow(/secret\.key/);
	});
});
