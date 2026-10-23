<script lang="ts">
	import { enhance } from '$app/forms';
	import { FOREVER, formatTime } from '../views';

	// without a visible `label` the select gets a screen-reader one
	let { action, id, muted, tz, label }: { action: string; id: string; muted: number | null; tz: string; label?: string } = $props();
</script>

<form class="mute" method="post" {action} use:enhance>
	{#if label}<label class="field-label" for={id}>{label}</label>{/if}
	<div class="mute-status" class:is-muted={muted}>{muted === FOREVER ? 'Muted forever' : muted ? `Muted until ${formatTime(muted, tz)}` : 'Not muted'}</div>
	<div class="mute-row">
		{#if !label}<label class="sr-only" for={id}>Mute for</label>{/if}
		<select class="select" {id} name="duration">
			<option value="1h">1 hour</option><option value="24h">24 hours</option>
			<option value="7d">7 days</option><option value="forever">forever</option>
			{#if muted}<option value="unmute">unmute</option>{/if}
		</select>
		<button class="btn">Mute</button>
	</div>
</form>
