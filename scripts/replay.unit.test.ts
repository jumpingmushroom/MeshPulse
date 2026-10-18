import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MqttMsg } from '../src/lib/server/types';
import { formatReport, replay } from './replay';

const MIN = 60_000;
const fixture = readFileSync('tests/fixtures/startup.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l) as MqttMsg);
const t0 = fixture[0].ts;
const msg = (min: number, topic: string, payload: unknown, retain = false): MqttMsg => ({ ts: t0 + min * MIN, topic, payload, retain });

describe('replay', () => {
	it('replays a fixture into issues and notifications', () => {
		const r = replay([
			...fixture,
			msg(10, 'zigbee2mqtt/living/lamp/availability', { state: 'offline' }),
			msg(13, 'zigbee2mqtt/living/lamp/availability', '{"state":"online"}'),
			msg(30, 'zigbee2mqtt/bridge/state', { state: 'online' })
		]);
		const lamp = r.issues.filter((i) => i.rule === 'device.offline' && i.name === 'living/lamp');
		expect(lamp).toHaveLength(1);
		expect(lamp[0].resolvedAt).not.toBeNull();
		expect(r.notifications.filter((n) => n.name === 'living/lamp').map((n) => n.kind)).toEqual(['open', 'resolved']);
		expect(formatReport(r, 'UTC')).toContain('device.offline');
	});

	it('ignores retained-only captures for liveness', () => {
		const r = replay(fixture.map((m) => ({ ...m, retain: true })).concat(msg(3, 'zigbee2mqtt/bridge/state', { state: 'online' }, true)));
		expect(r.issues.filter((i) => i.rule === 'bridge.offline' && i.severity === 'critical')).toEqual([]);
	});

	it('returns an empty report for empty input', () => {
		expect(replay([])).toMatchObject({ messages: 0, issues: [], notifications: [] });
	});
});
