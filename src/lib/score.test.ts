import { describe, expect, it } from 'vitest';
import { deviceScore, networkScore } from './score';

const top = (severity: 'info' | 'warning' | 'critical') => ({ severity, parentIssueId: null });

describe('score', () => {
	it('deducts 25/8/1 and floors at 0', () => {
		expect(deviceScore([])).toBe(100);
		expect(deviceScore([{ severity: 'critical' }, { severity: 'warning' }, { severity: 'info' }])).toBe(66);
		expect(deviceScore(Array(5).fill({ severity: 'critical' }))).toBe(0);
	});

	it('network score ignores child issues', () => {
		const r = networkScore([top('warning'), { severity: 'critical', parentIssueId: 1 }, { severity: 'warning', parentIssueId: 1 }]);
		expect(r).toEqual({ score: 92, status: 'amber' });
	});

	it('Wi-Fi issues do not move the network score', () => {
		expect(networkScore([{ severity: 'warning', parentIssueId: null, rule: 'wifi.channel_overlap' }])).toEqual({ score: 100, status: 'green' });
	});

	it('colour bands', () => {
		expect(networkScore([])).toEqual({ score: 100, status: 'green' });
		expect(networkScore([top('info')])).toEqual({ score: 99, status: 'green' });
		expect(networkScore([top('warning')]).status).toBe('amber'); // 92 but a warning
		expect(networkScore(Array(5).fill(top('warning'))).status).toBe('amber'); // 60
		expect(networkScore(Array(6).fill(top('warning'))).status).toBe('red'); // 52
		expect(networkScore([top('critical')])).toEqual({ score: 75, status: 'red' });
	});

	it('amber when 85+ is not reached without a warning', () => {
		expect(networkScore(Array(16).fill(top('info'))).status).toBe('amber'); // 84
		expect(networkScore(Array(15).fill(top('info'))).status).toBe('green'); // 85
	});
});
