<script lang="ts">
	import type { Snippet } from 'svelte';

	let { label, value, total, sub, tone, wide = false, href, children }: {
		label: string; value: string; total?: string; sub?: string; tone?: 'ok' | 'warn' | 'crit'; wide?: boolean; href?: string; children?: Snippet;
	} = $props();
	const cls = { ok: 'is-ok', warn: 'has-sev is-warn', crit: 'has-sev is-crit' } as const;
</script>

<svelte:element this={href ? 'a' : 'div'} {href} class="tile {tone ? cls[tone] : ''}" class:tile-wide={wide}>
	<div class="tile-label">{label}</div>
	<div class="tile-value">{value}{#if total}<small> / {total}</small>{/if}</div>
	{#if sub}<div class="tile-sub">{#if tone === 'warn' || tone === 'crit'}<svg class="i" aria-hidden="true"><use href="#i-{tone === 'crit' ? 'crit' : 'warn'}" /></svg>{/if}{sub}</div>{/if}
	{@render children?.()}
</svelte:element>
