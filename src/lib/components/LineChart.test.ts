import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import LineChart from './LineChart.svelte';

const base = { title: 'Link quality', unit: '', t0: 0, t1: 3_600_000, y0: 0, y1: 255, maxGapMs: 1_800_000, summary: 'LQI summary' };

describe('LineChart', () => {
	it('renders "No data yet" without an svg when empty', () => {
		const { body } = render(LineChart, { props: { ...base, points: [{ t: 0, v: null }] } });
		expect(body).toContain('No data yet');
		expect(body).not.toContain('<svg');
	});
	it('renders an accessible svg with refs and no NaN', () => {
		const { body } = render(LineChart, { props: { ...base, points: [{ t: 0, v: 100, lo: 90, hi: 110 }, { t: 600_000, v: 120, lo: 100, hi: 130 }],
			refs: [{ y: 30, label: 'weak 30' }], latest: '84' } });
		expect(body).toContain('<span class="muted"> · latest 84</span>');
		expect(body).toContain('role="img"');
		expect(body).toContain('aria-label="LQI summary"');
		expect(body).toContain('weak 30');
		expect(body).toContain('class="band"');
		expect(body).not.toContain('NaN');
	});
});

describe('LineChart integer ticks', () => {
	it('uses whole-number ticks for counts', () => {
		const { body } = render(LineChart, { props: { ...base, y1: 1, integer: true, points: [{ t: 0, v: 1 }] } });
		expect(body).not.toMatch(/>0\.\d</);
	});
});
