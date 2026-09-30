<script lang="ts">
	import TaskView from '$lib/components/TaskView.svelte';

	let { data } = $props();
</script>

<svelte:head><title>Upcoming · Todo</title></svelte:head>

<TaskView
	tasks={data.tasks}
	lists={data.lists}
	listId={null}
	selected={data.selected}
	mode="upcoming"
	empty="Nothing in the next 14 days."
>
	{#snippet header()}
		<h1 class="text-2xl font-semibold tracking-tight">Upcoming</h1>
	{/snippet}
</TaskView>
