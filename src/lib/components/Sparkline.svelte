<script lang="ts">
	let { d, w, h, label, class: cls = '' }: { d: string; w: number; h: number; label: string; class?: string } = $props();
</script>

<svg class="spark {cls}" viewBox="0 0 {w} {h}" preserveAspectRatio="none" role="img" aria-label={label}><path class="line" {d} /></svg>
