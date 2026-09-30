<script lang="ts" module>
	import type { RepeatRule } from '$lib/repeat';
	export type Added = { id: string; title: string; listId: string | null; dueDate: string | null };
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { failureMessage } from '$lib/actions';
	import { dueLabel, formatDay } from '$lib/dates';
	import { parseQuickAdd, type DateOrder, type QuickAddList } from '$lib/quick-add';
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
		onadd?: (task: {
			title: string;
			listId: string | null;
			dueDate: string | null;
			repeatRule: RepeatRule | null;
		}) => void;
		/** Called with the saved task, e.g. to say where it went. */
		onadded?: (task: Added) => void;
	};
	let { listId, lists, today, view, placeholder, onadd, onadded }: Props = $props();

	let value = $state('');
	/** Off once the user dismisses a chip: the text is then kept exactly as typed. */
	let parsing = $state(true);
	/** A date chosen in the chip's picker; it replaces the parsed date. */
	let picked = $state<string | null>(null);
	/**
	 * Slash dates are day-first unless the browser's locale is US English. Only set
	 * once hydrated, so without JS no field is sent and the server uses Accept-Language.
	 */
	let dateOrder = $state<DateOrder>();
	let picker = $state<HTMLInputElement>();

	onMount(() => {
		dateOrder = navigator.language.toLowerCase() === 'en-us' ? 'mdy' : 'dmy';
	});

	// Preview only: the server re-parses the raw text itself (with the same picked date).
	const preview = (text: string, pickedDate?: string | null) =>
		parseQuickAdd(text, { today, lists, dateOrder, pickedDate });
	/** What the text says on its own: decides which chips exist. */
	const base = $derived(parsing && value.trim() ? preview(value) : null);
	/** With a picked date applied: what gets shown and saved. */
	const parsed = $derived(base && base.dueDate && picked ? preview(value, picked) : base);
	const showChips = $derived(!!(base?.dueDate || base?.listName || base?.repeat));
	const due = $derived(base?.dueDate ? parsed!.dueDate : null);

	/** "Tomorrow, Thu 1 Oct", or just "Tue 6 Oct" when the relative label is the date. */
	function spoken(date: string) {
		const relative = dueLabel(date, today).text;
		const absolute = formatDay(date, today);
		return relative === absolute ? absolute : `${relative}, ${absolute}`;
	}

	function literal() {
		parsing = false;
		picked = null;
		document.getElementById('quick-add')?.focus();
	}

	function openPicker() {
		if (!picker) return;
		picker.value = due ?? '';
		try {
			picker.showPicker();
		} catch {
			// Older browsers: focusing the (invisible) input still opens its picker on click.
			picker.focus();
			picker.click();
		}
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && showChips) {
			// Keep the text literal; don't let Escape also close a panel or drawer.
			event.preventDefault();
			event.stopPropagation();
			literal();
		}
	}
</script>

<form
	method="POST"
	action="?/addTask"
	use:enhance={({ formData, cancel }) => {
		const raw = String(formData.get('title') ?? '').trim();
		if (!raw) return cancel();
		const result = parsing ? preview(raw, base?.dueDate ? picked : null) : null;
		onadd?.({
			title: result?.title ?? raw,
			listId: result?.listId ?? listId,
			dueDate: result?.dueDate || (view === 'today' ? today : null),
			repeatRule: result?.repeat ?? null
		});
		value = '';
		parsing = true;
		picked = null;
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
	{#if dateOrder}<input type="hidden" name="dateOrder" value={dateOrder} />{/if}
	{#if parsing && due && picked}<input type="hidden" name="dueDate" value={picked} />{/if}
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
			{#if due}
				<span
					class="relative mt-2 inline-flex items-center rounded-full bg-accent-soft py-0.5 pr-1 pl-1"
				>
					<button
						type="button"
						class="inline-flex items-center gap-1 rounded-full px-1.5 hover:bg-raised"
						aria-label="Due date: {spoken(due)}. Change date"
						aria-haspopup="dialog"
						onclick={openPicker}
					>
						<span aria-hidden="true">📅</span>
						<span>{dueLabel(due, today).text}</span>
					</button>
					<!-- Invisible, but laid over the chip so the browser's picker opens next to it. -->
					<input
						bind:this={picker}
						type="date"
						tabindex="-1"
						aria-hidden="true"
						class="pointer-events-none absolute inset-0 h-full w-full opacity-0"
						onchange={(e) => (picked = e.currentTarget.value || null)}
					/>
					<button
						type="button"
						class="rounded-full px-1.5 text-muted hover:bg-raised hover:text-ink"
						aria-label="Remove the date and keep “{parsed.dateText}” as text"
						onclick={literal}>✕</button
					>
				</span>
			{/if}
			{#if parsed.repeatText}
				<span
					class="mt-2 inline-flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pr-1 pl-2.5"
				>
					<span aria-hidden="true">↻</span>
					<span>{parsed.repeatText}</span>
					<button
						type="button"
						class="rounded-full px-1.5 text-muted hover:bg-raised hover:text-ink"
						aria-label="Don't repeat: keep the text as typed"
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
