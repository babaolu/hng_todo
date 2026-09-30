<script lang="ts">
	import TaskView from '$lib/components/TaskView.svelte';

	let { data } = $props();
</script>

<svelte:head><title>Inbox · Todo</title></svelte:head>

<TaskView
	tasks={data.tasks}
	lists={data.lists}
	listId={null}
	selected={data.selected}
	empty="Tasks without a list land here."
>
	{#snippet header()}
		<h1 class="text-2xl font-semibold tracking-tight">Inbox</h1>
	{/snippet}
</TaskView>
