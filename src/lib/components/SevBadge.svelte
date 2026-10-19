<script lang="ts">
	import type { Severity } from '../server/types';

	let { severity, large = false }: { severity: Severity; large?: boolean } = $props();
	const m = { critical: ['is-crit', 'crit', 'Critical'], warning: ['is-warn', 'warn', 'Warning'], info: ['is-info', 'info', 'Info'] } as const;
	const [cls, icon, label] = $derived(m[severity]);
</script>

<span class="sev {cls}" class:sev-lg={large}><svg class="i" aria-hidden="true"><use href="#i-{icon}" /></svg>{label}</span>
