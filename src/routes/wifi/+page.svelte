<script lang="ts">
	import Sparkline from '../../lib/components/Sparkline.svelte';
	import { formatAgo, formatTime } from '../../lib/views';
	import { wifiMHz, zigbeeMHz } from '../../lib/wifi-freq';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const ROW = 22;
	const TOP = 22;
	const AXIS = 18;
	const px = (mhz: number) => ((mhz - 2400) / 84) * data.bandW;
	const height = $derived(TOP + (data.maxRow + 1) * ROW + AXIS);
	const zc = $derived(data.zigbeeChannel);
	const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n)} %`);
</script>

<div class="page">
	<div class="page-head">
		<div>
			<h1>Wi-Fi 2.4 GHz</h1>
			<p class="sub">
				{#if !data.enabled}Off
				{:else if zc !== null}Zigbee channel {zc} · {zigbeeMHz(zc)} MHz
				{:else}Zigbee channel unknown{/if}
			</p>
		</div>
	</div>

	{#if !data.enabled}
		<div class="empty">
			<strong>Wi-Fi correlation is off</strong>
			<p>MeshPulse can read your UniFi access points (read-only) to show which Wi-Fi channels overlap your Zigbee channel and how busy they are. It never changes anything in UniFi.</p>
			<a class="btn" href="/settings#wifi">Set up in Settings</a>
		</div>
	{:else}
		{#if data.lastError && data.failures > 0}
			<p class="field-error" role="alert">The last UniFi poll failed: {data.lastError}{data.lastOkAt ? ` Showing data from ${formatAgo(data.lastOkAt, data.now)}.` : ''}</p>
		{/if}

		{#if data.lastOkAt === null && !(data.lastError && data.failures > 0)}
			<div class="empty"><strong>Not polled yet</strong><p>MeshPulse polls UniFi every 5 minutes. The first result shows here soon.</p></div>
		{:else if data.aps.length === 0 && data.lastOkAt !== null}
			<div class="empty"><strong>No access points found</strong><p>The last poll succeeded but UniFi returned no access points.</p></div>
		{:else if data.aps.length}
			<section class="panel panel-pad stack" aria-labelledby="wifi-band">
				<h2 id="wifi-band" class="muted" style="font-size:12px;font-weight:500">Band 2400–2484 MHz</h2>
				<svg class="band" viewBox="0 0 {data.bandW} {height}" role="img"
					aria-label={`2.4 GHz band. ${zc === null ? 'Zigbee channel unknown.' : `Zigbee channel ${zc}.`} ${data.band.bars.map((b) => `${b.name}${b.overlaps ? ' overlaps' : ''}`).join(', ')}.`}>
					{#each data.band.bars as b (b.name + b.x + b.row)}
						<rect class="bar" class:is-overlap={b.overlaps} x={b.x} y={TOP + b.row * ROW} width={b.width} height={ROW - 4} rx="3" />
						<text class="bar-label" x={b.x + 4} y={TOP + b.row * ROW + 12}>{b.name}</text>
					{/each}
					{#if data.band.zigbee}
						<line class="zb" x1={data.band.zigbee.x} x2={data.band.zigbee.x} y1="14" y2={height - AXIS} />
						<text class="zb-label" x={data.band.zigbee.x} y="10" text-anchor="middle">Zigbee {zc}</text>
					{/if}
					<line class="axis" x1="0" x2={data.bandW} y1={height - AXIS} y2={height - AXIS} />
					{#each [1, 6, 11] as c (c)}<text class="tick" x={px(wifiMHz(c))} y={height - 4} text-anchor="middle">Wi-Fi {c}</text>{/each}
				</svg>
			</section>

			<div class="dt-wrap"><div class="dt-scroll">
				<table class="dt compact">
					<thead><tr>
						<th scope="col"><span>Access point</span></th><th scope="col"><span>Area</span></th><th scope="col"><span>Channel</span></th>
						<th scope="col" class="num"><span>Busy now</span></th><th scope="col"><span>24 h</span></th>
						<th scope="col" class="num"><span>Own share</span></th><th scope="col" class="num"><span>Clients</span></th>
						<th scope="col"><span>Last channel change</span></th><th scope="col"><span>Zigbee devices in area</span></th>
					</tr></thead>
					<tbody>
						{#each data.aps as a (a.mac)}
							<tr class={a.overlaps ? 'is-flagged is-warn' : ''}>
								<td class="name">{a.name}{#if a.model}<div class="faint">{a.model}</div>{/if}</td>
								<td>{a.area ?? '—'}</td>
								<td>{#if a.channel === null}<span class="dash" title="No 2.4 GHz radio">—</span>{:else}{a.channel} · {a.width} MHz{#if a.overlaps} <span class="tag tag-accent">Overlaps Zigbee</span>{/if}{/if}</td>
								<td class="num">{pct(a.cuTotal)}</td>
								<td>{#if a.line}<Sparkline d={a.line} w={data.spark.w} h={data.spark.h} label={a.label} class="spark-sm" />{:else}<span class="dash">—</span>{/if}</td>
								<td class="num">{pct(a.own)}</td>
								<td class="num">{a.clients ?? '—'}</td>
								<td>{a.changedAt ? formatTime(a.changedAt, data.tz) : '—'}</td>
								<td>{#if a.match}<a href="/devices?q={encodeURIComponent(a.match)}">{a.zigbeeDevices} {a.zigbeeDevices === 1 ? 'device' : 'devices'}</a>{:else}—{/if}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div></div>
			{#if zc === null}<p class="muted">Overlap is not judged until Zigbee2MQTT reports its channel.</p>{/if}
		{/if}
	{/if}
</div>
