<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { focusBox, neighbours, zoomAt, type ViewBox } from '../../lib/map';
	import { formatAgo, formatTime } from '../../lib/views';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const { now, tz } = $derived(data);
	const R = { Coordinator: 14, Router: 7, EndDevice: 4.5 } as const;
	const CLS = { Coordinator: 'n n-coord', Router: 'n n-router', EndDevice: 'n' } as const;
	const type = (t: string) => t as keyof typeof R;
	const at = $derived(new Map((data.scan?.nodes ?? []).map((n) => [n.ieee, n])));

	// interactivity is progressive enhancement: without JS the static SVG and links stay
	const W = 1100, H = 760, LIMITS = { w: W, h: H, min: 1, max: 8 };
	const BASE: ViewBox = { x: 0, y: 0, w: W, h: H };
	const TYPE = { Coordinator: 'Coordinator', Router: 'Router', EndDevice: 'End device' } as const;
	let js = $state(false);
	onMount(() => (js = true));
	let vb = $state<ViewBox>(BASE);
	let selected = $state<string | null>(null);
	let svg = $state<SVGSVGElement>();
	let px = $state(1100);
	const zoom = $derived(W / vb.w);
	const fs = $derived((11 * vb.w) / px);
	const near = $derived(selected ? neighbours(data.scan?.edges ?? [], selected) : new Set<string>());
	const sel = $derived(selected ? at.get(selected) : undefined);
	const selParent = $derived(data.scan?.edges.find((e) => e.from === selected));
	const selKids = $derived(data.scan?.edges.filter((e) => e.to === selected).length ?? 0);
	const inView = (n: { x: number; y: number }) => n.x >= vb.x && n.x <= vb.x + vb.w && n.y >= vb.y && n.y <= vb.y + vb.h;
	const labelled = $derived(new Set(data.scan?.labels.map((l) => l.ieee)));
	const extraLabels = $derived((data.scan?.nodes ?? []).filter((n) => !labelled.has(n.ieee) && (zoom >= 2.5 ? inView(n) : selected !== null && (n.ieee === selected || near.has(n.ieee)))));

	const toMap = (cx: number, cy: number) => {
		const r = svg!.getBoundingClientRect();
		return { x: vb.x + ((cx - r.left) / r.width) * vb.w, y: vb.y + ((cy - r.top) / r.height) * vb.h };
	};
	const zoomBy = (f: number, p = { x: vb.x + vb.w / 2, y: vb.y + vb.h / 2 }) => (vb = zoomAt(vb, f, p, LIMITS));
	const select = (ieee: string | null) => (selected = ieee);
	const find = (name: string) => {
		const n = data.scan?.nodes.find((m) => m.name === name);
		if (n) { select(n.ieee); vb = focusBox(n, 3, W, H); }
	};

	const ptrs = new Map<number, { x: number; y: number }>();
	let moved = 0, pinch = 0;
	const down = (e: PointerEvent) => { ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptrs.size === 1) moved = 0; pinch = 0; };
	const move = (e: PointerEvent) => {
		const last = ptrs.get(e.pointerId);
		if (!last) return;
		const cur = { x: e.clientX, y: e.clientY };
		if (ptrs.size === 2) {
			const [a, b] = [...ptrs.values()];
			const d0 = Math.hypot(a.x - b.x, a.y - b.y);
			ptrs.set(e.pointerId, cur);
			const [c, d] = [...ptrs.values()];
			const d1 = Math.hypot(c.x - d.x, c.y - d.y);
			moved = 99;
			if (d0 > 0 && d1 > 0) zoomBy(d1 / d0, toMap((c.x + d.x) / 2, (c.y + d.y) / 2));
			return;
		}
		moved += Math.abs(cur.x - last.x) + Math.abs(cur.y - last.y);
		if (moved <= 4) return;
		ptrs.set(e.pointerId, cur);
		svg!.setPointerCapture(e.pointerId);
		const k = vb.w / svg!.getBoundingClientRect().width;
		vb = zoomAt({ ...vb, x: vb.x - (cur.x - last.x) * k, y: vb.y - (cur.y - last.y) * k }, 1, { x: 0, y: 0 }, LIMITS);
	};
	const up = (e: PointerEvent) => { ptrs.delete(e.pointerId); };
	// a drag that moved is a pan: swallow the click that follows it
	const clickNode = (e: MouseEvent, ieee: string) => {
		if (e.ctrlKey || e.metaKey || e.shiftKey) return;
		e.preventDefault();
		e.stopPropagation();
		if (moved <= 4) select(ieee);
	};
	const clickBg = () => { if (moved <= 4) select(null); };
	const key = (e: KeyboardEvent) => {
		if (e.key === '+' || e.key === '=') zoomBy(1.5);
		else if (e.key === '-') zoomBy(1 / 1.5);
		else if (e.key === '0') vb = BASE;
		else if (e.key === 'Escape') select(null);
	};
	$effect(() => {
		if (!svg) return;
		const wheel = (e: WheelEvent) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.002), toMap(e.clientX, e.clientY)); };
		svg.addEventListener('wheel', wheel, { passive: false });
		return () => svg!.removeEventListener('wheel', wheel);
	});
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
		{#if js}
			<div class="search" style="max-width:320px">
				<svg class="i"><use href="#i-search" /></svg>
				<input class="input" type="search" list="map-names" placeholder="Find a device" aria-label="Find a device" oninput={(e) => find(e.currentTarget.value)} />
				<datalist id="map-names">{#each scan.nodes as n (n.ieee)}<option value={n.name}></option>{/each}</datalist>
			</div>
		{/if}
		<div class="split">
			<div class="panel map-wrap" style="padding:8px">
				{#if js}
					<div class="seg map-tools" role="group" aria-label="Zoom">
						<button type="button" aria-label="Zoom in" onclick={() => zoomBy(1.5)}>+</button>
						<button type="button" aria-label="Zoom out" onclick={() => zoomBy(1 / 1.5)}>−</button>
						<button type="button" onclick={() => (vb = BASE)}>Reset</button>
					</div>
				{/if}
				<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
				<svg bind:this={svg} bind:clientWidth={px} class="map" class:has-sel={selected !== null} viewBox="{vb.x} {vb.y} {vb.w} {vb.h}" role="group" tabindex={js ? 0 : undefined}
					onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onclick={clickBg} onkeydown={key} aria-label="Network map of {scan.nodes.length} devices. {scan.offline.length} did not answer the scan.">
					{#each scan.edges as e (e.from)}
						{@const a = at.get(e.from)!}
						{@const b = at.get(e.to)!}
						<line class="{e.weak ? 'e e-weak' : 'e'}{selected ? (e.from === selected || e.to === selected ? ' hl' : ' dim') : ''}" x1={a.x} y1={a.y} x2={b.x} y2={b.y}><title>{e.name} → {e.parent}: LQI {e.lqi}</title></line>
					{/each}
					{#each scan.nodes as n (n.ieee)}
						{@const r = R[type(n.type)] + (n.failed ? 2 : 0)}
						<a href="/devices/{n.ieee}" class:dim={selected !== null && n.ieee !== selected && !near.has(n.ieee)} class:sel={n.ieee === selected} onclick={(e) => clickNode(e, n.ieee)} aria-label="{n.name}, {n.type}{n.failed ? ', did not answer' : ''}{n.lqi === null ? '' : `, LQI ${n.lqi}`}">
							<circle class={n.failed ? 'n n-off' : CLS[type(n.type)]} cx={n.x} cy={n.y} r={r}></circle>
							{#if n.failed}<path class="x" d="M{n.x - r * 0.6} {n.y - r * 0.6} L{n.x + r * 0.6} {n.y + r * 0.6} M{n.x + r * 0.6} {n.y - r * 0.6} L{n.x - r * 0.6} {n.y + r * 0.6}"></path>{/if}
							<title>{n.name}{n.lqi === null ? '' : ` · LQI ${n.lqi}`}</title>
						</a>
					{/each}
					{#each scan.labels as l (l.ieee)}<text x={l.x} y={l.y} text-anchor={l.anchor} style="font-size:{fs}px" class:dim={selected !== null && l.ieee !== selected && !near.has(l.ieee)}>{at.get(l.ieee)?.name}</text>{/each}
					{#each extraLabels as n (n.ieee)}<text x={n.x + R[type(n.type)] + 3} y={n.y + 3} style="font-size:{fs}px">{n.name}</text>{/each}
				</svg>
			</div>
			<aside class="stack">
				{#if sel}
					<section class="panel panel-pad stack" aria-live="polite">
						<h2 style="font-size:13px">{sel.name}</h2>
						<p class="muted" style="font-size:13px">{TYPE[type(sel.type)]}{sel.failed ? ' · Did not answer' : ''}</p>
						{#if selParent}<p style="font-size:13px">Link to parent: LQI {selParent.lqi}<br />Parent: <a href="/devices/{selParent.to}">{selParent.parent}</a></p>{/if}
						{#if sel.type === 'Router'}<p style="font-size:13px">{selKids} {selKids === 1 ? 'device routes' : 'devices route'} through this router</p>{/if}
						<a href="/devices/{sel.ieee}" style="font-size:13px">Open device page →</a>
						<button type="button" class="btn btn-sm" onclick={() => select(null)}>Back to legend</button>
					</section>
				{:else}
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
				{/if}
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
