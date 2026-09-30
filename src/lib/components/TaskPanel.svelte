<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { failureMessage } from '$lib/actions';
	import { toasts } from '$lib/toasts.svelte';
	import type { List, Task } from '$lib/types';

	type Props = {
		task: Task;
		lists: List[];
		reorderable: boolean;
		onclose: () => void;
		onsave: (task: Task) => void;
		ondelete: (task: Task) => void;
	};
	let { task, lists, reorderable, onclose, onsave, ondelete }: Props = $props();

	// Archived lists are hidden from the picker unless the task is already in one.
	const choices = $derived(lists.filter((l) => !l.archived || l.id === task.listId));
	const closeHref = $derived(page.url.pathname);

	const submit: SubmitFunction = ({ action, formData, cancel }) => {
		const name = [...action.searchParams.keys()].find((k) => k.startsWith('/'))?.slice(1);
		if (name === 'deleteTask') {
			cancel();
			ondelete(task);
			return;
		}
		if (name === 'saveTask') {
			const title = String(formData.get('title') ?? '').trim();
			if (!title) return cancel();
			const listId = String(formData.get('listId'));
			onsave({
				...task,
				title,
				notes: String(formData.get('notes') ?? '').trim() || null,
				listId: listId === 'inbox' ? null : listId,
				dueDate: String(formData.get('dueDate') ?? '') || null,
				pinnedToday: formData.has('pinnedToday')
			});
		}
		return async ({ result, update }) => {
			await update({ reset: false });
			if (result.type !== 'success') toasts.show(failureMessage(result));
		};
	};

	let dueInput = $state<HTMLInputElement>();

	/** With JS, Clear just empties the field; without JS it submits clearDue. */
	function clearDue(event: MouseEvent) {
		event.preventDefault();
		if (dueInput) dueInput.value = '';
	}

	function close(event: MouseEvent) {
		event.preventDefault();
		onclose();
	}

	const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
</script>

<a
	href={closeHref}
	onclick={close}
	class="fixed inset-0 z-30 bg-black/40 md:bg-black/10"
	aria-hidden="true"
	tabindex="-1"
></a>
<aside
	class="fixed inset-x-0 bottom-0 z-40 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-5 shadow-2xl md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[26rem] md:rounded-none md:border-t-0 md:border-l"
	aria-label="Task details"
>
	<div class="flex items-center justify-between gap-2 text-sm text-muted">
		<span>
			{#if task.completedAt}
				Completed {fmt.format(task.completedAt)}
			{:else}
				Created {fmt.format(task.createdAt)}
			{/if}
		</span>
		<a href={closeHref} onclick={close} class="-mr-2 btn-ghost" aria-label="Close">✕</a>
	</div>

	{#key task.id}
		<form method="POST" action="?/saveTask" use:enhance={submit} class="mt-3 space-y-4">
			<!-- Enter submits with the form's first button: make that Save, not Clear. -->
			<button class="hidden" tabindex="-1" aria-hidden="true">Save</button>
			<input type="hidden" name="id" value={task.id} />
			<div>
				<label for="task-title" class="sr-only">Title</label>
				<input
					id="task-title"
					name="title"
					type="text"
					required
					maxlength="500"
					value={task.title}
					class="w-full text-lg font-medium"
				/>
			</div>
			<div>
				<label for="task-notes" class="mb-1 block text-xs font-medium text-muted">Notes</label>
				<textarea
					id="task-notes"
					name="notes"
					rows="6"
					maxlength="10000"
					class="w-full text-sm"
					placeholder="Add notes…">{task.notes ?? ''}</textarea
				>
			</div>
			<div class="flex flex-wrap items-end gap-x-4 gap-y-3">
				<div>
					<label for="task-due" class="mb-1 block text-xs font-medium text-muted">Due</label>
					<div class="flex items-center gap-1">
						<input
							bind:this={dueInput}
							id="task-due"
							name="dueDate"
							type="date"
							value={task.dueDate ?? ''}
							class="text-sm"
						/>
						<button
							class="btn-ghost px-2"
							name="clearDue"
							value="1"
							formnovalidate
							onclick={clearDue}>Clear</button
						>
					</div>
				</div>
				<label class="flex items-center gap-2 pb-2 text-sm">
					<input type="hidden" name="pinField" value="1" />
					<input
						type="checkbox"
						name="pinnedToday"
						checked={task.pinnedToday}
						class="rounded border-line text-accent focus:ring-accent"
					/>
					Pin to Today
				</label>
			</div>
			<div>
				<label for="task-list" class="mb-1 block text-xs font-medium text-muted">List</label>
				<select id="task-list" name="listId" class="w-full text-sm">
					<option value="inbox" selected={task.listId === null}>Inbox</option>
					{#each choices as list (list.id)}
						<option value={list.id} selected={list.id === task.listId}>{list.name}</option>
					{/each}
				</select>
			</div>

			{#if page.form?.saveError}
				<p class="text-sm text-danger">{page.form.saveError}</p>
			{/if}

			<div class="flex flex-wrap items-center gap-2">
				<button class="btn-primary">Save</button>
				{#if reorderable}
					<button
						class="btn-ghost"
						formaction="?task={task.id}&/stepTask"
						formnovalidate
						name="direction"
						value="up"
						aria-label="Move up">↑</button
					>
					<button
						class="btn-ghost"
						formaction="?task={task.id}&/stepTask"
						formnovalidate
						name="direction"
						value="down"
						aria-label="Move down">↓</button
					>
				{/if}
				<button class="ml-auto btn-danger" formaction="?/deleteTask" formnovalidate>Delete</button>
			</div>
		</form>
	{/key}
</aside>
