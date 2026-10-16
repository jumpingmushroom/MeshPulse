import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
	it('applies defaults', () => {
		const c = loadConfig({ SECRET_KEY: 'x' });
		expect(c.baseTopic).toBe('zigbee2mqtt');
		expect(c.databasePath).toBe('/data/meshpulse.db');
		expect(c.tz).toBe('Europe/Oslo');
		expect(c.mqttUrl).toBe('mqtt://mosquitto:1883');
	});

	it('requires SECRET_KEY', () => {
		expect(() => loadConfig({})).toThrow('SECRET_KEY is required');
	});
});
