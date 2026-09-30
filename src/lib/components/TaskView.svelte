<script lang="ts">
	import { enhance } from '$app/forms';
	import { pushState } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, tick, type Snippet } from 'svelte';
	import { flip } from 'svelte/animate';
	import { dndzone, setKeyboardDragTrigger, type DndEvent } from 'svelte-dnd-action';
	import { failureMessage, isTemp, neighbours, postAction } from '$lib/actions';
	import { onShortcut } from '$lib/keyboard';
	import { dayOf, daysBetween, dueLabel, formatDay } from '$lib/dates';
	import { highlight } from '$lib/highlight';
	import { describe } from '$lib/repeat';
	import { toasts } from '$lib/toasts.svelte';
	import type { List, Task } from '$lib/types';
	import QuickAdd, { type Added } from './QuickAdd.svelte';
	import TaskPanel from './TaskPanel.svelte';

	type Mode = 'active' | 'today' | 'upcoming' | 'logbook' | 'search';
	type Props = {
		tasks: Task[];
		lists: List[];
		/** Where quick-add puts new tasks; null = Inbox. */
		listId: string | null;
		/** Task from ?task=<id>, loaded on the server (works without JS). */
		selected: Task | null;
		/** active = Inbox or a list (manual order); today / upcoming are ordered by date. */
		mode?: Mode;
		/** Search: words to highlight in titles. */
		highlightWords?: string[];
		/** Show the quick-add box (not on the search page). */
		quickAdd?: boolean;
		header: Snippet;
		empty: string;
	};
	let {
		tasks,
		lists,
		listId,
		selected,
		mode = 'active',
		highlightWords = [],
		quickAdd = true,
		header,
		empty
	}: Props = $props();

	/** How many days ahead Upcoming shows one group per day before "Later". */
	const UPCOMING_DAYS = 14;

	// Space starts a keyboard drag; Enter stays free to open a task.
	setKeyboardDragTrigger('space');

	// Optimistic updates overwrite this until the next load replaces it.
	let items = $derived(tasks);
	const today = $derived(page.data.today as string);
	const timeZone = $derived((page.data.timeZone as string) ?? 'UTC');
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
		if (mode === 'search') {
			return [
				{ key: 'active', title: 'Active', tasks: items.filter((t) => !t.completedAt) },
				{ key: 'completed', title: 'Completed', tasks: items.filter((t) => t.completedAt) }
			];
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
		if (mode === 'search') return true;
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

	// ---- Keyboard (registered with the app's one listener; see $lib/keyboard) ----

	/** The task whose row (or something inside it) has focus. */
	function focusedTask(): Task | null {
		const row = (document.activeElement as HTMLElement | null)?.closest?.('[data-task-id]');
		const id = row?.getAttribute('data-task-id');
		return (id && visible.find((t) => t.id === id)) || null;
	}

	function focusRow(id: string) {
		const row = document.querySelector<HTMLElement>(`[data-task-id="${id}"]`);
		row?.focus();
		row?.scrollIntoView({ block: 'nearest' });
	}

	/** Move focus through the visible tasks; with no task focused, start at the top / bottom. */
	function moveFocus(direction: 1 | -1, onlyFromARow: boolean) {
		const current = focusedTask();
		if (!current && onlyFromARow) return false;
		const index = current ? visible.indexOf(current) : direction === 1 ? -1 : visible.length;
		const to = visible[index + direction];
		if (to) focusRow(to.id);
		return !!to || !!current;
	}

	/** Run `fn` on the focused task (not an optimistic placeholder). */
	const withTask = (fn: (task: Task) => void) => () => {
		const task = focusedTask();
		if (!task || isTemp(task.id)) return false;
		fn(task);
		return true;
	};

	onMount(() => {
		const off = [
			onShortcut('next', () => moveFocus(1, false)),
			onShortcut('prev', () => moveFocus(-1, false)),
			// Plain arrows only move between tasks once one has focus (otherwise they scroll).
			onShortcut('rowDown', () => moveFocus(1, true)),
			onShortcut('rowUp', () => moveFocus(-1, true)),
			onShortcut(
				'toggle',
				withTask((task) =>
					document
						.querySelector<HTMLButtonElement>(`[data-task-id="${task.id}"] button[role=checkbox]`)
						?.click()
				)
			),
			onShortcut(
				'open',
				withTask((task) => openTask_(task))
			),
			// Enter opens only from the row itself; on a button inside it, Enter presses the button.
			onShortcut('openRow', (event) => {
				const el = event.target as HTMLElement;
				return el.hasAttribute?.('data-task-id') ? withTask((task) => openTask_(task))() : false;
			}),
			onShortcut('pin', () => {
				const task = focusedTask();
				if (!task || isTemp(task.id) || task.completedAt) return false;
				togglePin(task);
				return true;
			}),
			onShortcut(
				'delete',
				withTask((task) => {
					const index = visible.indexOf(task);
					const neighbour = visible[index + 1] ?? visible[index - 1];
					remove(task).then(() => neighbour && focusRow(neighbour.id));
				})
			),
			onShortcut('moveUp', () => reorderFocused(-1)),
			onShortcut('moveDown', () => reorderFocused(1)),
			// Esc closes the panel (after the shortcuts dialog, before the drawer).
			onShortcut('escape', () => (openTask ? (close(), true) : false), 20)
		];
		return () => off.forEach((unregister) => unregister());
	});

	function openTask_(task: Task) {
		pushState(`?task=${task.id}`, { taskId: task.id });
	}

	function reorderFocused(direction: -1 | 1) {
		const task = focusedTask();
		if (!task || !reorderable || isTemp(task.id)) return false;
		step(items.indexOf(task), direction);
		return true;
	}

	const rowClass = (task: Task) =>
		`group flex items-center gap-3 rounded-lg px-2 py-1.5 outline-offset-0 hover:bg-raised focus-visible:bg-raised ${
			isTemp(task.id) ? 'opacity-60' : ''
		} ${openId === task.id ? 'bg-raised' : ''}`;
</script>

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
		<span class="flex min-w-0 flex-1 flex-col">
			<span class="truncate {done ? 'text-muted line-through' : ''}">
				{#each highlight(task.title, highlightWords) as segment, i (i)}
					{#if segment.match}<mark class="rounded-sm bg-accent-soft px-0.5 text-inherit"
							>{segment.text}</mark
						>{:else}{segment.text}{/if}
				{/each}
			</span>
			{#if task.repeatRule}
				<!-- Phones: the repeat on its own line, so it's visible without a tooltip. -->
				<span class="truncate text-xs text-muted sm:hidden">↻ {describe(task.repeatRule)}</span>
			{/if}
		</span>
		<span class="flex shrink-0 items-center gap-2 text-xs text-muted">
			{#if task.pinnedToday && !done}
				<span class="text-accent" title="Pinned to Today" aria-label="Pinned to Today">★</span>
			{/if}
			{#if task.notes}
				<span title="Has notes" aria-label="Has notes">≡</span>
			{/if}
			{#if (mode === 'today' || mode === 'upcoming' || mode === 'search') && task.listId && listName.has(task.listId)}
				<span class="hidden max-w-28 truncate sm:inline">{listName.get(task.listId)}</span>
			{/if}
			{#if task.repeatRule}
				{@const repeats = describe(task.repeatRule)}
				<span class="hidden sm:inline" title="Repeats: {repeats}">↻ {repeats}</span>
			{/if}
			{#if due}
				<span class={due.overdue && !done ? 'italic' : ''}>{due.text}</span>
			{/if}
			{#if (mode === 'logbook' || mode === 'search') && task.completedAt}
				<span title="Completed">✓ {formatDay(dayOf(task.completedAt, timeZone), today)}</span>
			{/if}
		</span>
	</a>
{/snippet}

<div class="space-y-5">
	{@render header()}

	{#if quickAdd}
		<QuickAdd
			{listId}
			{lists}
			{today}
			view={mode === 'today' ? 'today' : mode === 'upcoming' ? 'upcoming' : 'list'}
			placeholder={mode === 'logbook' ? 'Add to Inbox…' : 'Add a task…'}
			longPlaceholder={mode === 'logbook'
				? 'Add to Inbox, e.g. pay rent fri'
				: 'Add a task, e.g. pay rent fri #home'}
			onadd={addOptimistic}
			onadded={added}
		/>
	{/if}

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
				<!-- Rows are focusable so the list can be driven from the keyboard ($lib/keyboard). -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
				<li
					animate:flip={{ duration: FLIP_MS }}
					data-task-id={task.id}
					tabindex="0"
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
							<!-- Rows are focusable so the list can be driven from the keyboard ($lib/keyboard). -->
							<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
							<li
								animate:flip={{ duration: FLIP_MS }}
								data-task-id={task.id}
								tabindex="0"
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
			{#if reorderable && items.length > 1}Drag to reorder, or <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd
					>↓</kbd
				>.
			{/if}
			<kbd>j</kbd>/<kbd>k</kbd> move, <kbd>x</kbd> completes, <kbd>e</kbd> opens, <kbd>t</kbd> pins.
			<kbd>?</kbd> shows all shortcuts.
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
