<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Icons from '../lib/components/Icons.svelte';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();
	const links = $derived<[ '/' | '/devices' | '/batteries' | '/issues' | '/events' | '/wifi' | '/settings', string][]>([['/', 'Overview'], ['/devices', 'Devices'], ['/batteries', 'Batteries'], ['/issues', 'Issues'], ['/events', 'Events'], ...(data.wifi ? [['/wifi', 'Wi-Fi'] as ['/wifi', string]] : []), ['/settings', 'Settings']]);
	// route ids, not URLs: correct under any base path (Home Assistant ingress)
	const current = (href: string) => (href === '/' ? page.route.id === '/' : page.route.id?.startsWith(href) ?? false);

	const hm = (ms: number | null) => (ms === null ? '—' : new Date(ms).toLocaleTimeString('en-GB', { timeZone: data.tz, hour: '2-digit', minute: '2-digit' }));
	const hms = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: data.tz });
	// Client clock for "Updated N s ago"; null until hydrated so SSR shows the absolute time.
	let tick: number | null = $state(null);
	const sec = $derived(tick === null ? null : Math.max(0, Math.floor((tick - data.now) / 1000)));
	const staleMin = $derived(Math.max(0, Math.floor(((tick ?? data.now) - (data.nav.staleSince ?? data.now)) / 60_000)));
	const sevClass = $derived(data.nav.worst === 'critical' ? 'is-crit' : data.nav.worst === 'warning' ? 'is-warn' : data.nav.worst === 'info' ? 'is-info' : 'is-ok');

	$effect(() => {
		data.now;
		tick = Date.now();
		const t = setInterval(() => (tick = Date.now()), 1000);
		return () => clearInterval(t);
	});

	$effect(() => {
		if (page.route.id === '/login') return;
		const timer = setInterval(() => invalidateAll(), 15_000);
		return () => clearInterval(timer);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>MeshPulse</title>
</svelte:head>

<div class="mp">
	<Icons />
	{#if data.user}
		<header class="topnav {sevClass}">
			<a class="brand" href={resolve('/')}><svg class="i brand-mark"><use href="#i-pulse" /></svg>MeshPulse</a>
			<nav aria-label="Main">
				<ul class="navlinks">
					{#each links as [href, label] (href)}
						<li>
							<a href={resolve(href)} aria-current={current(href) ? 'page' : undefined}>{label}{#if href === '/issues' && data.nav.count > 0}<span class="nav-count {sevClass}" aria-label="{data.nav.count} unresolved">{data.nav.count}</span>{/if}</a>
						</li>
					{/each}
				</ul>
			</nav>
			<div class="nav-end">
				<span class="updated" class:is-stale={data.nav.stale} role="status" aria-live="off">
					<span class="updated-dot"></span>
					{#if data.nav.neverConnected}Not connected{:else if data.nav.stale}Stale · last update {hm(data.lastMessageAt ?? data.nav.staleSince)}{:else if sec === null}Updated {hms(data.now)}{:else}Updated {sec} s ago{/if}
				</span>
				{#if !data.addon}<form method="post" action="{resolve('/login')}?/logout"><button class="btn btn-sm" type="submit"><svg class="i"><use href="#i-signout" /></svg><span class="signout-label">Sign out</span></button></form>{/if}
			</div>
		</header>
		{#if data.nav.stale && !(data.nav.neverConnected && page.data.setup)}
			<div class="monitor-alert stale-note" role="alert">
				<svg class="i"><use href="#i-unlink" /></svg>
				{#if data.nav.neverConnected}
					<span><strong>MeshPulse hasn't connected to the MQTT broker yet.</strong> The Overview shows why.</span>
				{:else}
					<span><strong>MeshPulse lost its MQTT connection {staleMin} min ago.</strong> Nothing on this page is live — data is frozen at {hm(data.lastMessageAt ?? data.nav.staleSince)}.</span>
				{/if}
			</div>
		{/if}
	{/if}

	<main>
		{@render children()}
	</main>
</div>
