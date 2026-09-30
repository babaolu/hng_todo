<script lang="ts">
	import TaskView from '$lib/components/TaskView.svelte';

	let { data } = $props();
</script>

<svelte:head><title>Today · Todo</title></svelte:head>

<TaskView
	tasks={data.tasks}
	lists={data.lists}
	listId={null}
	selected={data.selected}
	mode="today"
	empty="Nothing due today. Pin a task or add one with a date, like ‘call mum fri’."
>
	{#snippet header()}
		<h1 class="text-2xl font-semibold tracking-tight">Today</h1>
	{/snippet}
</TaskView>
