import { describe, expect, it } from 'vitest';
import { deviceScore, networkScore } from './score';

const top = (severity: 'info' | 'warning' | 'critical') => ({ severity, parentIssueId: null });
const dev = (severity: 'info' | 'warning' | 'critical', ieee: string, more = {}) => ({ severity, parentIssueId: null, ieee, ...more });

describe('score', () => {
	it('deducts 25/8/1 and floors at 0', () => {
		expect(deviceScore([])).toBe(100);
		expect(deviceScore([{ severity: 'critical' }, { severity: 'warning' }, { severity: 'info' }])).toBe(66);
		expect(deviceScore(Array(5).fill({ severity: 'critical' }))).toBe(0);
	});

	it('network score ignores child issues', () => {
		const r = networkScore([top('warning'), { severity: 'critical', parentIssueId: 1 }, { severity: 'warning', parentIssueId: 1 }], 100);
		expect(r).toEqual({ score: 92, status: 'amber' });
	});

	it('Wi-Fi issues do not move the network score', () => {
		expect(networkScore([{ severity: 'warning', parentIssueId: null, rule: 'wifi.channel_overlap' }], 100)).toEqual({ score: 100, status: 'green' });
	});

	it('network-wide issues: colour bands', () => {
		expect(networkScore([], 100)).toEqual({ score: 100, status: 'green' });
		expect(networkScore([top('info')], 100)).toEqual({ score: 99, status: 'green' });
		expect(networkScore([top('warning')], 100).status).toBe('amber'); // 92 but a warning
		expect(networkScore(Array(5).fill(top('warning')), 100).status).toBe('amber'); // 60
		expect(networkScore(Array(6).fill(top('warning')), 100).status).toBe('red'); // 52
		expect(networkScore([top('critical')], 100)).toEqual({ score: 75, status: 'red' });
	});

	it('amber when 85+ is not reached without a warning', () => {
		expect(networkScore(Array(16).fill(top('info')), 100).status).toBe('amber'); // 84
		expect(networkScore(Array(15).fill(top('info')), 100).status).toBe('green'); // 85
	});

	it('device issues cost the share of devices they affect, not a flat 8 each', () => {
		// 2 Nov production: 14 warnings on a 139-device mesh scored 0 under the flat formula
		const twelve = Array.from({ length: 12 }, (_, k) => dev('warning', `0x${k}`));
		expect(networkScore(twelve, 139)).toEqual({ score: 96, status: 'amber' });
		expect(networkScore(Array.from({ length: 10 }, (_, k) => dev('warning', `0x${k}`)), 10).score).toBe(50);
		expect(networkScore(Array.from({ length: 10 }, (_, k) => dev('critical', `0x${k}`)), 10)).toEqual({ score: 0, status: 'red' });
	});

	it('a device counts once, at its worst issue', () => {
		expect(networkScore([dev('warning', '0xa'), dev('critical', '0xa'), dev('warning', '0xa', { rule: 'lqi.weak' })], 10).score).toBe(90);
	});

	it('acknowledged issues are accepted: they leave the score and the colour', () => {
		expect(networkScore([{ ...top('critical'), state: 'acknowledged' }, dev('warning', '0xa', { state: 'acknowledged' })], 10)).toEqual({ score: 100, status: 'green' });
		expect(networkScore([{ ...top('warning'), state: 'open' }, { ...top('critical'), state: 'acknowledged' }], 10)).toEqual({ score: 92, status: 'amber' });
	});
});
