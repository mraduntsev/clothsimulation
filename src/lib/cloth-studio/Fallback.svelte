<script lang="ts">
	interface Props {
		message: string;
	}

	let { message }: Props = $props();

	const n = 12;
	const cells: string[] = [];
	for (let j = 0; j < n; j++) {
		for (let i = 0; i < n; i++) {
			const x = 20 + (i / (n - 1)) * 260;
			const y = 24 + (j / (n - 1)) * 140 + Math.sin((i + j) * 0.6) * 6;
			cells.push(`${x},${y}`);
		}
	}
	const lines: string[] = [];
	for (let j = 0; j < n; j++) {
		const row: string[] = [];
		for (let i = 0; i < n; i++) row.push(cells[j * n + i]);
		lines.push(row.join(' '));
	}
	for (let i = 0; i < n; i++) {
		const col: string[] = [];
		for (let j = 0; j < n; j++) col.push(cells[j * n + i]);
		lines.push(col.join(' '));
	}
</script>

<div class="bg-bg absolute inset-0 flex items-center justify-center p-6">
	<div class="bg-surface w-full max-w-lg rounded-xl p-6 shadow-[0_0_0_1px_rgb(255_255_255/0.08)]">
		<h1 class="text-xl font-medium tracking-tight">Нужен WebGPU или WebGL2</h1>
		<p class="text-muted mt-3 text-sm leading-relaxed">{message}</p>
		<p class="text-muted mt-3 text-sm leading-relaxed">
			Основной путь — WebGPU compute. Если адаптера нет, симуляция идёт на CPU и рисуется через
			WebGL2. Откройте Chrome, Edge или Safari с аппаратным ускорением.
		</p>
		<svg viewBox="0 0 300 180" class="text-muted mt-5 w-full" aria-hidden="true">
			{#each lines as pts, k (k)}
				<polyline
					fill="none"
					stroke="currentColor"
					stroke-width="0.7"
					points={pts}
					opacity="0.45"
				/>
			{/each}
		</svg>
	</div>
</div>
