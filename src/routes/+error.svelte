<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head><title>{page.status} · Todo</title></svelte:head>

<main class="grid min-h-dvh place-items-center px-4 text-center">
	<div class="space-y-3">
		<p class="text-5xl font-semibold text-muted">{page.status}</p>
		<p>{page.error?.message}</p>
		<a href="/" class="btn-primary">Go to Inbox</a>
	</div>
</main>
