<script lang="ts">
	import { enhance } from '$app/forms';
	import LineChart from '../../../lib/components/LineChart.svelte';
	import KV from '../../../lib/components/KV.svelte';
	import SevBadge from '../../../lib/components/SevBadge.svelte';
	import { evidenceRows, FOREVER, formatAgo, formatDuration, formatTime, formatDetail, RULE_LABELS } from '../../../lib/views';
	import type { RuleId } from '../../../lib/server/rules/types';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const i = $derived(data.issue);
	const muted = $derived(data.device?.mutedUntil && data.device.mutedUntil > data.now ? data.device.mutedUntil : null);
	const evidence = $derived(evidenceRows(data.issue.evidence ?? {}, data.tz));
	const STATE = { open: 'Open', acknowledged: 'Acknowledged', resolved: 'Resolved' } as const;
</script>

<p><a class="crumb" href="/issues">← Issues</a></p>
<div class="page-head">
	<div>
		<p class="muted"><SevBadge severity={i.severity} large /> {STATE[i.state as keyof typeof STATE] ?? i.state} · {RULE_LABELS[i.rule as RuleId] ?? i.rule}</p>
		<h1>{i.summary}</h1>
		<p class="sub">
			Opened {formatTime(i.openedAt, data.tz)} ({formatAgo(i.openedAt, data.now)})
			{#if i.resolvedAt} · resolved {formatTime(i.resolvedAt, data.tz)} · open for {formatDuration(i.resolvedAt - i.openedAt)}
			{:else} · open for {formatDuration(data.now - i.openedAt)}{/if}
		</p>
	</div>
</div>

<div class="split">
	<div>
		{#if i.action}
			<div class="issue-action"><svg class="i" aria-hidden="true"><use href="#i-arrow-right" /></svg><span><strong>Suggested action</strong> {i.action}</span></div>
		{/if}

		{#if evidence.length}
			<h2>Evidence</h2>
			<div class="panel panel-pad"><KV rows={evidence} /></div>
		{/if}

		{#if data.chart}<div class="panel panel-pad"><LineChart {...data.chart} /></div>{/if}

		{#if data.parent}<p>Part of: <a href="/issues/{data.parent.id}">{data.parent.summary}</a></p>{/if}
		{#if data.children.length}
			<h2>Grouped issues ({data.children.length})</h2>
			<ul>{#each data.children as ch (ch.id)}<li><a href="/issues/{ch.id}">{ch.summary}</a>{#if ch.state === 'resolved'} <span class="muted">resolved</span>{/if}</li>{/each}</ul>
		{/if}

		{#if data.events.length}
			<h2>Last {data.events.length} events for {data.device?.name ?? i.ieee}</h2>
			<table>
				<thead><tr><th scope="col">Time</th><th scope="col">Event</th><th scope="col">Detail</th></tr></thead>
				<tbody>
					{#each data.events as e (e.id)}
						<tr><td>{formatTime(e.ts, data.tz)}</td><td>{e.kind}</td><td>{formatDetail(e.kind, e.detail)}</td></tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>

	<aside class="panel panel-pad">
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		{#if i.state === 'open'}
			<form method="post" action="?/acknowledge" use:enhance>
				<button class="btn btn-primary">Acknowledge</button>
				<p class="muted">Stops reminders. The issue stays open until it resolves.</p>
			</form>
		{/if}
		{#if data.device}
			<form method="post" action="?/mute" use:enhance>
				<label>Mute {data.device.name}
					<select class="select" name="duration">
						<option value="1h">1 hour</option><option value="24h">24 hours</option>
						<option value="7d">7 days</option><option value="forever">forever</option>
						{#if muted}<option value="unmute">unmute</option>{/if}
					</select>
				</label>
				<button class="btn">Apply</button>
			</form>
			<p class="muted">{muted === FOREVER ? 'Muted forever' : muted ? `Muted until ${formatTime(muted, data.tz)}` : 'Not muted'}</p>
			<a class="btn btn-ghost" href="/devices/{data.device.ieee}">Open device page →</a>
		{/if}
	</aside>
</div>
