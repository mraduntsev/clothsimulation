<script lang="ts">
	import { onMount } from 'svelte';
	import { CONFIG, type ClothBackend, type UiParams } from '$lib/cloth/config';
	import type { ClothController, ClothStats } from '$lib/cloth/main';
	import Hud from './Hud.svelte';
	import MethodSheet from './MethodSheet.svelte';
	import Fallback from './Fallback.svelte';

	const INITIAL: UiParams = {
		gravity: false,
		paused: false,
		amplitude: CONFIG.amplitude,
		frequency: CONFIG.frequency,
		iterations: CONFIG.solverIterations,
		damping: CONFIG.damping
	};

	const EMPTY_STATS: ClothStats = {
		fps: 0,
		simTime: 0,
		particles: CONFIG.resolution * CONFIG.resolution,
		constraints: 0,
		resolution: CONFIG.resolution,
		backend: 'webgpu'
	};

	let canvasEl: HTMLCanvasElement | undefined = $state();
	let controller: ClothController | null = null;

	let ready = $state(false);
	let error: string | null = $state(null);
	let backend: ClothBackend | null = $state(null);
	let gravity = $state(false);
	let paused = $state(false);
	let amplitude = $state(CONFIG.amplitude);
	let frequency = $state(CONFIG.frequency);
	let iterations = $state(CONFIG.solverIterations);
	let stats = $state<ClothStats>(EMPTY_STATS);
	let docsOpen = $state(false);

	onMount(() => {
		const canvas = canvasEl;
		if (!canvas) return;

		let cancelled = false;
		let ctrl: ClothController | undefined;

		(async () => {
			try {
				const { mountCloth } = await import('$lib/cloth/main');
				if (cancelled) return;
				ctrl = await mountCloth(canvas, { ...INITIAL });
				controller = ctrl;
				backend = ctrl.backend;
				ready = true;
			} catch (err) {
				if (cancelled) return;
				error = err instanceof Error ? err.message : 'Не удалось инициализировать симуляцию.';
				console.error(err);
			}
		})();

		return () => {
			cancelled = true;
			ctrl?.destroy();
			controller = null;
		};
	});

	$effect(() => {
		const g = gravity;
		const p = paused;
		const a = amplitude;
		const f = frequency;
		const it = iterations;

		const ctrl = controller;
		if (!ctrl) return;

		ctrl.params.gravity = g;
		ctrl.params.paused = p;
		ctrl.params.amplitude = a;
		ctrl.params.frequency = f;
		ctrl.params.iterations = it;
	});

	$effect(() => {
		if (!ready) return;
		const id = window.setInterval(() => {
			if (controller) stats = controller.getStats();
		}, 200);
		return () => window.clearInterval(id);
	});

	function reset() {
		controller?.reset();
	}
</script>

<div class="relative h-dvh w-full overflow-hidden bg-bg text-fg">
	<canvas
		bind:this={canvasEl}
		class="absolute inset-0 h-full w-full touch-none"
		aria-label="Симуляция ткани Position Based Dynamics"
	></canvas>

	<Hud
		{gravity}
		{paused}
		{amplitude}
		{frequency}
		{iterations}
		{stats}
		{ready}
		{backend}
		onGravity={(v) => (gravity = v)}
		onPaused={(v) => (paused = v)}
		onAmplitude={(v) => (amplitude = v)}
		onFrequency={(v) => (frequency = v)}
		onIterations={(v) => (iterations = v)}
		onReset={reset}
		onDocs={() => (docsOpen = true)}
	/>

	{#if docsOpen}
		<MethodSheet onClose={() => (docsOpen = false)} />
	{/if}

	{#if !ready && !error}
		<div class="pointer-events-none absolute inset-0 flex items-center justify-center">
			<p class="font-mono text-sm tracking-wide text-muted">Инициализация симуляции…</p>
		</div>
	{/if}

	{#if error}
		<Fallback message={error} />
	{/if}
</div>
