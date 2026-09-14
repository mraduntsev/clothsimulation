<script lang="ts">
	interface Props {
		label: string;
		value: number;
		min: number;
		max: number;
		step: number;
		format: (v: number) => string;
		onChange: (v: number) => void;
	}

	let { label, value, min, max, step, format, onChange }: Props = $props();
</script>

<label class="block min-w-0">
	<span class="mb-1 flex items-baseline justify-between gap-2">
		<span class="text-xs tracking-wide text-muted uppercase">{label}</span>
		<span class="font-mono text-xs text-fg tabular-nums">{format(value)}</span>
	</span>
	<input
		class="hud-range"
		type="range"
		{min}
		{max}
		{step}
		{value}
		oninput={(e) => onChange(Number(e.currentTarget.value))}
	/>
</label>
