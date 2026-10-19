import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequester } from './request';

const base = 'zigbee2mqtt';
function setup() {
	const sent: { topic: string; body: any }[] = [];
	const publish = async (topic: string, body: string) => void sent.push({ topic, body: JSON.parse(body) });
	const r = createRequester(publish, base);
	const reply = (name: string, o: object) =>
		r.onMessage(`${base}/bridge/response/${name}`, Buffer.from(JSON.stringify(o)));
	return { sent, r, reply };
}

describe('requester', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('publishes to the request topic with a transaction and resolves with data', async () => {
		const { sent, r, reply } = setup();
		const p = r.request('networkmap', { type: 'raw', routes: false }, 1000);
		await vi.advanceTimersByTimeAsync(0);
		expect(sent[0].topic).toBe('zigbee2mqtt/bridge/request/networkmap');
		expect(typeof sent[0].body.transaction).toBe('string');
		reply('networkmap', { data: { x: 1 }, status: 'ok', transaction: 'other' });
		expect(r.busy('networkmap')).toBe(true);
		reply('networkmap', { data: { x: 2 }, status: 'ok', transaction: sent[0].body.transaction });
		await expect(p).resolves.toEqual({ x: 2 });
	});

	it('rejects timeout, then ignores a late response', async () => {
		const { sent, r, reply } = setup();
		const p = r.request('coordinator_check', {}, 1000);
		const assertion = expect(p).rejects.toThrow('timeout');
		await vi.advanceTimersByTimeAsync(1000);
		await assertion;
		expect(() => reply('coordinator_check', { data: {}, status: 'ok', transaction: sent[0].body.transaction })).not.toThrow();
	});

	it('rejects with the response error', async () => {
		const { sent, r, reply } = setup();
		const p = r.request('networkmap', {}, 1000);
		await vi.advanceTimersByTimeAsync(0);
		reply('networkmap', { status: 'error', error: 'boom', transaction: sent[0].body.transaction });
		await expect(p).rejects.toThrow('boom');
	});

	it('throws on an unknown request before publishing', () => {
		const { sent, r } = setup();
		expect(() => r.request('permit_join' as never, {}, 1000)).toThrow();
		expect(sent).toEqual([]);
	});

	it('tracks busy and maps publish refusal', async () => {
		const { r, sent, reply } = setup();
		expect(r.busy('networkmap')).toBe(false);
		const p = r.request('networkmap', {}, 1000);
		expect(r.busy('networkmap')).toBe(true);
		await vi.advanceTimersByTimeAsync(0);
		reply('networkmap', { data: {}, status: 'ok', transaction: sent[0].body.transaction });
		await p;
		expect(r.busy('networkmap')).toBe(false);

		const bad = createRequester(async () => { throw new Error('Not authorized'); }, base);
		await expect(bad.request('networkmap', {}, 1000)).rejects.toThrow('MQTT user needs publish on `zigbee2mqtt/bridge/request/#`');
		expect(bad.busy('networkmap')).toBe(false);
	});
});
