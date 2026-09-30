<script lang="ts" module>
	export type Added = { id: string; title: string; listId: string | null; dueDate: string | null };
</script>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { failureMessage } from '$lib/actions';
	import { dueLabel } from '$lib/dates';
	import { parseQuickAdd, type QuickAddList } from '$lib/quick-add';
	import { toasts } from '$lib/toasts.svelte';

	type Props = {
		/** The current list (null = Inbox): where tasks go unless a #list is typed. */
		listId: string | null;
		lists: QuickAddList[];
		today: string;
		/** 'today' makes today the default due date; the server applies the same rule. */
		view: 'today' | 'upcoming' | 'list';
		placeholder: string;
		/** Show the new task immediately; the refresh after saving replaces it. */
		onadd?: (task: { title: string; listId: string | null; dueDate: string | null }) => void;
		/** Called with the saved task, e.g. to say where it went. */
		onadded?: (task: Added) => void;
	};
	let { listId, lists, today, view, placeholder, onadd, onadded }: Props = $props();

	let value = $state('');
	/** Off once the user dismisses a chip: the text is then kept exactly as typed. */
	let parsing = $state(true);

	// Preview only: the server re-parses the raw text itself.
	const parsed = $derived(parsing && value.trim() ? parseQuickAdd(value, { today, lists }) : null);
	const showChips = $derived(!!(parsed?.dueDate || parsed?.listName));

	function literal() {
		parsing = false;
		document.getElementById('quick-add')?.focus();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && showChips) {
			// Keep the text literal; don't let Escape also close a panel or drawer.
			event.preventDefault();
			event.stopPropagation();
			parsing = false;
		}
	}
</script>

<form
	method="POST"
	action="?/addTask"
	use:enhance={({ formData, cancel }) => {
		const raw = String(formData.get('title') ?? '').trim();
		if (!raw) return cancel();
		const preview = parsing ? parseQuickAdd(raw, { today, lists }) : null;
		onadd?.({
			title: preview?.title ?? raw,
			listId: preview?.listId ?? listId,
			dueDate: preview?.dueDate ?? (view === 'today' ? today : null)
		});
		value = '';
		parsing = true;
		return async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success' && result.data?.added) onadded?.(result.data.added as Added);
			else if (result.type !== 'success') toasts.show(failureMessage(result));
		};
	}}
>
	<input type="hidden" name="listId" value={listId ?? 'inbox'} />
	<input type="hidden" name="view" value={view} />
	<input type="hidden" name="parse" value={String(parsing)} />
	<div class="relative">
		<label for="quick-add" class="sr-only">New task</label>
		<input
			id="quick-add"
			name="title"
			type="text"
			autocomplete="off"
			maxlength="500"
			enterkeyhint="done"
			aria-describedby="quick-add-chips"
			{placeholder}
			bind:value
			{onkeydown}
			class="w-full rounded-lg py-2.5 pr-16 pl-10 shadow-xs"
		/>
		<span class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-lg text-muted"
			>+</span
		>
		<kbd
			class="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border border-line px-1.5 text-xs text-muted sm:block"
			>N</kbd
		>
	</div>

	<div
		id="quick-add-chips"
		class="flex min-h-0 flex-wrap items-center gap-2 text-xs"
		aria-live="polite"
	>
		{#if parsed && showChips}
			{#if parsed.dueDate}
				<span
					class="mt-2 inline-flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pr-1 pl-2.5"
				>
					<span aria-hidden="true">📅</span>
					<span>{dueLabel(parsed.dueDate, today).text}</span>
					<button
						type="button"
						class="rounded-full px-1.5 text-muted hover:bg-raised hover:text-ink"
						aria-label="Keep “{parsed.dateText}” as text"
						onclick={literal}>✕</button
					>
				</span>
			{/if}
			{#if parsed.listName}
				<span
					class="mt-2 inline-flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pr-1 pl-2.5"
				>
					<span aria-hidden="true">#</span>
					<span>{parsed.listName}</span>
					<button
						type="button"
						class="rounded-full px-1.5 text-muted hover:bg-raised hover:text-ink"
						aria-label="Keep the #tag as text"
						onclick={literal}>✕</button
					>
				</span>
			{/if}
			<span class="mt-2 hidden text-muted sm:inline">Esc keeps the text as typed</span>
		{:else if !parsing && value.trim()}
			<span class="mt-2 text-muted">
				Dates and #lists off for this task.
				<button type="button" class="text-accent hover:underline" onclick={() => (parsing = true)}
					>Undo</button
				>
			</span>
		{/if}
	</div>

	{#if page.form?.addError}
		<p class="mt-1 text-sm text-danger">{page.form.addError}</p>
	{/if}
</form>
