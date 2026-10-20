<script lang="ts">
	import { resolve } from '$app/paths';
	import Sparkline from '../../lib/components/Sparkline.svelte';
	import { formatDaysLeft, formatTime, formatVoltage, type BatteryRow } from '../../lib/views';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const emptyAround = (days: number) => formatTime(data.now + days * 86_400_000, data.tz).replace(/,? \d{1,2}:\d{2}$/, '');
</script>

{#snippet table(rows: BatteryRow[])}
	<div class="dt-wrap"><div class="dt-scroll">
		<table class="dt compact">
			<thead><tr>
				<th scope="col"><span>Name</span></th><th scope="col"><span>Type</span></th><th scope="col"><span>Days left</span></th><th scope="col"><span>Empty around</span></th>
				<th scope="col" class="num"><span>Battery</span></th><th scope="col" class="num"><span>Voltage</span></th>
				<th scope="col"><span>30-day trend</span></th><th scope="col"><span>Last swap</span></th>
			</tr></thead>
			<tbody>
				{#each rows as r (r.ieee)}
					<tr class={r.daysLeft !== null && r.daysLeft <= 7 ? 'is-flagged is-warn' : ''}>
						<td class="name"><a href={resolve('/devices/[ieee]', { ieee: r.ieee })}>{r.name}</a></td>
						<td>{r.batteryType ? `${r.batteryType.type} ×${r.batteryType.cells}` : '—'}</td>
						<td>{r.daysLeft === null ? '—' : formatDaysLeft(r.daysLeft)}</td>
						<td>{r.daysLeft === null ? '—' : emptyAround(r.daysLeft)}</td>
						<td class="num">{r.battery === null ? '—' : `${Math.round(r.battery)} %`}</td>
						<td class="num">{r.voltage === null ? '—' : `${formatVoltage(r.voltage)} V`}</td>
						<td>{#if r.trend}<Sparkline d={r.trend} w={data.spark.w} h={data.spark.h} label={data.labels[r.ieee]} class="spark-sm" />{:else}<span class="dash">—</span>{/if}</td>
						<td>{formatTime(r.lastSwapAt, data.tz)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div></div>
{/snippet}

<div class="page">
	<div class="page-head">
		<div>
			<h1>Batteries</h1>
			<p class="sub">{data.total} battery devices · {data.soon.length} need a new battery within 30 days.</p>
		</div>
	</div>

	{#if data.total}
		{@const s = data.shopping}
		<section aria-labelledby="bat-shop" class="panel panel-pad stack" style="gap:11px">
			<h2 id="bat-shop">Shopping list</h2>
			{#if !s.buy.length && !s.recharge.length && !s.unknown.length}
				<p class="muted">Nothing to buy in the next 30 days.</p>
			{:else}
				<dl class="kv">
					{#if s.buy.length}<dt>Buy</dt><dd class="stack" style="gap:4px">{#each s.buy as g (g.type)}<span><strong>{g.type} ×{g.count}</strong> <span class="muted">· {#each g.devices as d, i (d.ieee)}{i ? ', ' : ''}<a href={resolve('/devices/[ieee]', { ieee: d.ieee })}>{d.name}</a>{/each}</span></span>{/each}</dd>{/if}
					{#if s.recharge.length}<dt>Recharge</dt><dd>{#each s.recharge as d, i (d.ieee)}{i ? ', ' : ''}<a href={resolve('/devices/[ieee]', { ieee: d.ieee })}>{d.name}</a>{/each}</dd>{/if}
					{#if s.unknown.length}<dt>Type unknown</dt><dd>{#each s.unknown as d, i (d.ieee)}{i ? ', ' : ''}<a href={resolve('/devices/[ieee]', { ieee: d.ieee })}>{d.name}</a>{/each} <span class="muted">· set the type on the device page</span></dd>{/if}
				</dl>
			{/if}
		</section>
		{#if !data.anyForecast}<p class="muted">No forecasts yet — forecasts need 7 days of battery history.</p>{/if}
		<section aria-labelledby="bat-soon" class="stack">
			<div class="section-head"><h2 id="bat-soon">Buy within 30 days <span class="faint">{data.soon.length}</span></h2></div>
			{#if data.soon.length}{@render table(data.soon)}{:else}<p class="muted">Nothing due.</p>{/if}
		</section>
		<section aria-labelledby="bat-later" class="stack">
			<div class="section-head"><h2 id="bat-later">Later <span class="faint">{data.later.length + data.none.length}</span></h2></div>
			{#if data.later.length || data.none.length}{@render table([...data.later, ...data.none])}{:else}<p class="muted">Nothing here.</p>{/if}
		</section>
	{:else}
		<p class="muted">No battery devices yet.</p>
	{/if}
</div>
