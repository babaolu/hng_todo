<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	let guestPending = $state(false);
	let pending = $state(false);
	let showPassword = $state(false);
	// The show/hide button needs JS; without it the field stays a plain password field.
	let hydrated = $state(false);
	onMount(() => (hydrated = true));

	// Replaced with `false` in production builds, so the badge is compiled out.
	const localDatabase = import.meta.env.DEV;
</script>

<svelte:head><title>Log in · Todo</title></svelte:head>

<main class="grid min-h-dvh place-items-center px-4">
	<div class="w-full max-w-sm space-y-3">
		{#if localDatabase}
			<p class="flex justify-center">
				<span
					class="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-0.5 text-xs text-muted"
					title="pnpm dev: accounts here are local only. Production accounts don't exist in this database."
				>
					<span class="size-1.5 rounded-full bg-muted" aria-hidden="true"></span>
					Local database
				</span>
			</p>
		{/if}

		{#if data.guestMode}
			<form
				method="POST"
				action="?/guest"
				class="space-y-2 rounded-xl border border-accent/40 bg-accent-soft p-4 text-center"
				use:enhance={() => {
					guestPending = true;
					return async ({ update }) => {
						await update({ reset: false });
						guestPending = false;
					};
				}}
			>
				<button class="btn-primary w-full py-2.5 text-base" disabled={guestPending}>
					{guestPending ? 'Setting up…' : 'Continue as guest'}
				</button>
				<p class="text-sm text-muted">
					Try it without an account. Guest data is deleted after 7 days.
				</p>
				{#if form?.guestError}
					<p class="text-sm text-danger" role="alert">{form.guestError}</p>
				{/if}
			</form>
			<p class="text-center text-xs text-muted">or log in</p>
		{/if}

		<form
			method="POST"
			action="?/login"
			class="space-y-4 rounded-xl border border-line bg-surface p-6 shadow-sm"
			use:enhance={() => {
				pending = true;
				return async ({ result, update }) => {
					await update({ reset: false });
					pending = false;
					// Don't leave a password on screen after a failed attempt.
					if (result.type !== 'redirect') showPassword = false;
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
				<div class="relative">
					<input
						id="password"
						name="password"
						type={showPassword ? 'text' : 'password'}
						autocomplete="current-password"
						autocapitalize="off"
						spellcheck="false"
						required
						class="w-full {hydrated ? 'pr-11' : ''}"
					/>
					{#if hydrated}
						<button
							type="button"
							class="absolute inset-y-0 right-0 my-1 mr-1 grid w-9 place-items-center rounded-md text-muted hover:bg-raised hover:text-ink"
							aria-label={showPassword ? 'Hide password' : 'Show password'}
							aria-pressed={showPassword}
							aria-controls="password"
							onclick={() => (showPassword = !showPassword)}
						>
							<svg
								viewBox="0 0 24 24"
								class="size-5"
								fill="none"
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
								<circle cx="12" cy="12" r="3" />
								{#if showPassword}
									<path d="M4 4l16 16" />
								{/if}
							</svg>
						</button>
					{/if}
				</div>
			</div>

			{#if form?.message}
				<p class="text-sm text-danger" role="alert">{form.message}</p>
			{/if}

			<button class="btn-primary w-full py-2" disabled={pending}>
				{pending ? 'Logging in…' : 'Log in'}
			</button>
		</form>
	</div>
</main>
