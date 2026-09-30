<svelte:head><title>Leave guest account · Todo</title></svelte:head>

<main class="grid min-h-dvh place-items-center px-4">
	<form
		method="POST"
		class="w-full max-w-sm space-y-4 rounded-xl border border-line bg-surface p-6 shadow-sm"
	>
		<h1 class="text-xl font-semibold tracking-tight">Leave and delete guest data?</h1>
		<p class="text-sm text-muted">
			This deletes your guest account and all its tasks and lists right now. It can't be undone.
		</p>
		<div class="flex flex-wrap items-center gap-2">
			<button class="btn w-full bg-danger py-2 text-canvas hover:opacity-90 sm:w-auto"
				>Delete and leave</button
			>
			<a href="/" class="btn-ghost w-full sm:w-auto">Cancel</a>
		</div>
	</form>
</main>
