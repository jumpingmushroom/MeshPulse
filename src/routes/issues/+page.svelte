<script lang="ts">
	import { formatTime } from '../../lib/views';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<h1>Issues</h1>
<nav class="tabs" aria-label="Issue state">
	{#each data.tabs as t (t)}
		<a href="?state={t}" aria-current={data.tab === t ? 'page' : undefined}>{t[0].toUpperCase() + t.slice(1)}</a>
	{/each}
</nav>

{#if data.issues.length}
	<table>
		<thead>
			<tr>
				<th scope="col">Severity</th><th scope="col">Summary</th><th scope="col">Device</th><th scope="col">Opened</th>
				{#if data.tab === 'resolved'}<th scope="col">Resolved</th>{/if}
			</tr>
		</thead>
		<tbody>
			{#each data.issues as i (i.id)}
				<tr>
					<td><span class="sev {i.severity}">{i.severity}</span></td>
					<td><a href="/issues/{i.id}">{i.summary}</a></td>
					<td>{i.device ?? ''}</td>
					<td>{formatTime(i.openedAt, data.tz)}</td>
					{#if data.tab === 'resolved'}<td>{formatTime(i.resolvedAt, data.tz)}</td>{/if}
				</tr>
			{/each}
		</tbody>
	</table>
{:else}
	<p>No {data.tab} issues.</p>
{/if}
