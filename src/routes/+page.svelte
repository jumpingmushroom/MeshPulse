<script lang="ts">
	import { formatAgo } from '../lib/views';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const HEADLINE = { green: 'All good', amber: 'Needs attention', red: 'Critical problem' };
	const c = $derived(data.counters);
	const b = $derived(data.bridge);
	const PREREQ = { availability: 'Availability is off', health: 'Health checks are off', mqtt_log: 'Logging to MQTT is off' };
</script>

<section class="banner {data.status}" role="status">
	<h1>{HEADLINE[data.status]}</h1>
	{#if data.issues.length}<p>{data.issues.length} unresolved issue{data.issues.length === 1 ? '' : 's'}</p>{/if}
</section>

{#each data.prereqs as p (p.key)}
	<section class="banner amber">
		<h2>{PREREQ[p.key]} in Zigbee2MQTT</h2>
		<p>MeshPulse misses problems until you add this to <code>configuration.yaml</code>:</p>
		<pre>{p.fix}</pre>
	</section>
{/each}

{#if data.issues.length}
	<h2>Issues</h2>
	<ul class="issues">
		{#each data.issues as i (i.id)}
			<li>
				<span class="sev {i.severity}">{i.severity}</span>
				<a href="/issues/{i.id}">{i.summary}</a>
				{#if i.state === 'acknowledged'}<span class="muted">acknowledged</span>{/if}
				<span class="muted">{formatAgo(i.openedAt, data.now)}</span>
			</li>
		{/each}
	</ul>
{/if}

<dl class="counters">
	<div><dt>Devices online</dt><dd>{c.devicesOnline} / {c.devicesTotal}</dd></div>
	<div><dt>Routers online</dt><dd>{c.routersOnline} / {c.routersTotal}</dd></div>
	<div><dt>Low batteries</dt><dd>{c.batteriesLow}</dd></div>
</dl>

<p class="bridge">
	Bridge {b.state ?? 'unknown'}
	{#if b.version} · Zigbee2MQTT {b.version}{/if}
	{#if b.uptime} · up {b.uptime}{/if}
	{#if b.channel} · channel {b.channel}{/if}
	{#if b.coordinator} · {b.coordinator}{/if}
</p>
