<script lang="ts">
	import { enhance } from '$app/forms';
	import TaskView from '$lib/components/TaskView.svelte';

	let { data } = $props();
	let menu = $state<HTMLDetailsElement>();
</script>

<svelte:head><title>{data.list.name} · Todo</title></svelte:head>

<TaskView
	tasks={data.tasks}
	lists={data.lists}
	listId={data.list.id}
	selected={data.selected}
	empty="Nothing here yet."
>
	{#snippet header()}
		<div class="flex items-start gap-2">
			{#key data.list.id}
				<form
					method="POST"
					action="?/renameList"
					class="min-w-0 flex-1"
					use:enhance={({ formData, cancel }) => {
						const name = String(formData.get('name') ?? '').trim();
						if (!name || name === data.list.name) return cancel();
						return ({ update }) => update({ reset: false });
					}}
				>
					<input type="hidden" name="id" value={data.list.id} />
					<label for="list-name" class="sr-only">List name</label>
					<input
						id="list-name"
						name="name"
						type="text"
						required
						maxlength="100"
						defaultValue={data.list.name}
						onblur={(e) => e.currentTarget.form?.requestSubmit()}
						class="-ml-2 w-full border-transparent bg-transparent px-2 py-0.5 text-2xl font-semibold tracking-tight hover:border-line focus:bg-surface"
					/>
				</form>
			{/key}

			<details bind:this={menu} class="relative">
				<summary class="btn-ghost cursor-pointer list-none px-2.5 text-lg" aria-label="List actions"
					>⋯</summary
				>
				<div
					class="absolute right-0 z-10 mt-1 w-44 rounded-lg border border-line bg-surface p-1 shadow-lg"
				>
					<form
						method="POST"
						action="?/archiveList"
						use:enhance={() => {
							if (menu) menu.open = false;
							return ({ update }) => update();
						}}
					>
						<input type="hidden" name="id" value={data.list.id} />
						<input type="hidden" name="archived" value={String(!data.list.archived)} />
						<button class="btn-ghost w-full justify-start"
							>{data.list.archived ? 'Unarchive' : 'Archive'}</button
						>
					</form>
					<form
						method="POST"
						action="?/deleteList"
						use:enhance={({ cancel }) => {
							if (!confirm(`Delete “${data.list.name}”? Its tasks move to the Inbox.`))
								return cancel();
						}}
					>
						<input type="hidden" name="id" value={data.list.id} />
						<button class="btn-danger w-full justify-start">Delete list…</button>
					</form>
				</div>
			</details>
		</div>
		{#if data.list.archived}
			<p class="text-sm text-muted">This list is archived.</p>
		{/if}
	{/snippet}
</TaskView>
