<script lang="ts">
	import { enhance } from '$app/forms';
	import { pushState } from '$app/navigation';
	import { page } from '$app/state';
	import { tick, type Snippet } from 'svelte';
	import { flip } from 'svelte/animate';
	import { dndzone, setKeyboardDragTrigger, type DndEvent } from 'svelte-dnd-action';
	import { failureMessage, isTemp, isTyping, neighbours, postAction } from '$lib/actions';
	import { daysBetween, dueLabel, formatDay } from '$lib/dates';
	import { describe } from '$lib/repeat';
	import { toasts } from '$lib/toasts.svelte';
	import type { List, Task } from '$lib/types';
	import QuickAdd, { type Added } from './QuickAdd.svelte';
	import TaskPanel from './TaskPanel.svelte';

	type Mode = 'active' | 'today' | 'upcoming' | 'logbook';
	type Props = {
		tasks: Task[];
		lists: List[];
		/** Where quick-add puts new tasks; null = Inbox. */
		listId: string | null;
		/** Task from ?task=<id>, loaded on the server (works without JS). */
		selected: Task | null;
		/** active = Inbox or a list (manual order); today / upcoming are ordered by date. */
		mode?: Mode;
		header: Snippet;
		empty: string;
	};
	let { tasks, lists, listId, selected, mode = 'active', header, empty }: Props = $props();

	/** How many days ahead Upcoming shows one group per day before "Later". */
	const UPCOMING_DAYS = 14;

	// Space starts a keyboard drag; Enter stays free to open a task.
	setKeyboardDragTrigger('space');

	// Optimistic updates overwrite this until the next load replaces it.
	let items = $derived(tasks);
	const today = $derived(page.data.today as string);
	const reorderable = $derived(mode === 'active');
	const listName = $derived(new Map(lists.map((l) => [l.id, l.name])));
	const FLIP_MS = 150;

	type Group = { key: string; title: string | null; tasks: Task[] };
	const groups = $derived.by((): Group[] => {
		if (mode === 'today') {
			const overdue = items.filter((t) => t.dueDate && t.dueDate < today);
			const rest = items.filter((t) => !(t.dueDate && t.dueDate < today));
			return overdue.length
				? [
						{ key: 'overdue', title: 'Overdue', tasks: overdue },
						{ key: 'today', title: 'Today', tasks: rest }
					]
				: [{ key: 'today', title: null, tasks: rest }];
		}
		if (mode === 'upcoming') {
			const byKey = new Map<string, Group>();
			for (const task of items) {
				const due = task.dueDate ?? today;
				const days = daysBetween(today, due);
				const key = days > UPCOMING_DAYS ? 'later' : due;
				const title = key === 'later' ? 'Later' : days === 1 ? 'Tomorrow' : formatDay(due, today);
				if (!byKey.has(key)) byKey.set(key, { key, title, tasks: [] });
				byKey.get(key)!.tasks.push(task);
			}
			return [...byKey.values()];
		}
		return [{ key: 'all', title: null, tasks: items }];
	});
	/** Tasks in the order they appear on screen (for arrow-key navigation). */
	const visible = $derived(reorderable ? items : groups.flatMap((g) => g.tasks));

	/** Whether a task belongs in this view (decides where edits and new tasks show up). */
	function belongs(task: Pick<Task, 'listId' | 'dueDate' | 'pinnedToday'>): boolean {
		if (mode === 'today') return (!!task.dueDate && task.dueDate <= today) || task.pinnedToday;
		if (mode === 'upcoming') return !!task.dueDate && task.dueDate > today;
		if (mode === 'active') return task.listId === listId;
		return false;
	}

	/** "Work, due Fri 9 Oct": where a task lives, for toasts. */
	function whereabouts(task: Pick<Task, 'listId' | 'dueDate'>): string {
		const where = task.listId ? (listName.get(task.listId) ?? 'a list') : 'Inbox';
		return task.dueDate ? `${where}, due ${dueLabel(task.dueDate, today).text}` : where;
	}

	/** Toast for an edited task that no longer belongs in this view. */
	function leftView(task: Pick<Task, 'listId' | 'dueDate'>): string {
		if (mode === 'active') return `Moved to ${whereabouts(task)}`;
		if (!task.dueDate) return mode === 'today' ? 'Removed from Today' : 'Date cleared';
		if (task.dueDate <= today) return 'Moved to Today';
		return `Due ${formatDay(task.dueDate, today)}`;
	}

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

	function addOptimistic(fields: Pick<Task, 'title' | 'listId' | 'dueDate' | 'repeatRule'>) {
		const now = new Date();
		const temp: Task = {
			id: `temp-${crypto.randomUUID()}`,
			userId: '',
			notes: null,
			completedAt: null,
			pinnedToday: false,
			seriesId: null,
			previousId: null,
			order: '',
			createdAt: now,
			updatedAt: now,
			deletedAt: null,
			...fields
		};
		if (belongs(temp)) items = [temp, ...items];
	}

	function added(task: Added) {
		if (!belongs({ ...task, pinnedToday: false })) toasts.show(`Added to ${whereabouts(task)}`);
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
		if (mode === 'logbook' || belongs(task)) return patch(task.id, task);
		items = items.filter((t) => t.id !== task.id);
		toasts.show(leftView(task));
	}

	function togglePin(task: Task) {
		const pinned = !task.pinnedToday;
		patch(task.id, { pinnedToday: pinned });
		postAction('pinTask', { id: task.id, pinned: String(pinned) });
		toasts.show(pinned ? `Pinned “${task.title}” to Today` : `Unpinned “${task.title}”`);
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

	function onRowKey(event: KeyboardEvent, task: Task) {
		if (isTyping(event) || event.metaKey || event.ctrlKey) return;
		const index = visible.indexOf(task);
		const onRow = event.target === event.currentTarget;
		const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown';
		const direction = event.key === 'ArrowUp' ? -1 : 1;
		const temp = isTemp(task.id);

		if (vertical && event.altKey) {
			event.preventDefault();
			if (reorderable) step(index, direction);
		} else if (vertical || event.key === 'j' || event.key === 'k') {
			event.preventDefault();
			const to = visible[index + (event.key === 'k' || event.key === 'ArrowUp' ? -1 : 1)];
			if (to) focusRow(to.id);
		} else if (event.key === 'Enter' && onRow && !temp) {
			open(event, task);
		} else if (event.key === 't' && !event.altKey && !temp && !task.completedAt) {
			event.preventDefault();
			togglePin(task);
		} else if ((event.key === 'Delete' || event.key === 'Backspace') && !temp) {
			event.preventDefault();
			const neighbour = visible[index + 1] ?? visible[index - 1];
			remove(task).then(() => neighbour && focusRow(neighbour.id));
		}
	}

	function onWindowKey(event: KeyboardEvent) {
		if (event.key === 'Escape' && openTask && !event.defaultPrevented) close();
	}

	const rowClass = (task: Task) =>
		`group flex items-center gap-3 rounded-lg px-2 py-1.5 outline-offset-0 hover:bg-raised focus-visible:bg-raised ${
			isTemp(task.id) ? 'opacity-60' : ''
		} ${openId === task.id ? 'bg-raised' : ''}`;
</script>

<svelte:window onkeydown={onWindowKey} />

{#snippet row(task: Task)}
	{@const done = !!task.completedAt}
	{@const temp = isTemp(task.id)}
	{@const due = task.dueDate ? dueLabel(task.dueDate, today) : null}
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
				const outcome = result.data?.completed as
					{ next: { dueDate: string | null } | null; capped: boolean } | undefined;
				const message = !completing
					? `Moved “${title}” back`
					: outcome?.next?.dueDate
						? `Done. Next: ${formatDay(outcome.next.dueDate, today)}`
						: outcome?.capped
							? `Done. The next “${title}” wasn't created: guest accounts can hold up to 200 tasks.`
							: `Completed “${title}”`;
				toasts.show(message, {
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
		class="flex min-w-0 flex-1 items-center gap-2 py-1"
	>
		<span class="min-w-0 flex-1 truncate {done ? 'text-muted line-through' : ''}">{task.title}</span
		>
		<span class="flex shrink-0 items-center gap-2 text-xs text-muted">
			{#if task.pinnedToday && !done}
				<span class="text-accent" title="Pinned to Today" aria-label="Pinned to Today">★</span>
			{/if}
			{#if task.notes}
				<span title="Has notes" aria-label="Has notes">≡</span>
			{/if}
			{#if (mode === 'today' || mode === 'upcoming') && task.listId && listName.has(task.listId)}
				<span class="hidden max-w-28 truncate sm:inline">{listName.get(task.listId)}</span>
			{/if}
			{#if task.repeatRule}
				{@const repeats = describe(task.repeatRule)}
				<span title="Repeats: {repeats}" aria-label="Repeats: {repeats}">
					↻<span class="hidden sm:inline"> {repeats}</span>
				</span>
			{/if}
			{#if due}
				<span class={due.overdue && !done ? 'italic' : ''}>{due.text}</span>
			{/if}
			{#if mode === 'logbook' && task.completedAt}
				<span title="Completed">
					✓ {task.completedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
				</span>
			{/if}
		</span>
	</a>
{/snippet}

<div class="space-y-5">
	{@render header()}

	<QuickAdd
		{listId}
		{lists}
		{today}
		view={mode === 'today' ? 'today' : mode === 'upcoming' ? 'upcoming' : 'list'}
		placeholder={mode === 'logbook' ? 'Add to Inbox' : 'Add a task'}
		onadd={addOptimistic}
		onadded={added}
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

	{#if reorderable}
		<ul
			class="-mx-2 space-y-px"
			aria-label="Tasks"
			use:dndzone={{
				items,
				flipDurationMs: FLIP_MS,
				delayTouchStart: 250,
				dropTargetStyle: {},
				type: 'tasks'
			}}
			onconsider={consider}
			onfinalize={finalize}
		>
			{#each items as task (task.id)}
				<!-- svelte-dnd-action makes each row focusable for keyboard dragging; these keys extend that. -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
				<li
					animate:flip={{ duration: FLIP_MS }}
					data-task-id={task.id}
					tabindex="0"
					onkeydown={(e) => onRowKey(e, task)}
					class={rowClass(task)}
				>
					{@render row(task)}
				</li>
			{/each}
		</ul>
	{:else}
		{#each groups as group (group.key)}
			{#if group.tasks.length}
				<section class="space-y-1" aria-label={group.title ?? undefined}>
					{#if group.title}
						<h2
							class="border-b border-line pb-1 text-sm font-semibold {group.key === 'overdue'
								? 'text-muted'
								: ''}"
						>
							{group.title}
						</h2>
					{/if}
					<ul class="-mx-2 space-y-px">
						{#each group.tasks as task (task.id)}
							<!-- Rows are focusable so the list can be driven from the keyboard. -->
							<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
							<li
								animate:flip={{ duration: FLIP_MS }}
								data-task-id={task.id}
								tabindex="0"
								onkeydown={(e) => onRowKey(e, task)}
								class={rowClass(task)}
							>
								{@render row(task)}
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/each}
	{/if}

	{#if items.length > 0}
		<p class="hidden text-xs text-muted md:block">
			{#if reorderable && items.length > 1}
				Drag to reorder, or focus a task and press <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd>.
			{/if}
			<kbd>Enter</kbd> opens, <kbd>T</kbd> pins to Today, <kbd>Delete</kbd> deletes.
		</p>
	{/if}
</div>

{#if openTask}
	{#key openTask.id}
		<TaskPanel
			task={openTask}
			{lists}
			reorderable={reorderable && !openTask.completedAt}
			onclose={close}
			onsave={save}
			ondelete={remove}
		/>
	{/key}
{/if}
