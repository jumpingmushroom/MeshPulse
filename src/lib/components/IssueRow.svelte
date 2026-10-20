<script lang="ts">
	import { resolve } from '$app/paths';
	import { formatAgo, groupedSummary, isWifiKey, RULE_LABELS } from '../views';
	import type { RuleId } from '../server/rules/types';
	import type { Severity } from '../server/types';
	import SevBadge from './SevBadge.svelte';

	let { issue, now, children = [] }: {
		issue: { id: number; severity: Severity; state: string; summary: string; action?: string; ieee: string | null; deviceName?: string; rule: string; openedAt: number };
		now: number; children?: { id: number; summary: string; rule: string }[];
	} = $props();
	const STATE = { open: ['state-open', 'Open'], acknowledged: ['state-ack', 'Acknowledged'], resolved: ['state-resolved', 'Resolved'] } as const;
	const sev = { critical: 'is-crit', warning: 'is-warn', info: 'is-info' } as const;
</script>

<article class="issue {sev[issue.severity]}">
	<SevBadge severity={issue.severity} />
	<div class="issue-main">
		<div class="issue-title"><a href={resolve('/issues/[id]', { id: String(issue.id) })}>{issue.summary}</a></div>
		{#if issue.action}<div class="issue-action"><svg class="i" aria-hidden="true"><use href="#i-arrow-right" /></svg><span>{issue.action}</span></div>{/if}
		<div class="issue-meta">
			{#if issue.ieee}<a href={isWifiKey(issue.ieee) ? resolve('/wifi') : resolve('/devices/[ieee]', { ieee: issue.ieee })}>{issue.deviceName ?? issue.ieee}</a>{/if}
			<span>{RULE_LABELS[issue.rule as RuleId] ?? issue.rule}</span>
		</div>
	</div>
	<div class="issue-when"><span>opened {formatAgo(issue.openedAt, now)}</span><span class="state {STATE[issue.state as keyof typeof STATE]?.[0]}">{STATE[issue.state as keyof typeof STATE]?.[1] ?? issue.state}</span></div>
	{#if children.length}
		<details class="issue-children">
			<summary><svg class="i" aria-hidden="true"><use href="#i-caret" /></svg>{groupedSummary(children)}</summary>
			<ul>{#each children as c (c.id)}<li><span></span><a href={resolve('/issues/[id]', { id: String(c.id) })}>{c.summary}</a></li>{/each}</ul>
		</details>
	{/if}
</article>
