<script lang="ts">
	import { formatDetail, formatTime } from '../../lib/views';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const label = $derived(Object.fromEntries(data.kinds));
	const ICON: Record<string, string> = {
		availability: '#i-signal', bridge_state: '#i-restart', bridge_restart: '#i-restart', bridge_version: '#i-restart', device_joined: '#i-plus',
		device_leave: '#i-minus', device_announce: '#i-broadcast', device_interview: '#i-broadcast', battery_swap: '#i-battery', route_error: '#i-route',
		leave_count_up: '#i-minus', address_changed: '#i-route'
	};
	const link = (page: number) => {
		const p = new URLSearchParams();
		if (data.kind) p.set('kind', data.kind);
		if (data.device) p.set('device', data.device);
		if (page > 1) p.set('page', String(page));
		return `/events?${p}`;
	};
</script>

<div class="page">
	<div class="page-head">
		<div>
			<h1>Events</h1>
			<p class="sub">Raw log, newest first. Kept for 90 days · {data.total} events.</p>
		</div>
	</div>

	<form method="get" class="toolbar" aria-label="Filter events">
		<div class="field">
			<label for="ev-kind">Kind</label>
			<select id="ev-kind" class="select" name="kind">
				<option value="">All</option>
				{#each data.kinds as [k, name] (k)}<option value={k} selected={k === data.kind}>{name}</option>{/each}
			</select>
		</div>
		<div class="field">
			<label for="ev-device">Device</label>
			<select id="ev-device" class="select" name="device">
				<option value="">All</option>
				{#each data.devices as [ieee, name] (ieee)}<option value={ieee} selected={ieee === data.device}>{name}</option>{/each}
			</select>
		</div>
		<button class="btn btn-primary">Filter</button>
	</form>

	{#if data.unknown}
		<p class="muted">Unknown filter. <a href="/events">Clear filters</a></p>
	{:else if data.rows.length}
		<div class="dt-wrap"><div class="dt-scroll">
			<table class="dt compact">
				<thead><tr><th scope="col"><span>Time</span></th><th scope="col"><span>Kind</span></th><th scope="col"><span>Device</span></th><th scope="col"><span>Detail</span></th></tr></thead>
				<tbody>
					{#each data.rows as e (e.id)}
						<tr>
							<td>{formatTime(e.ts, data.tz)}</td>
							<td><span class="kind"><svg class="i" aria-hidden="true"><use href={ICON[e.kind] ?? '#i-info'} /></svg>{label[e.kind] ?? e.kind}</span></td>
							<td class="name">{#if e.ieee}<a href="/devices/{e.ieee}">{data.names[e.ieee] ?? e.ieee}</a>{:else}<span class="dash">—</span>{/if}</td>
							<td>{formatDetail(e.kind, e.detail) || '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div></div>
	{:else if data.page > 1}
		<p class="muted">No events on this page. <a href={link(1)}>Back to page 1</a></p>
	{:else}
		<p class="muted">No events in the last 90 days.</p>
	{/if}

	{#if data.page > 1 || data.hasNext}
		<nav class="pager" aria-label="Pages">
			{#if data.page > 1}<a class="btn btn-sm" href={link(data.page - 1)}><svg class="i" aria-hidden="true"><use href="#i-arrow-left" /></svg> Newer</a>{/if}
			<span class="faint">Page {data.page}</span>
			{#if data.hasNext}<a class="btn btn-sm" href={link(data.page + 1)}>Older <svg class="i" aria-hidden="true"><use href="#i-arrow-right" /></svg></a>{/if}
		</nav>
	{/if}
</div>

<style>
	.kind { display: inline-flex; align-items: center; gap: 6px; }
	.kind :global(svg.i) { flex: none; }
</style>
