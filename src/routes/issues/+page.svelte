<script lang="ts">
	import IssueRow from '../../lib/components/IssueRow.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const href = (over: Record<string, string>) => `?${new URLSearchParams({ tab: data.tab, rule: data.rule, sev: data.sev, ...over })}`;
</script>

<main class="page">
	<div class="page-head">
		<div>
			<h1>Issues</h1>
			<p class="sub">Acknowledging stops reminders. An issue stays listed until MeshPulse sees it resolve.</p>
		</div>
	</div>

	<nav class="tabs" aria-label="Issue state">
		{#each data.tabs as t (t.key)}
			<a href={href({ tab: t.key })} aria-current={data.tab === t.key ? 'page' : undefined}>{t.label}<span class="n">{t.n}</span></a>
		{/each}
	</nav>

	<form method="get" class="toolbar" aria-label="Filter issues">
		<input type="hidden" name="tab" value={data.tab} />
		<div class="field" style="flex-direction:row;align-items:center;gap:8px">
			<label for="rule" style="font-weight:400" class="muted">Rule</label>
			<select class="select" id="rule" name="rule" style="width:220px" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
				<option value="all" selected={data.rule === 'all'}>All rules</option>
				{#each data.rules as r (r.key)}<option value={r.key} selected={data.rule === r.key}>{r.label}</option>{/each}
			</select>
		</div>
		<div class="seg" role="group" aria-label="Severity">
			{#each data.sevs as s (s)}<a href={href({ sev: s })} aria-current={data.sev === s ? 'true' : undefined}>{s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}</a>{/each}
		</div>
		<input type="hidden" name="sev" value={data.sev} />
		<noscript><button class="btn btn-sm">Apply</button></noscript>
	</form>

	{#if data.issues.length}
		<div class="issues">
			{#each data.issues as i (i.id)}<IssueRow issue={i} now={data.now} />{/each}
		</div>
	{:else}
		<div class="panel"><div class="empty"><strong>No {data.tab} issues{data.rule !== 'all' || data.sev !== 'all' ? ' match these filters' : ''}</strong></div></div>
	{/if}
</main>
