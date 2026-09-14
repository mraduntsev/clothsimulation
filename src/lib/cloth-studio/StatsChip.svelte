<script lang="ts">
	import type { ClothStats } from '$lib/cloth/main';

	interface Props {
		stats: ClothStats;
		ready: boolean;
	}

	let { stats, ready }: Props = $props();
</script>

<dl
	class="bg-surface/80 text-muted rounded-md px-3 py-2 font-mono text-xs tracking-wide tabular-nums shadow-[0_0_0_1px_rgb(255_255_255/0.08)]"
>
	<div class="flex justify-between gap-6">
		<dt>FPS</dt>
		<dd class="text-fg">{ready ? stats.fps.toFixed(0) : '—'}</dd>
	</div>
	<div class="flex justify-between gap-6">
		<dt>t</dt>
		<dd class="text-fg">{stats.simTime.toFixed(2)} s</dd>
	</div>
	<div class="flex justify-between gap-6">
		<dt>сетка</dt>
		<dd class="text-fg">{stats.resolution}×{stats.resolution}</dd>
	</div>
</dl>
