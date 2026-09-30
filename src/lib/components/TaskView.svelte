<script lang="ts">
	import { enhance } from '$app/forms';
	import { pushState } from '$app/navigation';
	import { page } from '$app/state';
	import { tick, type Snippet } from 'svelte';
	import { flip } from 'svelte/animate';
	import { dndzone, setKeyboardDragTrigger, type DndEvent } from 'svelte-dnd-action';
	import { failureMessage, isTemp, isTyping, neighbours, postAction } from '$lib/actions';
	import { toasts } from '$lib/toasts.svelte';
	import type { List, Task } from '$lib/types';
	import QuickAdd from './QuickAdd.svelte';
	import TaskPanel from './TaskPanel.svelte';

	type Props = {
		tasks: Task[];
		lists: List[];
		/** Where quick-add puts new tasks; null = Inbox. */
		listId: string | null;
		/** Task from ?task=<id>, loaded on the server (works without JS). */
		selected: Task | null;
		mode?: 'active' | 'logbook';
		header: Snippet;
		empty: string;
	};
	let { tasks, lists, listId, selected, mode = 'active', header, empty }: Props = $props();

	// Space starts a keyboard drag; Enter stays free to open a task.
	setKeyboardDragTrigger('space');

	// Optimistic updates overwrite this until the next load replaces it.
	let items = $derived(tasks);
	const reorderable = $derived(mode === 'active');
	const FLIP_MS = 150;

	const openId = $derived(
		page.state.taskId !== undefined ? page.state.taskId : (selected?.id ?? null)
	);
	const openTask = $derived(
		openId
			? (items.find((t) => t.id === openId) ?? (selected?.id === openId ? selected : null))
			: null
	);

	function open(event: MouseEvent | KeyboardEvent, task: Task) {
		if (event instanceof MouseEvent && (event.metaKey || event.ctrlKey || event.shiftKey)) return;
		event.preventDefault();
		pushState(`?task=${task.id}`, { taskId: task.id });
	}

	function close() {
		const id = openId;
		pushState(page.url.pathname, { taskId: null });
		if (id) tick().then(() => focusRow(id));
	}

	function focusRow(id: string) {
		document.querySelector<HTMLElement>(`[data-task-id="${id}"]`)?.focus();
	}

	function patch(id: string, changes: Partial<Task>) {
		items = items.map((t) => (t.id === id ? { ...t, ...changes } : t));
	}

	function addOptimistic(title: string) {
		if (mode !== 'active') return;
		const now = new Date();
		const temp: Task = {
			id: `temp-${crypto.randomUUID()}`,
			userId: '',
			listId,
			title,
			notes: null,
			completedAt: null,
			order: '',
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};
		items = [temp, ...items];
	}

	async function remove(task: Task) {
		if (openId === task.id) close();
		items = items.filter((t) => t.id !== task.id);
		const result = await postAction('deleteTask', { id: task.id });
		if (result.type === 'success') {
			toasts.show(`Deleted “${task.title}”`, {
				label: 'Undo',
				run: () => postAction('restoreTask', { id: task.id })
			});
		}
	}

	function save(task: Task) {
		close();
		if (mode === 'active' && task.listId !== listId) {
			items = items.filter((t) => t.id !== task.id);
			const target = task.listId ? lists.find((l) => l.id === task.listId)?.name : 'Inbox';
			toasts.show(`Moved to ${target ?? 'list'}`);
		} else {
			patch(task.id, task);
		}
	}

	function reorder(task: Task, index: number) {
		if (isTemp(task.id)) return;
		postAction('reorderTask', { id: task.id, ...neighbours(items, index) });
	}

	function consider(event: CustomEvent<DndEvent<Task>>) {
		items = event.detail.items;
	}

	function finalize(event: CustomEvent<DndEvent<Task>>) {
		items = event.detail.items;
		const index = items.findIndex((t) => t.id === event.detail.info.id);
		if (index !== -1) reorder(items[index], index);
	}

	async function step(index: number, direction: -1 | 1) {
		const target = index + direction;
		if (target < 0 || target >= items.length) return;
		const next = [...items];
		const [task] = next.splice(index, 1);
		next.splice(target, 0, task);
		items = next;
		reorder(task, target);
		await tick();
		focusRow(task.id);
	}

	function onRowKey(event: KeyboardEvent, task: Task, index: number) {
		if (isTyping(event)) return;
		const onRow = event.target === event.currentTarget;
		const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
		const direction = event.key === 'ArrowUp' ? -1 : 1;

		if (vertical && event.altKey) {
			event.preventDefault();
			if (reorderable) step(index, direction);
		} else if (vertical || event.key === 'j' || event.key === 'k') {
			event.preventDefault();
			const to = items[index + (event.key === 'k' || event.key === 'ArrowUp' ? -1 : 1)];
			if (to) focusRow(to.id);
		} else if (event.key === 'Enter' && onRow && !isTemp(task.id)) {
			open(event, task);
		} else if ((event.key === 'Delete' || event.key === 'Backspace') && !isTemp(task.id)) {
			event.preventDefault();
			const neighbour = items[index + 1] ?? items[index - 1];
			remove(task).then(() => neighbour && focusRow(neighbour.id));
		}
	}

	function onWindowKey(event: KeyboardEvent) {
		if (event.key === 'Escape' && openTask && !event.defaultPrevented) close();
	}
