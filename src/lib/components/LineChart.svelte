<script lang="ts">
	import { buildSeries, niceTicks, xy, type Point } from '../chart';
	import { formatDuration } from '../views';

	let { title, unit, points, t0, t1, y0, y1, maxGapMs, refs = [], summary, latest, integer = false }: {
		title: string; unit: string; points: Point[]; t0: number; t1: number; y0: number; y1: number;
		maxGapMs: number; refs?: { y: number; label: string }[]; summary: string;
		latest?: string; integer?: boolean; // integer: whole-number ticks (counts)
	} = $props();

	// plot area inside a fixed viewBox; the SVG scales to the container width
	const [W, H, L, T] = [600, 140, 40, 8];
	const box = $derived({ w: W, h: H, t0, t1, y0, y1 });
	const s = $derived(buildSeries(points, box, maxGapMs));
	const ticks = $derived(niceTicks(y0, y1, 4, integer ? 1 : 0));
	const last = $derived(points.findLast((p) => p.v !== null && Number.isFinite(p.v)));
	const end = $derived(last ? xy(box, last.t, last.v!) : null);
	const y = (v: number) => xy(box, t0, v)[1];
</script>

<figure class="chart">
	<figcaption>{title}{unit ? ` (${unit})` : ''}{#if latest}<span class="muted">{` · latest ${latest}`}</span>{/if}</figcaption>
	{#if s.empty}
		<p class="muted">No data yet</p>
	{:else}
		<svg viewBox="0 0 {L + W + 8} {T + H + 20}" role="img" aria-label={summary}>
			<g transform="translate({L},{T})">
				{#each ticks as v (v)}
					<line class="grid" x1="0" x2={W} y1={y(v)} y2={y(v)} />
					<text class="tick" x="-6" y={y(v)} text-anchor="end" dominant-baseline="middle">{v}</text>
				{/each}
				{#if s.band}<path class="band" d={s.band} />{/if}
				<path class="line" d={s.line} />
				{#if end}<circle class="dot" cx={end[0]} cy={end[1]} r="4" />{/if}
				{#each refs as ref (ref.label)}
					<line class="ref" x1="0" x2={W} y1={y(ref.y)} y2={y(ref.y)} />
					<text class="tick" x={W - 4} y={y(ref.y) - 4} text-anchor="end">{ref.label}</text>
				{/each}
				<text class="tick" x="0" y={H + 16}>{formatDuration(t1 - t0)} ago</text>
				<text class="tick" x={W} y={H + 16} text-anchor="end">now</text>
			</g>
		</svg>
	{/if}
</figure>
