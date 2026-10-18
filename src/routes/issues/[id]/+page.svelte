<script lang="ts">
	import { enhance } from '$app/forms';
	import { evidenceRows, FOREVER, formatTime } from '../../../lib/views';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const i = $derived(data.issue);
	const muted = $derived(data.device?.mutedUntil && data.device.mutedUntil > data.now ? data.device.mutedUntil : null);
	const evidence = $derived(evidenceRows(data.issue.evidence ?? {}, data.tz));
</script>

<p><a href="/issues">← Issues</a></p>
<h1><span class="sev {i.severity}">{i.severity}</span> {i.summary}</h1>
<p>
	State: <strong>{i.state}</strong> · opened {formatTime(i.openedAt, data.tz)}
	{#if i.resolvedAt} · resolved {formatTime(i.resolvedAt, data.tz)}{/if}
	{#if data.device} · device <a href="/devices/{data.device.ieee}">{data.device.name}</a>{/if}
</p>

{#if data.parent}<p>Part of: <a href="/issues/{data.parent.id}">{data.parent.summary}</a></p>{/if}
{#if data.children.length}
	<h2>Grouped issues ({data.children.length})</h2>
	<ul>{#each data.children as ch (ch.id)}<li><a href="/issues/{ch.id}">{ch.summary}</a>{#if ch.state === 'resolved'} <span class="muted">resolved</span>{/if}</li>{/each}</ul>
{/if}

{#if i.action}<h2>Suggested action</h2><p>{i.action}</p>{/if}

{#if evidence.length}
	<h2>Evidence</h2>
	<dl class="evidence">
		{#each evidence as [k, v] (k)}<dt>{k}</dt><dd>{v}</dd>{/each}
	</dl>
{/if}

{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

<div class="actions">
	{#if i.state === 'open'}
		<form method="post" action="?/acknowledge" use:enhance><button>Acknowledge</button></form>
	{/if}
	{#if data.device}
		<form method="post" action="?/mute" use:enhance>
			<label>Mute {data.device.name}
				<select name="duration">
					<option value="1h">1 hour</option><option value="24h">24 hours</option>
					<option value="7d">7 days</option><option value="forever">forever</option>
					{#if muted}<option value="unmute">unmute</option>{/if}
				</select>
			</label>
			<button>Apply</button>
		</form>
		<p>{muted === FOREVER ? 'Muted forever' : muted ? `Muted until ${formatTime(muted, data.tz)}` : 'Not muted'}</p>
	{/if}
</div>

{#if data.events.length}
	<h2>Last {data.events.length} events for {data.device?.name ?? i.ieee}</h2>
	<table>
		<thead><tr><th scope="col">Time</th><th scope="col">Event</th><th scope="col">Detail</th></tr></thead>
		<tbody>
			{#each data.events as e (e.id)}
				<tr><td>{formatTime(e.ts, data.tz)}</td><td>{e.kind}</td><td><code>{e.detail ? JSON.stringify(e.detail) : ''}</code></td></tr>
			{/each}
		</tbody>
	</table>
{/if}
