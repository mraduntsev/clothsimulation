<script lang="ts">
	import { Info, Pause, Play, RotateCcw } from '@lucide/svelte';
	import type { ClothBackend } from '$lib/cloth/config';
	import type { ClothStats } from '$lib/cloth/main';
	import Legend from './Legend.svelte';
	import StatsChip from './StatsChip.svelte';
	import Slider from './Slider.svelte';

	interface Props {
		gravity: boolean;
		paused: boolean;
		amplitude: number;
		frequency: number;
		iterations: number;
		stats: ClothStats;
		ready: boolean;
		backend: ClothBackend | null;
		onGravity: (v: boolean) => void;
		onPaused: (v: boolean) => void;
		onAmplitude: (v: number) => void;
		onFrequency: (v: number) => void;
		onIterations: (v: number) => void;
		onReset: () => void;
		onDocs: () => void;
	}

	let {
		gravity,
		paused,
		amplitude,
		frequency,
		iterations,
		stats,
		ready,
		backend,
		onGravity,
		onPaused,
		onAmplitude,
		onFrequency,
		onIterations,
		onReset,
		onDocs
	}: Props = $props();
</script>

<header
	class="pointer-events-none absolute top-0 right-0 left-0 flex items-start justify-between gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]"
>
	<div
		class="bg-surface/80 pointer-events-auto max-w-[min(100%,22rem)] rounded-xl p-4 shadow-[0_0_0_1px_rgb(255_255_255/0.08)]"
	>
		<p class="text-muted font-mono text-xs tracking-[0.18em] uppercase">
			{backend === 'webgl' ? 'CPU · PBD · WebGL' : 'GPU · PBD · WebGPU'}
		</p>
		<h1 class="text-fg mt-1 font-sans text-xl leading-tight font-medium tracking-tight">
			Позиционная динамика ткани
		</h1>
		<p class="text-muted mt-2 hidden text-sm leading-snug sm:block">
			Центральная вершина задаётся кинематически:
			<span class="text-fg font-mono text-sm">z = A sin(2πft)</span>. Волны расходятся к
			закреплённым углам.
		</p>
	</div>

	<div class="pointer-events-auto flex flex-col items-end gap-2">
		<div class="flex items-center gap-2">
			<button
				type="button"
				onclick={onDocs}
				class="bg-surface/80 text-fg inline-flex size-11 items-center justify-center rounded-md shadow-[0_0_0_1px_rgb(255_255_255/0.08)] transition-opacity duration-150 hover:opacity-90"
				aria-label="О методе"
			>
				<Info class="size-4" strokeWidth={2} />
			</button>
		</div>
		<Legend />
		<div class="hidden sm:block">
			<StatsChip {stats} {ready} />
		</div>
	</div>
</header>

<div
	class="pointer-events-none absolute right-0 bottom-0 left-0 p-4 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]"
>
	<div
		class="bg-surface/85 pointer-events-auto mx-auto flex max-w-3xl flex-col gap-3 rounded-xl p-3 shadow-[0_0_0_1px_rgb(255_255_255/0.08)] sm:flex-row sm:items-center sm:gap-5 sm:p-4"
	>
		<div class="flex flex-wrap items-center gap-2">
			<button
				type="button"
				onclick={() => onPaused(!paused)}
				class="bg-accent text-accent-fg inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium transition-[transform,opacity] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] hover:opacity-90 active:scale-[0.98]"
			>
				{#if paused}
					<Play class="size-4 translate-x-px" strokeWidth={2} />
				{:else}
					<Pause class="size-4" strokeWidth={2} />
				{/if}
				<span class="hidden sm:inline">{paused ? 'Продолжить' : 'Пауза'}</span>
			</button>
			<button
				type="button"
				onclick={onReset}
				class="bg-surface-2 text-fg inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium shadow-[0_0_0_1px_rgb(255_255_255/0.1)] transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98]"
			>
				<RotateCcw class="size-4" strokeWidth={2} />
				<span class="hidden sm:inline">Сброс</span>
			</button>
			<label class="ml-1 flex h-11 cursor-pointer items-center gap-2.5 rounded-md px-2 select-none">
				<span class="relative inline-flex size-5 items-center justify-center">
					<input
						type="checkbox"
						class="peer sr-only"
						checked={gravity}
						onchange={(e) => onGravity(e.currentTarget.checked)}
					/>
					<span
						class="bg-surface-2 peer-checked:bg-accent peer-focus-visible:ring-accent/50 size-5 rounded-xs shadow-[0_0_0_1px_rgb(255_255_255/0.16)] transition-colors peer-checked:shadow-none peer-focus-visible:ring-2"
					></span>
					<span
						class="pointer-events-none absolute inset-0 hidden items-center justify-center peer-checked:flex"
					>
						<span class="border-accent-fg mb-px block h-2 w-1 rotate-45 border-r-2 border-b-2"
						></span>
					</span>
				</span>
				<span class="text-fg text-sm">Включить гравитацию</span>
			</label>
		</div>

		<div class="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
			<Slider
				label="Амплитуда"
				value={amplitude}
				min={0.1}
				max={2.2}
				step={0.05}
				format={(v) => v.toFixed(2)}
				onChange={onAmplitude}
			/>
			<Slider
				label="Частота, Гц"
				value={frequency}
				min={0.15}
				max={2.4}
				step={0.05}
				format={(v) => v.toFixed(2)}
				onChange={onFrequency}
			/>
			<Slider
				label="Итерации"
				value={iterations}
				min={4}
				max={24}
				step={1}
				format={(v) => String(Math.round(v))}
				onChange={(v) => onIterations(Math.round(v))}
			/>
		</div>
	</div>
	<p
		class="text-subtle pointer-events-none mt-2 hidden text-center font-mono text-xs tracking-wide sm:block"
	>
		Перетащите, чтобы вращать · колесо — масштаб · щипок на сенсоре
	</p>
</div>
