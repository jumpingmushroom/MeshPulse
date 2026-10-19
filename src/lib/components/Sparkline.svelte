<script lang="ts">
	let { d, w, h, label }: { d: string; w: number; h: number; label: string } = $props();
</script>

<svg class="spark" viewBox="0 0 {w} {h}" preserveAspectRatio="none" role="img" aria-label={label}><path class="line" {d} /></svg>
