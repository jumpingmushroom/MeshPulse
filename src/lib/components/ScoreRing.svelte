<script lang="ts">
	import { scoreLabel, type Status } from '../views';

	let { status, score }: { status: Status | 'learning'; score: number } = $props();
	const C = 2 * Math.PI * 31;
	const cls = { green: 'is-ok', amber: 'is-warn', red: 'is-crit', learning: 'is-info' } as const;
	const label = $derived(status === 'learning' ? 'Learning' : scoreLabel(status));
	const dash = $derived(status === 'learning' ? 0 : (C * Math.max(0, Math.min(100, score))) / 100);
</script>

<div class="score {cls[status]}" role="img" aria-label={status === 'learning' ? 'Health score not available yet' : `Health score ${label}`}>
	<svg class="score-ring" viewBox="0 0 72 72" aria-hidden="true">
		<circle class="track" cx="36" cy="36" r="31" fill="none" stroke-width="6" />
		<circle class="val" cx="36" cy="36" r="31" fill="none" stroke-width="6" stroke-dasharray="{dash.toFixed(1)} {C.toFixed(1)}" />
	</svg>
	<div class="score-label"><b>{label}</b>Health score</div>
</div>
