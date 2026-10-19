<script lang="ts">
	let { rows }: { rows: [string, string | { text: string; href: string }[]][] } = $props();
</script>

<dl class="kv">
	{#each rows as [k, v] (k)}
		<dt>{k}</dt>
		<dd>{#if typeof v === 'string'}{v}{:else}{#each v as l, i (l.href)}{#if i}, {/if}<a href={l.href}>{l.text}</a>{/each}{/if}</dd>
	{/each}
</dl>
