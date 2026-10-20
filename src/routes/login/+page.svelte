<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';
	import MeshArt from '../../lib/components/MeshArt.svelte';

	let { form }: PageProps = $props();
</script>

<div class="login">
	<div class="login-panel">
		<div class="brand"><svg class="i brand-mark"><use href="#i-pulse" /></svg>MeshPulse</div>
		<div class="stack">
			<h1>Sign in</h1>
			<p class="muted">Zigbee mesh health for this home.</p>
		</div>
		<form class="stack" method="post" action="?/login" use:enhance style="gap: 16.8px">
			{#if form?.error}<div class="form-error" role="alert"><svg class="i"><use href="#i-crit" /></svg><div>{form.error}</div></div>{/if}
			<div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="username" required value={form?.email ?? ''} /></div>
			<div class="field"><label for="pw">Password</label><input class="input" id="pw" name="password" type="password" autocomplete="current-password" required aria-invalid={form?.error ? 'true' : undefined} /></div>
			<div class="form-actions"><button class="btn btn-primary" style="min-width: 120px">Sign in</button></div>
		</form>
	</div>
	<MeshArt />
</div>
