<script lang="ts">
	let { data } = $props();
</script>

<svelte:head><title>Settings · Todo</title></svelte:head>

<div class="space-y-8">
	<h1 class="text-2xl font-semibold tracking-tight">Settings</h1>

	<section class="space-y-3 rounded-xl border border-line bg-surface p-5">
		<h2 class="font-semibold">Your data</h2>
		<p class="text-sm text-muted">
			A JSON file with all your lists (archived ones too) and tasks, open and completed. It doesn't
			include deleted tasks or any account details.
		</p>
		<a href="/settings/export" download class="btn-primary">Download my data (JSON)</a>
		{#if data.guest}
			<p class="text-sm text-muted">
				Guest data is deleted on {data.guest.deletesOn}: download it first if you want to keep it.
			</p>
		{/if}
	</section>
</div>
