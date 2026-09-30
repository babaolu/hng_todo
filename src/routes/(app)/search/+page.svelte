<script lang="ts">
	import SearchBox from '$lib/components/SearchBox.svelte';
	import TaskView from '$lib/components/TaskView.svelte';

	let { data } = $props();
	const tooShort = $derived(data.words.length === 0);
</script>

<svelte:head><title>{data.q ? `${data.q} · ` : ''}Search · Todo</title></svelte:head>

<TaskView
	tasks={data.tasks}
	lists={data.lists}
	listId={null}
	selected={data.selected}
	mode="search"
	quickAdd={false}
	highlightWords={data.words}
	empty={tooShort ? 'Type at least 2 characters to search.' : `No tasks match “${data.q}”.`}
>
	{#snippet header()}
		<h1 class="text-2xl font-semibold tracking-tight">Search</h1>
		<!-- On phones the sidebar box is in the drawer; search here instead. -->
		<SearchBox id="search-page" class="md:hidden" />
		{#if !tooShort && data.tasks.length}
			<p class="text-sm text-muted" aria-live="polite">
				{data.tasks.length === 100 ? 'The first 100 results' : `${data.tasks.length} found`}
			</p>
		{/if}
	{/snippet}
</TaskView>
