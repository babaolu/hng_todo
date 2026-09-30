<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { failureMessage } from '$lib/actions';
	import { formatDay } from '$lib/dates';
	import {
		describe,
		firstOccurrence,
		isoWeekday,
		LAST_DAY,
		nextOccurrence,
		ruleFromFields,
		type RepeatChoice
	} from '$lib/repeat';
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
	const today = $derived(page.data.today as string);

	// ---- Repeat (the panel is re-created per task, so these start from the task) ----
	const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	// Starting values only: TaskView re-creates the panel for each task.
	const { current, currentDue } = untrack(() => ({
		current: task.repeatRule,
		currentDue: task.dueDate
	}));
	const startDay = currentDue ?? untrack(() => page.data.today as string);
	let dueValue = $state(currentDue ?? '');
	let choice = $state<RepeatChoice>(
		!current
			? 'none'
			: current.freq === 'weekly' && current.weekdays.join() === '1,2,3,4,5'
				? 'weekdays'
				: current.freq
	);
	let interval = $state(String(current?.interval ?? 1));
	let weekdays = $state<string[]>(
		current?.freq === 'weekly' ? current.weekdays.map(String) : [String(isoWeekday(startDay))]
	);
	let monthDay = $state(
		current?.freq === 'monthly'
			? current.monthDay === LAST_DAY
				? 'last'
				: String(current.monthDay)
			: String(Number(startDay.slice(8)))
	);

	/** The rule the fields describe, built exactly as the server will. */
	function fieldsRule(start: string) {
		return ruleFromFields(
			{
				repeat: choice,
				interval,
				weekdays,
				monthDay,
				...(current?.freq === 'yearly' && start === currentDue
					? { month: String(current.month), day: String(current.monthDay) }
					: {})
			},
			start
		);
	}

	const repeatPreview = $derived.by(() => {
		if (choice === 'none') return null;
		try {
			const start = dueValue || today;
			const rule = fieldsRule(start)!;
			const first = firstOccurrence(rule, start);
			return `${describe(rule)}. Next: ${formatDay(first, today)}, then ${formatDay(nextOccurrence(rule, first), today)}`;
		} catch {
			return 'Check the repeat settings';
		}
	});

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
			const due = String(formData.get('dueDate') ?? '') || null;
			let repeatRule = null;
			try {
				repeatRule = fieldsRule(due ?? today);
			} catch {
				// the server will say what's wrong
			}
			onsave({
				...task,
				title,
				notes: String(formData.get('notes') ?? '').trim() || null,
				listId: listId === 'inbox' ? null : listId,
				// A repeat always has a due date: its first occurrence on or after the chosen day.
				dueDate: repeatRule ? firstOccurrence(repeatRule, due ?? today) : due,
				repeatRule,
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
		dueValue = '';
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
							oninput={(e) => (dueValue = e.currentTarget.value)}
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
			<fieldset class="repeat space-y-2">
				<legend class="mb-1 text-xs font-medium text-muted">Repeat</legend>
				<input type="hidden" name="repeatField" value="1" />
				<div class="flex flex-wrap items-center gap-2 text-sm">
					<select name="repeat" bind:value={choice} class="text-sm" aria-label="Repeat">
						<option value="none">Never</option>
						<option value="daily">Daily</option>
						<option value="weekdays">Weekdays</option>
						<option value="weekly">Weekly</option>
						<option value="monthly">Monthly</option>
						<option value="yearly">Yearly</option>
					</select>
					<label class="when-every items-center gap-1.5">
						every
						<input
							type="number"
							name="interval"
							min="1"
							max="99"
							bind:value={interval}
							class="w-16 text-sm"
							aria-label="Interval"
						/>
						<span class="unit-daily">days</span><span class="unit-weeks">weeks</span><span
							class="unit-monthly">months</span
						><span class="unit-yearly">years</span>
					</label>
				</div>
				<div class="when-weekly flex-wrap gap-1" role="group" aria-label="On these days">
					{#each WEEKDAYS as day, i (day)}
						<label
							class="inline-flex cursor-pointer items-center gap-1 rounded-full border border-line px-2 py-1 text-xs has-checked:border-accent has-checked:bg-accent-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
						>
							<input
								type="checkbox"
								name="weekday"
								value={String(i + 1)}
								bind:group={weekdays}
								class="sr-only"
							/>
							{day}
						</label>
					{/each}
				</div>
				<label class="when-monthly items-center gap-1.5 text-sm">
					on the
					<select name="monthDay" bind:value={monthDay} class="text-sm">
						{#each Array.from({ length: 31 }, (_, i) => String(i + 1)) as d (d)}
							<option value={d}>{d}</option>
						{/each}
						<option value="last">last day</option>
					</select>
				</label>
				{#if repeatPreview}
					<p class="text-xs text-muted" aria-live="polite">{repeatPreview}</p>
				{/if}
			</fieldset>
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

<style>
	/* Show only the fields that apply, without JS too (driven by the selected option). */
	.repeat .when-every,
	.repeat .when-weekly,
	.repeat .when-monthly,
	.repeat [class^='unit-'] {
		display: none;
	}
	.repeat:not(:has(option[value='none']:checked)) .when-every {
		display: inline-flex;
	}
	.repeat:has(option[value='weekly']:checked) .when-weekly {
		display: flex;
	}
	.repeat:has(option[value='monthly']:checked) .when-monthly {
		display: inline-flex;
	}
	.repeat:has(option[value='daily']:checked) .unit-daily,
	.repeat:has(option[value='weekdays']:checked) .unit-weeks,
	.repeat:has(option[value='weekly']:checked) .unit-weeks,
	.repeat:has(option[value='monthly']:checked) .unit-monthly,
	.repeat:has(option[value='yearly']:checked) .unit-yearly {
		display: inline;
	}
</style>
