import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import IssueRow from './IssueRow.svelte';
import ScoreRing from './ScoreRing.svelte';

describe('shared components', () => {
	const issue = { id: 1, severity: 'critical' as const, state: 'open', summary: 'Hall plug offline', ieee: '0x1', rule: 'device.offline', openedAt: 0 };
	it('IssueRow renders grouped children and omits an absent action', () => {
		const { body } = render(IssueRow, { props: { issue, now: 60_000, children: [{ id: 2, summary: 'x', rule: 'device.offline' }] } });
		expect(body).toContain('1 grouped issue: 1 device offline');
		expect(body).toContain('is-crit');
		expect(body).not.toContain('issue-action');
	});
	it('ScoreRing shows no number and a learning label', () => {
		const { body } = render(ScoreRing, { props: { status: 'learning', score: 0 } });
		expect(body).toContain('Learning');
		expect(body).toContain('Health score');
	});
});
