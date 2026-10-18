<script lang="ts">
	import { enhance } from '$app/forms';
	import LineChart from '../../../lib/components/LineChart.svelte';
	import { FOREVER, formatAgo, formatDaysLeft, formatDetail, formatTime } from '../../../lib/views';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const d = $derived(data.device);
	const muted = $derived(d.mutedUntil && d.mutedUntil > data.now ? d.mutedUntil : null);
	const RANGES = [['24h', '24 h'], ['7d', '7 d'], ['30d', '30 d']] as const;
</script>

<p><a href="/devices">← Devices</a></p>
<h1>{d.name}</h1>
<dl class="evidence">
	<dt>Type</dt><dd>{d.type}</dd>
	<dt>Model</dt><dd>{[d.vendor, d.model].filter(Boolean).join(' ') || '—'}</dd>
	<dt>Power</dt><dd>{d.powerSource ?? '—'}</dd>
	<dt>Availability</dt><dd class:bad={d.availability === 'offline'}>{d.availability ?? 'unknown'}</dd>
	<dt>Last seen</dt><dd title={formatTime(d.lastSeenAt, data.tz)}>{formatAgo(d.lastSeenAt, data.now)}</dd>
	<dt>IEEE</dt><dd><code>{d.ieee}</code></dd>
</dl>

{#if d.ignored}<p class="note">Ignored — no rules run for this device.</p>{/if}
{#if d.chatty}<p class="note">Chatty — expected to send many messages, never reported as dominant.</p>{/if}

<h2>Open issues</h2>
{#if data.issues.length}
	<ul class="issues">
		{#each data.issues as i (i.id)}<li><span class="sev {i.severity}">{i.severity}</span> <a href="/issues/{i.id}">{i.summary}</a></li>{/each}
	</ul>
{:else}
	<p class="muted">None.</p>
{/if}

<h2>History</h2>
<nav class="range" aria-label="Chart range">
	{#each RANGES as [k, label] (k)}<a href="?range={k}" aria-current={data.range === k ? 'page' : undefined}>{label}</a>{/each}
</nav>
<div class="charts">
	{#each data.charts as c (c.title)}<LineChart {...c} />{/each}
</div>

{#if d.batteryPowered}
	<h2>Battery</h2>
	<p>
		{data.daysLeft !== null ? `Reaches ${data.targetPct}% in ${formatDaysLeft(data.daysLeft)}.` : 'Not enough data for a forecast yet.'}
		Last swap: {data.lastSwapAt ? formatTime(data.lastSwapAt, data.tz) : 'none recorded'}.
	</p>
{/if}

{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}

<h2>Controls</h2>
<div class="actions">
	<form method="post" action="?range={data.range}&/mute" use:enhance>
		<label>Mute
			<select name="duration">
				<option value="1h">1 hour</option><option value="24h">24 hours</option>
				<option value="7d">7 days</option><option value="forever">forever</option>
				{#if muted}<option value="unmute">unmute</option>{/if}
			</select>
		</label>
		<button>Apply</button>
	</form>
	<p>{muted === FOREVER ? 'Muted forever' : muted ? `Muted until ${formatTime(muted, data.tz)}` : 'Not muted'}</p>
	<form method="post" action="?range={data.range}&/ignore" use:enhance>
		<input type="hidden" name="on" value={d.ignored ? '0' : '1'} />
		<button>{d.ignored ? 'Stop ignoring this device' : 'Ignore this device'}</button>
	</form>
	<form method="post" action="?range={data.range}&/chatty" use:enhance>
		<input type="hidden" name="on" value={d.chatty ? '0' : '1'} />
		<button>{d.chatty ? 'Unmark as chatty' : 'Mark as chatty'}</button>
	</form>
</div>

{#if data.events.length}
	<h2>{data.events.length === 1 ? 'Last event' : `Last ${data.events.length} events`}</h2>
	<table>
		<thead><tr><th scope="col">Time</th><th scope="col">Event</th><th scope="col">Detail</th></tr></thead>
		<tbody>
			{#each data.events as e (e.id)}
				<tr><td>{formatTime(e.ts, data.tz)}</td><td>{e.kind}</td><td>{formatDetail(e.kind, e.detail)}</td></tr>
			{/each}
		</tbody>
	</table>
{/if}
