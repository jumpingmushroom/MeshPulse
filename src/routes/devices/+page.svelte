<script lang="ts">
	import { formatAgo, formatTime, formatVoltage, sortRows, type DeviceRow, type SortKey as Key } from '../../lib/views';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const COLS: [Key, string][] = [['name', 'Name'], ['type', 'Type'], ['availability', 'Availability'], ['lastSeenAt', 'Last seen'],
		['lqi', 'LQI'], ['battery', 'Battery %'], ['voltage', 'Battery V'], ['openIssues', 'Open issues']];
	let sortKey = $state<Key>('name');
	let asc = $state(true);
	let f = $state({ routers: false, battery: false, offline: false, issues: false });

	const rows = $derived(sortRows(data.rows.filter((r: DeviceRow) => (!f.routers || r.type === 'Router') && (!f.battery || r.batteryPowered)
		&& (!f.offline || r.availability === 'offline') && (!f.issues || r.openIssues > 0)), sortKey, asc));

	function sortBy(k: Key) {
		asc = sortKey === k ? !asc : true;
		sortKey = k;
	}
</script>

<h1>Devices</h1>
<fieldset class="filters">
	<legend>Show only</legend>
	<label><input type="checkbox" bind:checked={f.routers} /> Routers</label>
	<label><input type="checkbox" bind:checked={f.battery} /> Battery</label>
	<label><input type="checkbox" bind:checked={f.offline} /> Offline</label>
	<label><input type="checkbox" bind:checked={f.issues} /> Has issues</label>
</fieldset>

{#if rows.length}
	<table>
		<thead>
			<tr>
				{#each COLS as [k, label] (k)}
					<th scope="col" aria-sort={sortKey === k ? (asc ? 'ascending' : 'descending') : 'none'}>
						<button type="button" onclick={() => sortBy(k)}>{label}{sortKey === k ? (asc ? ' ▲' : ' ▼') : ''}</button>
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as r (r.ieee)}
				<tr>
					<td><a href="/devices/{r.ieee}">{r.name}</a>{#if r.mutedUntil && r.mutedUntil > data.now} <span class="muted">(muted)</span>{/if}</td>
					<td>{r.type}</td>
					<td class:bad={r.availability === 'offline'}>{r.availability ?? 'unknown'}</td>
					<td title={formatTime(r.lastSeenAt, data.tz)}>{formatAgo(r.lastSeenAt, data.now)}</td>
					<td>{r.lqi ?? '—'}</td>
					<td>{r.battery ?? '—'}</td>
					<td>{formatVoltage(r.voltage)}</td>
					<td>{r.openIssues || ''}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{:else}
	<p>No devices match.</p>
{/if}
