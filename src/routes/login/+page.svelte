<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<section class="login">
	<h1>MeshPulse</h1>
	<form method="post" action="?/login" use:enhance>
		{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
		<label>Email <input name="email" type="email" autocomplete="username" required value={form?.email ?? ''} /></label>
		<label>Password <input name="password" type="password" autocomplete="current-password" required /></label>
		<button>Sign in</button>
	</form>
</section>
