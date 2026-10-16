import { describe, expect, it } from 'vitest';
import { ctx, MIN, NOW } from '../../../../tests/helpers/ctx';
import { issueKey } from './index';
import { bridgeOffline } from './bridge-offline';

describe('bridge.offline', () => {
	it('fires critical when bridge/state is offline', () => {
		const c = ctx();
		c.state.bridge.state = 'offline';
		const [f] = bridgeOffline(c);
		expect(f).toMatchObject({ rule: 'bridge.offline', ieee: null, severity: 'critical' });
	});

	it('fires when the last live message is 5 min old, not at 4 min 59 s', () => {
		const c = ctx();
		c.state.bridge.lastLiveAt = NOW - 5 * MIN;
		expect(bridgeOffline(c)).toHaveLength(1);
		c.state.bridge.lastLiveAt = NOW - 5 * MIN + 1000;
		expect(bridgeOffline(c)).toEqual([]);
	});

	it('is nothing on a healthy baseline', () => {
		expect(bridgeOffline(ctx())).toEqual([]);
	});

	it('suppresses the silence part in grace but not an explicit offline', () => {
		const c = ctx();
		c.state.monitor.startedAt = NOW - 10 * MIN;
		c.state.bridge.lastLiveAt = NOW - 6 * MIN;
		expect(bridgeOffline(c)).toEqual([]);
		c.state.bridge.state = 'offline';
		expect(bridgeOffline(c)).toHaveLength(1);
	});

	it('when open, keeps firing until online for 2 min and live within 2 min', () => {
		const c = ctx();
		c.open.add(issueKey('bridge.offline', null));
		c.state.bridge.onlineSince = NOW - 1 * MIN;
		expect(bridgeOffline(c)).toHaveLength(1);
		c.state.bridge.onlineSince = NOW - 2 * MIN;
		c.state.bridge.lastLiveAt = NOW - 3 * MIN;
		expect(bridgeOffline(c)).toHaveLength(1);
		c.state.bridge.lastLiveAt = NOW - 1 * MIN;
		expect(bridgeOffline(c)).toEqual([]);
	});

	it('is nothing while the monitor is disconnected and the issue is not open', () => {
		const c = ctx();
		c.state.monitor.connected = false;
		c.state.bridge.lastLiveAt = NOW - 10 * MIN;
		expect(bridgeOffline(c)).toEqual([]);
		c.state.bridge.state = 'offline'; // stale retained state
		expect(bridgeOffline(c)).toEqual([]);
	});

	it('holds an open issue while the monitor is disconnected', () => {
		const c = ctx();
		c.state.monitor.connected = false;
		c.open.add(issueKey('bridge.offline', null));
		expect(bridgeOffline(c)).toHaveLength(1);
	});

	it('starts the silence clock at reconnect after an outage', () => {
		const c = ctx();
		c.state.bridge.lastLiveAt = NOW - 30 * MIN;
		c.state.monitor.connectedAt = NOW - 1 * MIN;
		expect(bridgeOffline(c)).toEqual([]);
		c.state.monitor.connectedAt = NOW - 5 * MIN;
		expect(bridgeOffline(c)).toHaveLength(1);
	});

	it('does not clear an open issue on reconnect alone; needs live messages', () => {
		const c = ctx();
		c.open.add(issueKey('bridge.offline', null));
		c.state.bridge.onlineSince = NOW - 60 * MIN;
		c.state.bridge.lastLiveAt = NOW - 30 * MIN;
		c.state.monitor.connectedAt = NOW - 1 * MIN;
		expect(bridgeOffline(c)).toHaveLength(1);
	});
});
