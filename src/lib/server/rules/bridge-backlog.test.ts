import { describe, expect, it } from 'vitest';
import { ctx, MIN, NOW } from '../../../../tests/helpers/ctx';
import { bridgeBacklog } from './bridge-backlog';
import { issueKey } from './index';

const with_ = (queued: (number | null)[], open = false) => {
	const c = ctx();
	c.health = queued.map((q, i) => ({ ts: NOW - (queued.length - i) * 5 * MIN, queued: q }));
	if (open) c.open.add(issueKey('bridge.mqtt_backlog', null));
	return c;
};

describe('bridge.mqtt_backlog', () => {
	it('51 then 51: warning', () => {
		expect(bridgeBacklog(with_([51, 51]))).toEqual([{
			rule: 'bridge.mqtt_backlog', ieee: null, severity: 'warning',
			summary: 'Zigbee2MQTT has 51 messages queued for MQTT',
			action: 'Zigbee2MQTT is falling behind publishing to MQTT — check the broker and the Zigbee2MQTT host',
			evidence: { queued: 51, previous: 51, high: 50, clearBelow: 10 }
		}]);
	});

	it('51 then 40, a single sample, or no queue value: nothing', () => {
		expect(bridgeBacklog(with_([51, 40]))).toEqual([]);
		expect(bridgeBacklog(with_([51]))).toEqual([]);
		expect(bridgeBacklog(with_([null, null]))).toEqual([]);
		expect(bridgeBacklog(with_([]))).toEqual([]);
	});

	it('when open, holds at 10 and stops below', () => {
		expect(bridgeBacklog(with_([51, 10], true))).toHaveLength(1);
		expect(bridgeBacklog(with_([51, 9], true))).toEqual([]);
	});
});
