<script lang="ts">
	import { onMount } from 'svelte';
	import { onShortcut, SHORTCUT_HELP } from '$lib/keyboard';

	let dialog = $state<HTMLDialogElement>();
	let returnFocus: HTMLElement | null = null;

	export function open() {
		if (!dialog || dialog.open) return;
		returnFocus = document.activeElement as HTMLElement | null;
		// A modal <dialog> keeps focus inside it and makes the page behind inert.
		dialog.showModal();
	}

	function close() {
		if (!dialog?.open) return;
		dialog.close();
	}

	function restoreFocus() {
		returnFocus?.focus?.();
		returnFocus = null;
	}

	// Esc closes the dialog before anything else (the panel, the drawer, focus).
	onMount(() => onShortcut('escape', () => (dialog?.open ? (close(), true) : false), 30));
</script>

<dialog
	bind:this={dialog}
	onclose={restoreFocus}
	aria-labelledby="shortcuts-title"
	class="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/40"
>
	<div class="flex items-center justify-between border-b border-line px-5 py-3">
		<h2 id="shortcuts-title" class="font-semibold">Keyboard shortcuts</h2>
		<button type="button" class="-mr-2 btn-ghost px-2" aria-label="Close" onclick={close}>✕</button>
	</div>
	<dl class="max-h-[70dvh] space-y-2 overflow-y-auto px-5 py-4 text-sm">
		{#each SHORTCUT_HELP as item (item.label)}
			<div class="flex items-center justify-between gap-4">
				<dt class="text-muted">{item.label}</dt>
				<dd class="flex shrink-0 gap-1">
					{#each item.keys as key (key)}
						<kbd class="rounded border border-line bg-raised px-1.5 py-0.5 text-xs text-ink"
							>{key}</kbd
						>
					{/each}
				</dd>
			</div>
		{/each}
	</dl>
	<p class="border-t border-line px-5 py-3 text-xs text-muted">
		Shortcuts are off while you're typing in a field. Ctrl and ⌘ combinations are left to the
		browser.
	</p>
</dialog>
