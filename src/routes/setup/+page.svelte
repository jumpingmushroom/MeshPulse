<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
	const bad = (f: string) => (form && 'field' in form && form.field === f ? 'true' : undefined);
	const msg = (f: string) => (bad(f) ? form?.error : '');
</script>

<div class="login">
	<div class="login-panel">
		<div class="brand"><svg class="i brand-mark"><use href="#i-pulse" /></svg>MeshPulse</div>
		<div class="stack">
			<h1>Create the admin account</h1>
			<p class="muted">MeshPulse has no account yet. This one manages everything; you can't add more later.</p>
		</div>
		<form class="stack" method="post" use:enhance style="gap: 16.8px">
			{#if form?.error && !bad('email') && !bad('password') && !bad('confirm')}<div class="form-error" role="alert"><svg class="i"><use href="#i-crit" /></svg><div>{form.error}</div></div>{/if}
			<div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="username" required value={form?.email ?? ''} aria-invalid={bad('email')} />{#if bad('email')}<div class="field-error" role="alert">{msg('email')}</div>{/if}</div>
			<div class="field"><label for="pw">Password</label><input class="input" id="pw" name="password" type="password" autocomplete="new-password" required minlength="12" aria-invalid={bad('password')} /><div class="field-help">At least 12 characters</div>{#if bad('password')}<div class="field-error" role="alert">{msg('password')}</div>{/if}</div>
			<div class="field"><label for="confirm">Confirm password</label><input class="input" id="confirm" name="confirm" type="password" autocomplete="new-password" required aria-invalid={bad('confirm')} />{#if bad('confirm')}<div class="field-error" role="alert">{msg('confirm')}</div>{/if}</div>
			<div class="form-actions"><button class="btn btn-primary" style="min-width: 120px">Create account</button></div>
		</form>
	</div>
</div>
