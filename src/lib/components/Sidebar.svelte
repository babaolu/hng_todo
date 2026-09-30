<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { flip } from 'svelte/animate';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import { failureMessage, neighbours, postAction } from '$lib/actions';
	import { toasts } from '$lib/toasts.svelte';
	import type { List } from '$lib/types';

	type Props = { lists: List[]; counts: Record<string, number>; email: string };
	let { lists, counts, email }: Props = $props();

	let active = $derived(lists.filter((l) => !l.archived));
	const archived = $derived(lists.filter((l) => l.archived));
	const FLIP_MS = 150;

	function consider(event: CustomEvent<DndEvent<List>>) {
		active = event.detail.items;
	}

	function finalize(event: CustomEvent<DndEvent<List>>) {
		active = event.detail.items;
		const index = active.findIndex((l) => l.id === event.detail.info.id);
		if (index !== -1)
			postAction('reorderList', { id: active[index].id, ...neighbours(active, index) });
	}

	function onListKey(event: KeyboardEvent, index: number) {
		if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
		event.preventDefault();
		const target = index + (event.key === 'ArrowUp' ? -1 : 1);
		if (target < 0 || target >= active.length) return;
		const next = [...active];
		const [list] = next.splice(index, 1);
		next.splice(target, 0, list);
		active = next;
		postAction('reorderList', { id: list.id, ...neighbours(next, target) });
		requestAnimationFrame(() =>
			document.querySelector<HTMLElement>(`[data-list-id="${list.id}"]`)?.focus()
		);
	}

	const isCurrent = (href: string) => page.url.pathname === href;
	const link = (href: string) =>
		`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
			isCurrent(href) ? 'bg-accent-soft font-medium text-ink' : 'text-ink hover:bg-raised'
		}`;
</script>

<nav class="flex h-full flex-col gap-6 overflow-y-auto p-3" aria-label="Main">
	<div class="px-2 pt-1 text-sm font-semibold tracking-tight">Todo</div>

	<ul class="space-y-px">
		<li>
			<a href="/" class={link('/')}>
				<span class="w-4 text-center text-accent" aria-hidden="true">★</span>
				<span class="flex-1">Today</span>
				{#if counts.today}<span class="text-xs text-muted">{counts.today}</span>{/if}
			</a>
		</li>
		<li>
			<a href="/upcoming" class={link('/upcoming')}>
				<span class="w-4 text-center text-muted" aria-hidden="true">▦</span>
				<span class="flex-1">Upcoming</span>
			</a>
		</li>
		<li>
			<a href="/inbox" class={link('/inbox')}>
				<span class="w-4 text-center text-muted" aria-hidden="true">▢</span>
				<span class="flex-1">Inbox</span>
				{#if counts.inbox}<span class="text-xs text-muted">{counts.inbox}</span>{/if}
			</a>
		</li>
	</ul>

	<section class="space-y-1">
		<h2 class="px-2 text-xs font-medium tracking-wide text-muted uppercase">Lists</h2>
		<ul
			class="space-y-px"
			aria-label="Lists"
			use:dndzone={{
				items: active,
				flipDurationMs: FLIP_MS,
				delayTouchStart: 250,
				dropTargetStyle: {},
				type: 'lists'
			}}
			onconsider={consider}
			onfinalize={finalize}
		>
			{#each active as list, index (list.id)}
				<li animate:flip={{ duration: FLIP_MS }} class="rounded-md">
					<a
						href="/lists/{list.id}"
						draggable="false"
						data-list-id={list.id}
						onkeydown={(e) => onListKey(e, index)}
						class={link(`/lists/${list.id}`)}
					>
						<span class="w-4 text-center text-muted" aria-hidden="true">•</span>
						<span class="min-w-0 flex-1 truncate">{list.name}</span>
						{#if counts[list.id]}<span class="text-xs text-muted">{counts[list.id]}</span>{/if}
					</a>
				</li>
			{/each}
		</ul>

		<form
			method="POST"
			action="?/createList"
			class="px-1 pt-1"
			use:enhance={({ formData, cancel }) => {
				if (!String(formData.get('name') ?? '').trim()) return cancel();
				return async ({ result, update }) => {
					await update();
					if (result.type === 'failure' || result.type === 'error')
						toasts.show(failureMessage(result));
				};
			}}
		>
			<label for="new-list" class="sr-only">New list name</label>
			<input
				id="new-list"
				name="name"
				type="text"
				maxlength="100"
				autocomplete="off"
				placeholder="+ New list"
				class="w-full border-transparent bg-transparent px-2 py-1.5 text-sm hover:bg-raised focus:bg-surface"
			/>
			{#if page.form?.listError}<p class="px-2 pt-1 text-xs text-danger">
					{page.form.listError}
				</p>{/if}
		</form>
	</section>

	<ul class="space-y-px">
		<li>
			<a href="/logbook" class={link('/logbook')}>
				<span class="w-4 text-center text-muted" aria-hidden="true">✓</span>
				<span class="flex-1">Logbook</span>
			</a>
		</li>
	</ul>

	{#if archived.length}
		<details class="group">
			<summary
				class="cursor-pointer list-none px-2 text-xs font-medium tracking-wide text-muted uppercase hover:text-ink"
			>
				Archived ({archived.length})
			</summary>
			<ul class="mt-1 space-y-px">
				{#each archived as list (list.id)}
					<li>
						<a href="/lists/{list.id}" class="{link(`/lists/${list.id}`)} text-muted">
							<span class="min-w-0 flex-1 truncate">{list.name}</span>
						</a>
					</li>
				{/each}
			</ul>
		</details>
	{/if}

	<div class="mt-auto flex items-center gap-2 border-t border-line px-2 pt-3">
		<span class="min-w-0 flex-1 truncate text-xs text-muted" title={email}>{email}</span>
		<form method="POST" action="/logout">
			<button class="btn-ghost px-2 py-1 text-xs">Log out</button>
		</form>
	</div>
</nav>
