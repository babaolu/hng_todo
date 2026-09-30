<script lang="ts">
	import TaskView from '$lib/components/TaskView.svelte';

	let { data } = $props();
</script>

<svelte:head><title>Logbook · Todo</title></svelte:head>

<TaskView
	tasks={data.tasks}
	lists={data.lists}
	listId={null}
	selected={data.selected}
	mode="logbook"
	empty="Completed tasks show up here."
>
	{#snippet header()}
		<h1 class="text-2xl font-semibold tracking-tight">Logbook</h1>
	{/snippet}
</TaskView>
