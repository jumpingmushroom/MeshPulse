<script lang="ts">
	import { formatDaysLeft, formatTime, formatVoltage } from '../../lib/views';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<h1>Batteries</h1>
{#if data.rows.length}
	{#if !data.anyForecast}<p class="muted">No forecasts yet — forecasts need 7 days of battery history.</p>{/if}
	<div class="scroll"><table>
		<thead>
			<tr><th scope="col">Name</th><th scope="col">Battery %</th><th scope="col">Battery V</th><th scope="col">Days left</th><th scope="col">Last swap</th><th scope="col">30 days</th></tr>
		</thead>
		<tbody>
			{#each data.rows as r (r.ieee)}
				<tr>
					<td><a href="/devices/{r.ieee}">{r.name}</a></td>
					<td>{r.battery === null ? '—' : Math.round(r.battery)}</td>
					<td>{formatVoltage(r.voltage)}</td>
					<td>
						{r.daysLeft === null ? '—' : formatDaysLeft(r.daysLeft)}
						{#if r.low} <strong class="bad">Low now</strong>{:else if r.daysLeft !== null && r.daysLeft <= 30} <strong class="bad">Due soon</strong>{/if}
					</td>
					<td>{formatTime(r.lastSwapAt, data.tz)}</td>
					<td>
						{#if r.spark.d}
							<svg class="spark" viewBox="0 0 {data.spark.w} {data.spark.h}" width={data.spark.w} height={data.spark.h} role="img" aria-label={r.spark.summary}>
								<path d={r.spark.d} />
							</svg>
						{:else}<span class="muted">—</span>{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table></div>
{:else}
	<p>No battery devices yet.</p>
{/if}
