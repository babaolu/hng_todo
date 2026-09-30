<script lang="ts">
	import { onMount } from 'svelte';
	import { onShortcut } from '$lib/keyboard';
	import ShortcutsTable from './ShortcutsTable.svelte';
	import { SHORTCUTS_NOTE } from '$lib/shortcuts';

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
	<div class="max-h-[70dvh] overflow-y-auto px-5 py-4">
		<ShortcutsTable />
	</div>
	<p class="border-t border-line px-5 py-3 text-xs text-muted">{SHORTCUTS_NOTE}</p>
</dialog>
