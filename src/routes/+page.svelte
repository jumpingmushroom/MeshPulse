<script lang="ts">
	import { onMount } from 'svelte';
	import IssueRow from '../lib/components/IssueRow.svelte';
	import ScoreRing from '../lib/components/ScoreRing.svelte';
	import Sparkline from '../lib/components/Sparkline.svelte';
	import Tile from '../lib/components/Tile.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const c = $derived(data.counters);
	const b = $derived(data.bridge);
	const bn = $derived(data.banner);
	const L = $derived(data.learning);
	const PREREQ = { availability: 'Availability is off', health: 'Health checks are off', mqtt_log: 'Logging to MQTT is off' };
	const TONE = { ok: ['is-ok', 'ok'], warn: ['is-warn', 'warn'], crit: ['is-crit', 'crit'] } as const;
	let js = $state(false);
	let copied = $state('');
	onMount(() => (js = true));
	async function copy(key: string, text: string) {
		await navigator.clipboard.writeText(text);
		copied = key;
	}
	const batTone = $derived(data.nextBattery ? (data.nextBattery.days <= 7 ? 'warn' : undefined) : undefined);
</script>

<div class="page">
	<section class="banner {TONE[bn.tone][0]}" aria-labelledby="status-title">
		<div class="banner-icon"><svg class="i" aria-hidden="true"><use href="#i-{TONE[bn.tone][1]}" /></svg></div>
		<div>
			{#if bn.tone !== 'ok'}<div class="banner-kicker">{bn.kicker}</div>{/if}
			<h1 class="banner-title" id="status-title">{bn.title}</h1>
			<p class="banner-sub">{bn.sub}</p>
			{#if !L.done}
				<p class="learning"><span class="learning-bar"><i style="width:{Math.min(100, (L.hours / 72) * 100)}%"></i></span>Learning baselines · {L.hours} h of 3 days</p>
			{/if}
		</div>
		<ScoreRing status={L.done ? data.status : 'learning'} score={data.score} />
	</section>

	{#each data.prereqs as p (p.key)}
		<div class="prereq" role="note">
			<svg class="i" aria-hidden="true"><use href="#i-info" /></svg>
			<div>
				<div class="prereq-title">{PREREQ[p.key]} in Zigbee2MQTT</div>
				<div class="prereq-body">MeshPulse misses problems until you add this to <code>configuration.yaml</code> and restart Zigbee2MQTT:</div>
			</div>
			<div class="prereq-code">
				<pre>{p.fix}</pre>
				{#if js}<button class="btn btn-sm" type="button" onclick={() => copy(p.key, p.fix)}>{copied === p.key ? 'Copied' : 'Copy'}</button>{/if}
			</div>
			<div class="prereq-foot">This notice clears on its own once the setting is detected.</div>
		</div>
	{/each}

	{#if data.issues.length}
		<section aria-labelledby="open-h">
			<div class="section-head">
				<h2 id="open-h">Open issues <span class="count">{data.topLevel}</span></h2>
				<a href="/issues" class="crumb">All issues →</a>
			</div>
			<div class="issues">
				{#each data.issues as i (i.id)}
					<IssueRow issue={i} now={data.now} children={i.children} />
				{/each}
			</div>
		</section>
	{/if}

	<section class="tiles" aria-label="Network counters">
		<Tile label="Devices online" value={String(c.devicesOnline)} total={String(c.devicesTotal)}
			tone={data.offline ? 'crit' : undefined} sub={data.offline ? `${data.offline} offline${data.unknown ? ` · ${data.unknown} unknown` : ''}` : data.unknown ? `${data.unknown} unknown` : 'All online'} />
		<Tile label="Routers online" value={String(c.routersOnline)} total={String(c.routersTotal)}
			tone={c.routersOnline < c.routersTotal ? 'crit' : undefined} sub={c.routersOnline < c.routersTotal ? `${c.routersTotal - c.routersOnline} offline` : 'All routers up'} />
		<Tile label="Low batteries" value={String(c.batteriesLow)} tone={c.batteriesLow ? 'warn' : undefined}
			sub={data.nextBattery ? `Soonest: ${data.nextBattery.name}, ${data.nextBattery.days} ${data.nextBattery.days === 1 ? 'day' : 'days'}` : 'No forecast within 30 days'} />
		<Tile label="Network messages per minute · 24 h" value={data.peakQuiet?.now === null || !data.peakQuiet ? '—' : `${data.peakQuiet.now}/min`} wide
			sub={data.peakQuiet ? `24 h · peak ${data.peakQuiet.peak} · quietest ${data.peakQuiet.quiet}` : 'Not enough history yet'}>
			{#if data.spark.d}<Sparkline d={data.spark.d} w={data.spark.w} h={data.spark.h} label={data.spark.summary} />{/if}
		</Tile>
	</section>

	<div class="statusline">
		<span class={b.state === 'online' ? 'ok' : 'bad'}><svg class="i" aria-hidden="true"><use href="#i-{b.state === 'online' ? 'ok' : 'crit'}" /></svg>Bridge {b.state ?? 'unknown'}</span>
		{#if b.version}<span>Zigbee2MQTT {b.version}</span>{/if}
		{#if b.uptime}<span>up {b.uptime}</span>{/if}
		{#if b.channel}<span>Channel {b.channel}</span>{/if}
		{#if b.coordinator}<span>Coordinator {b.coordinator}</span>{/if}
	</div>
</div>
