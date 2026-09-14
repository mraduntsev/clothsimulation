<script lang="ts">
	import { X } from '@lucide/svelte';

	interface Props {
		onClose: () => void;
	}

	let { onClose }: Props = $props();
</script>

<div class="bg-bg/50 absolute inset-0 z-20 flex justify-end">
	<button
		type="button"
		class="absolute inset-0 cursor-default"
		aria-label="Закрыть"
		onclick={onClose}
	></button>
	<aside
		class="bg-surface relative flex h-full w-full max-w-md flex-col shadow-[0_0_0_1px_rgb(255_255_255/0.08)]"
	>
		<header class="flex items-center justify-between gap-3 px-5 py-4">
			<h2 class="text-lg font-medium tracking-tight">О методе</h2>
			<button
				type="button"
				onclick={onClose}
				class="text-fg inline-flex size-11 items-center justify-center rounded-md transition-opacity hover:opacity-80"
				aria-label="Закрыть"
			>
				<X class="size-4" strokeWidth={2} />
			</button>
		</header>
		<div class="text-muted min-h-0 flex-1 overflow-y-auto px-5 pb-8 text-sm leading-relaxed">
			<h3 class="text-fg mt-1 font-medium">Position Based Dynamics</h3>
			<p class="mt-2">
				Ткань — это сетка частиц. Вместо сил и ускорений PBD напрямую проецирует позиции на
				множество ограничений. Для ребра с длиной покоя d₀:
			</p>
			<p class="text-fg mt-2 font-mono text-xs">C(pᵢ, pⱼ) = |pᵢ − pⱼ| − d₀</p>
			<p class="mt-2">
				Коррекция делится пропорционально обратным массам. Угловые вершины и центр имеют w = 0,
				поэтому солвер их не двигает.
			</p>

			<h3 class="text-fg mt-5 font-medium">Кинематический центр</h3>
			<p class="mt-2">
				Синяя точка не получает ни силы, ни импульса. Её положение — граничное условие:
			</p>
			<p class="text-fg mt-2 font-mono text-xs">p(t) = (x₀, y₀, A sin(2π f t))</p>
			<p class="mt-2">
				После каждой итерации PBD позиция перезаписывается, поэтому ткань не может «стянуть» центр
				обратно. Деформация уходит к красным углам волной.
			</p>

			<h3 class="text-fg mt-5 font-medium">Интегрирование</h3>
			<p class="mt-2">
				Semi-implicit Euler (предсказание) + позиционная проекция + обновление скорости из смещения.
				Фиксированный шаг dt = 1/60, не завязан на FPS.
			</p>

			<h3 class="text-fg mt-5 font-medium">Параллельный солвер</h3>
			<p class="mt-2">
				На GPU — Jacobi PBD: поправки копятся атомарными i32, затем усредняются. Нет гонок при
				записи в одну вершину. На CPU — тот же Jacobi, последовательно. Архитектура совместима с
				переходом на XPBD (compliance вместо k).
			</p>

			<h3 class="text-fg mt-5 font-medium">Почему не spring-mass</h3>
			<p class="mt-2">
				Явные пружины неустойчивы на крупных шагах и не задают кинематику как Dirichlet. PBD
				устойчив, контроллируем и хорошо ложится на compute shaders.
			</p>
		</div>
	</aside>
</div>
