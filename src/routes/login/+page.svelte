<script lang="ts">
	import { enhance } from '$app/forms';

	let { form } = $props();
	let pending = $state(false);
</script>

<svelte:head><title>Log in · Todo</title></svelte:head>

<main class="grid min-h-dvh place-items-center px-4">
	<form
		method="POST"
		class="w-full max-w-sm space-y-4 rounded-xl border border-line bg-surface p-6 shadow-sm"
		use:enhance={() => {
			pending = true;
			return async ({ update }) => {
				await update({ reset: false });
				pending = false;
			};
		}}
	>
		<h1 class="text-xl font-semibold tracking-tight">Log in</h1>

		<div class="space-y-1">
			<label for="email" class="block text-sm font-medium">Email</label>
			<input
				id="email"
				name="email"
				type="email"
				autocomplete="username"
				required
				defaultValue={form?.email ?? ''}
				class="w-full"
			/>
		</div>
		<div class="space-y-1">
			<label for="password" class="block text-sm font-medium">Password</label>
			<input
				id="password"
				name="password"
				type="password"
				autocomplete="current-password"
				required
				class="w-full"
			/>
		</div>

		{#if form?.message}
			<p class="text-sm text-danger" role="alert">{form.message}</p>
		{/if}

		<button class="btn-primary w-full py-2" disabled={pending}>
			{pending ? 'Logging in…' : 'Log in'}
		</button>
	</form>
</main>
