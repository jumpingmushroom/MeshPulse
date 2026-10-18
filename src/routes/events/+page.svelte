<script lang="ts">
	import { formatDetail, formatTime } from '../../lib/views';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const label = $derived(Object.fromEntries(data.kinds));
	const link = (page: number) => {
		const p = new URLSearchParams();
		if (data.kind) p.set('kind', data.kind);
		if (data.device) p.set('device', data.device);
		if (page > 1) p.set('page', String(page));
		return `/events?${p}`;
	};
</script>

<h1>Events</h1>
<form method="get" class="filters">
	<label>Kind
		<select name="kind">
			<option value="">All</option>
			{#each data.kinds as [k, name] (k)}<option value={k} selected={k === data.kind}>{name}</option>{/each}
		</select>
	</label>
	<label>Device
		<select name="device">
			<option value="">All</option>
			{#each data.devices as [ieee, name] (ieee)}<option value={ieee} selected={ieee === data.device}>{name}</option>{/each}
		</select>
	</label>
	<button>Filter</button>
</form>

{#if data.unknown}
	<p class="note">Unknown filter. <a href="/events">Clear filters</a></p>
{:else if data.rows.length}
	<table>
		<thead><tr><th scope="col">Time</th><th scope="col">Event</th><th scope="col">Device</th><th scope="col">Detail</th></tr></thead>
		<tbody>
			{#each data.rows as e (e.id)}
				<tr>
					<td>{formatTime(e.ts, data.tz)}</td>
					<td>{label[e.kind] ?? e.kind}</td>
					<td>{#if e.ieee}<a href="/devices/{e.ieee}">{data.names[e.ieee] ?? e.ieee}</a>{:else}—{/if}</td>
					<td>{formatDetail(e.kind, e.detail)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{:else if data.page > 1}
	<p class="note">No events on this page. <a href={link(1)}>Back to page 1</a></p>
{:else}
	<p class="note">No events in the last 90 days.</p>
{/if}

{#if data.page > 1 || data.hasNext}
	<p>
		{#if data.page > 1}<a href={link(data.page - 1)}>← Newer</a>{/if}
		<span>Page {data.page}</span>
		{#if data.hasNext}<a href={link(data.page + 1)}>Older →</a>{/if}
	</p>
{/if}
