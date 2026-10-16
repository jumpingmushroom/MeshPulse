<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();
	const links = [['/', 'Overview'], ['/devices', 'Devices'], ['/issues', 'Issues'], ['/settings', 'Settings']];

	$effect(() => {
		if (page.url.pathname === '/login') return;
		const timer = setInterval(() => invalidateAll(), 15_000);
		return () => clearInterval(timer);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>MeshPulse</title>
</svelte:head>

{#if data.user}
	<header>
		<nav aria-label="Main">
			<strong>MeshPulse</strong>
			{#each links as [href, label] (href)}
				<a {href} aria-current={(href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href)) ? 'page' : undefined}>{label}</a>
			{/each}
			<form method="post" action="/login?/logout"><button>Sign out</button></form>
		</nav>
	</header>
{/if}

<main>
	{@render children()}
</main>
