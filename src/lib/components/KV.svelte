<script lang="ts">
	let { rows }: { rows: [string, string | { text: string; href: string }[]][] } = $props();
</script>

<dl class="kv">
	{#each rows as [k, v], n (n)}
		<dt>{k}</dt>
		<dd>{#if typeof v === 'string'}{#each v.split('\n') as line, j (j)}{#if j}<br />{/if}{line}{/each}{:else}{#each v as l, i (i)}{#if i}, {/if}<a href={l.href}>{l.text}</a>{/each}{/if}</dd>
	{/each}
</dl>
