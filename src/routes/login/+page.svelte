<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
	// decorative mesh: coordinator, routers and end devices
	const nodes: [number, number, number, string][] = [[400, 400, 14, 'n-coord'], [250, 250, 9, 'n-router'], [560, 270, 9, 'n-router'], [270, 560, 9, 'n-router'], [590, 540, 9, 'n-router'],
		[140, 180, 5, 'n'], [330, 130, 5, 'n'], [680, 180, 5, 'n'], [700, 380, 5, 'n'], [150, 420, 5, 'n'], [120, 640, 5, 'n'], [400, 690, 5, 'n'], [720, 650, 5, 'n']];
	const edges = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 5], [1, 6], [2, 7], [2, 8], [1, 9], [3, 10], [3, 11], [4, 12], [4, 8]];
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
	<div class="login-art" aria-hidden="true">
		<svg viewBox="0 0 800 800" preserveAspectRatio="xMidYMid slice" class="map">
			{#each edges as [a, b] (a + '-' + b)}<line class="e" x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]} />{/each}
			{#each nodes as [x, y, r, cls] (x + '-' + y)}<circle class={cls} cx={x} cy={y} r={r} />{/each}
		</svg>
	</div>
</div>
