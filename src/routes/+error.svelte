<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
</script>

<div class="page">
	<div class="page-head">
		<div>
			{#if page.status === 404}
				<h1>Page not found</h1>
				<p class="sub">Nothing lives at this address.</p>
			{:else}
				<h1>Something went wrong</h1>
				<p class="sub">{page.error?.message}</p>
			{/if}
		</div>
		<a class="btn" href={resolve('/')}>Back to Overview</a>
	</div>
</div>
