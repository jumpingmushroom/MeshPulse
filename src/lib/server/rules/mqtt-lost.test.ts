import { describe, expect, it } from 'vitest';
import { ctx, NOW } from '../../../../tests/helpers/ctx';
import { mqttLost } from './mqtt-lost';

const down = (ago: number) => {
	const c = ctx();
	c.state.monitor.connected = false;
	c.state.monitor.downSince = NOW - ago;
	return c;
};

describe('monitor.mqtt_lost', () => {
	it('is critical when the broker has been down 61 s', () => {
		const [f] = mqttLost(down(61_000));
		expect(f).toMatchObject({ rule: 'monitor.mqtt_lost', ieee: null, severity: 'critical' });
	});

	it('is nothing at 59 s or when connected', () => {
		expect(mqttLost(down(59_000))).toEqual([]);
		const c = down(600_000);
		c.state.monitor.connected = true;
		expect(mqttLost(c)).toEqual([]);
	});
});
