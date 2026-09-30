<script lang="ts">
	import { fly } from 'svelte/transition';
	import { toasts } from '$lib/toasts.svelte';
</script>

<div
	class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
	aria-live="polite"
>
	{#each toasts.items as toast (toast.id)}
		<div
			transition:fly={{ y: 12, duration: 150 }}
			class="pointer-events-auto flex max-w-full items-center gap-3 rounded-lg bg-ink py-2 pr-2 pl-4 text-sm text-canvas shadow-lg"
		>
			<span class="min-w-0 truncate">{toast.message}</span>
			{#if toast.action}
				<button
					class="shrink-0 rounded px-2 py-1 font-semibold text-accent-soft hover:bg-white/10"
					onclick={() => {
						toast.action!.run();
						toasts.dismiss(toast.id);
					}}>{toast.action.label}</button
				>
			{/if}
			<button
				class="shrink-0 rounded px-2 py-1 opacity-70 hover:bg-white/10 hover:opacity-100"
				aria-label="Dismiss"
				onclick={() => toasts.dismiss(toast.id)}>✕</button
			>
		</div>
	{/each}
</div>
