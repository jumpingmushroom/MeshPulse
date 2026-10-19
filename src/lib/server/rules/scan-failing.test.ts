import { describe, expect, it } from 'vitest';
import { ctx } from '../../../../tests/helpers/ctx';
import { RULE_DEFAULTS } from './index';
import { scanFailing } from './scan-failing';

const withStreak = (n: number) => { const c = ctx(); c.active = { missingRouters: null, scanFailStreak: n }; return c; };

describe('active.scan_failing', () => {
	it('fires from three failed scans in a row', () => {
		expect(scanFailing(withStreak(2))).toEqual([]);
		const f = scanFailing(withStreak(3));
		expect(f).toHaveLength(1);
		expect(f[0]).toMatchObject({ rule: 'active.scan_failing', ieee: null, severity: 'info', summary: 'Network scan keeps failing' });
	});
	it('names the configured base topic', () => {
		const c = withStreak(3);
		expect(scanFailing(c)[0].action).toContain('zigbee2mqtt/bridge/request/#');
		c.active!.baseTopic = 'z2m-home';
		expect(scanFailing(c)[0].action).toContain('z2m-home/bridge/request/#');
	});
	it('is silent after an ok scan or without active data', () => {
		expect(scanFailing(withStreak(0))).toEqual([]);
		expect(scanFailing(ctx())).toEqual([]);
	});
	it('notifies and is network-level', () => {
		expect(RULE_DEFAULTS['active.scan_failing']).toMatchObject({ deviceLevel: false, notify: true });
	});
});
