<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatAgo, formatTime } from '../../lib/views';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const { now, tz } = $derived(data);
	const R = { Coordinator: 14, Router: 7, EndDevice: 4.5 } as const;
	const CLS = { Coordinator: 'n n-coord', Router: 'n n-router', EndDevice: 'n' } as const;
	const type = (t: string) => t as keyof typeof R;
	const at = $derived(new Map((data.scan?.nodes ?? []).map((n) => [n.ieee, n])));
</script>

<div class="page">
	<div class="page-head">
		<div>
			<h1>Network map</h1>
			{#if data.scan}
				<p class="sub">From the nightly network scan · last scanned {formatTime(data.scan.at, tz)} ({formatAgo(data.scan.at, now)}){data.enabled ? ' · next scan ' + data.scanAt : ''}. Positions are a layout, not a floor plan.</p>
			{/if}
		</div>
		<div style="display:flex;gap:var(--space-4);align-items:center">
			<span class="tag tag-outline">Opt-in · sends traffic to the mesh</span>
			<form method="post" action="?/scan" use:enhance={() => async ({ update }) => update({ reset: false })}>
				<button class="btn btn-sm">Scan now</button>
			</form>
		</div>
	</div>

	{#if form && 'ok' in form}
		<p class={form.ok ? 'muted' : 'field-error'} role="status">{form.ok ? 'Scan started. Reload in a few minutes.' : form.reason}</p>
	{/if}
	{#if data.failure}
		<div class="panel panel-pad"><strong>The last scan failed</strong> ({formatAgo(data.failure.at, now)}): {data.failure.reason}.{data.scan ? ' The last good scan is shown below.' : ''}</div>
	{/if}

	{#if data.scan}
		{@const scan = data.scan}
		<div class="split">
			<div class="panel" style="padding:8px">
				<svg class="map" viewBox="0 0 1100 760" role="img" aria-label="Network map of {scan.nodes.length} devices. {scan.offline.length} did not answer the scan.">
					{#each scan.edges as e (e.from)}
						{@const a = at.get(e.from)!}
						{@const b = at.get(e.to)!}
						<line class={e.weak ? 'e e-weak' : 'e'} x1={a.x} y1={a.y} x2={b.x} y2={b.y}><title>{e.name} → {e.parent}: LQI {e.lqi}</title></line>
					{/each}
					{#each scan.nodes as n (n.ieee)}
						{@const r = R[type(n.type)] + (n.failed ? 2 : 0)}
						<a href="/devices/{n.ieee}" aria-label="{n.name}, {n.type}{n.failed ? ', did not answer' : ''}{n.lqi === null ? '' : `, LQI ${n.lqi}`}">
							<circle class={n.failed ? 'n n-off' : CLS[type(n.type)]} cx={n.x} cy={n.y} r={r}></circle>
							{#if n.failed}<path class="x" d="M{n.x - r * 0.6} {n.y - r * 0.6} L{n.x + r * 0.6} {n.y + r * 0.6} M{n.x + r * 0.6} {n.y - r * 0.6} L{n.x - r * 0.6} {n.y + r * 0.6}"></path>{/if}
							<title>{n.name}{n.lqi === null ? '' : ` · LQI ${n.lqi}`}</title>
						</a>
					{/each}
					{#each scan.labels as l (l.ieee)}<text x={l.x} y={l.y} text-anchor={l.anchor}>{at.get(l.ieee)?.name}</text>{/each}
				</svg>
			</div>
			<aside class="stack">
				<section class="panel panel-pad stack">
					<h2 style="font-size:13px">Legend</h2>
					<div class="chart-legend" style="flex-direction:column;gap:6px">
						<span><svg width="14" height="14"><circle cx="7" cy="7" r="6" style="fill:var(--accent)"></circle></svg>Coordinator</span>
						<span><svg width="14" height="14"><circle cx="7" cy="7" r="5" style="fill:var(--accent-tint);stroke:var(--accent);stroke-width:1.5"></circle></svg>Router</span>
						<span><svg width="14" height="14"><circle cx="7" cy="7" r="3.5" style="fill:var(--surface-2);stroke:var(--text-faint)"></circle></svg>End device</span>
						<span><svg width="14" height="14"><circle cx="7" cy="7" r="5" style="fill:var(--crit-bg);stroke:var(--crit-fg);stroke-width:2"></circle></svg>Did not answer (crossed)</span>
						<span><i class="ref" style="border-top:1.5px dashed var(--warn-fg)"></i>Weak link, LQI under 60</span>
						<span><i style="border-top:1px solid var(--text-faint)"></i>Link, LQI 60+</span>
					</div>
				</section>
				<section class="panel panel-pad stack">
					<h2 style="font-size:13px">Offline at last scan <span class="count faint">{scan.offline.length}</span></h2>
					{#each scan.offline as o (o.ieee)}<a href="/devices/{o.ieee}" style="font-size:13px">{o.name}</a>{:else}<p class="muted" style="font-size:13px">None. Every router answered the scan.</p>{/each}
				</section>
			</aside>
		</div>
	{:else if !data.enabled}
		<div class="panel panel-pad stack">
			<strong>The network scan is off</strong>
			<p class="muted">Once a night MeshPulse asks Zigbee2MQTT for the network map and draws who routes through whom. The scan sends traffic to the mesh for 2–4 minutes, which is the heaviest request a coordinator gets.</p>
			<p><a href="/settings">Turn it on in Settings</a></p>
		</div>
	{:else if !data.failure}
		<div class="panel panel-pad"><strong>No scan yet</strong><p class="muted">The first scan runs tonight at {data.scanAt}, or press Scan now.</p></div>
	{/if}
</div>