</script>

<svelte:window onkeydown={onWindowKey} />

<div class="space-y-5">
	{@render header()}

	<QuickAdd
		{listId}
		placeholder={mode === 'logbook' ? 'Add to Inbox' : 'Add a task'}
		onadd={addOptimistic}
		addedMessage={mode === 'logbook' ? 'Added to Inbox' : undefined}
	/>

	{#if page.form?.deleted}
		<!-- Undo without JavaScript. With JS, the toast handles this instead. -->
		<form
			method="POST"
			action="?/restoreTask"
			class="flex items-center justify-between gap-3 rounded-lg bg-raised px-4 py-2 text-sm"
		>
			<input type="hidden" name="id" value={page.form.deleted.id} />
			<span class="min-w-0 truncate">Deleted “{page.form.deleted.title}”</span>
			<button class="font-semibold text-accent">Undo</button>
		</form>
	{/if}

	{#if items.length === 0}
		<p class="py-16 text-center text-sm text-muted">{empty}</p>
	{/if}

	<ul
		class="-mx-2 space-y-px"
		aria-label="Tasks"
		use:dndzone={{
			items,
			flipDurationMs: FLIP_MS,
			dragDisabled: !reorderable,
			delayTouchStart: 250,
			dropTargetStyle: {},
			type: 'tasks'
		}}
		onconsider={consider}
		onfinalize={finalize}
	>
		{#each items as task, index (task.id)}
			{@const done = !!task.completedAt}
			{@const temp = isTemp(task.id)}
			<!-- svelte-dnd-action makes each row focusable for keyboard dragging; these keys extend that. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
			<li
				animate:flip={{ duration: FLIP_MS }}
				data-task-id={task.id}
				tabindex="0"
				onkeydown={(e) => onRowKey(e, task, index)}
				class="group flex items-center gap-3 rounded-lg px-2 py-1.5 outline-offset-0 hover:bg-raised focus-visible:bg-raised {temp
					? 'opacity-60'
					: ''} {openId === task.id ? 'bg-raised' : ''}"
			>
				<form
					method="POST"
					action="?/toggleTask"
					class="flex"
					use:enhance={() => {
						// Capture before the optimistic patch flips `done`.
						const { id, title } = task;
						const completing = !done;
						patch(id, { completedAt: completing ? new Date() : null });
						return async ({ result, update }) => {
							await update();
							if (result.type !== 'success') return toasts.show(failureMessage(result));
							toasts.show(completing ? `Completed “${title}”` : `Moved “${title}” back`, {
								label: 'Undo',
								run: () => postAction('toggleTask', { id, completed: String(!completing) })
							});
						};
					}}
				>
					<input type="hidden" name="id" value={task.id} />
					<input type="hidden" name="completed" value={String(!done)} />
					<button
						role="checkbox"
						aria-checked={done}
						aria-label={done ? `Mark “${task.title}” as not done` : `Complete “${task.title}”`}
						disabled={temp}
						class="grid size-6 shrink-0 place-items-center rounded-full border-2 text-xs transition-colors {done
							? 'border-accent bg-accent text-accent-ink'
							: 'border-line text-transparent hover:border-accent hover:text-accent'}">✓</button
					>
				</form>
				<a
					href="?task={task.id}"
					draggable="false"
					tabindex="-1"
					onclick={(e) => !temp && open(e, task)}
					class="flex min-w-0 flex-1 items-center gap-2 py-1 {done
						? 'text-muted line-through'
						: ''}"
				>
					<span class="min-w-0 flex-1 truncate">{task.title}</span>
					{#if task.notes}
						<span class="shrink-0 text-xs text-muted" title="Has notes" aria-label="Has notes"
							>≡</span
						>
					{/if}
					{#if mode === 'logbook' && task.completedAt}
						<span class="shrink-0 text-xs text-muted">
							{task.completedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
						</span>
					{/if}
				</a>
			</li>
		{/each}
	</ul>

	{#if items.length > 1 && reorderable}
		<p class="hidden text-xs text-muted md:block">
			Drag to reorder, or focus a task and press <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd>.
			<kbd>Enter</kbd> opens, <kbd>Delete</kbd> deletes.
		</p>
	{/if}
</div>

{#if openTask}
	<TaskPanel
		task={openTask}
		{lists}
		reorderable={reorderable && !openTask.completedAt}
		onclose={close}
		onsave={save}
		ondelete={remove}
	/>
{/if}
