<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { isTyping } from '$lib/actions';
	import Sidebar from '$lib/components/Sidebar.svelte';

	let { data, children } = $props();
	// Not bound with bind:checked: hydration would undo a tap made before JS loaded.
	let navToggle = $state<HTMLInputElement>();
	const closeNav = () => navToggle && (navToggle.checked = false);

	// Guest banner: dismissible for this browser session (needs JS; without it, it stays).
	const BANNER_KEY = 'guest-banner-dismissed';
	let bannerDismissed = $state(false);
	let hydrated = $state(false);
	onMount(() => {
		hydrated = true;
		try {
			bannerDismissed = sessionStorage.getItem(BANNER_KEY) === '1';
		} catch {
			// storage unavailable: keep showing it
		}
	});
	function dismissBanner() {
		bannerDismissed = true;
		try {
			sessionStorage.setItem(BANNER_KEY, '1');
		} catch {
			// fine: dismissed for this page view
		}
	}

	afterNavigate(({ type }) => {
		if (type !== 'enter') closeNav();
	});

	function onKey(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event)) return;
		if (event.key === 'n' || event.key === '/') {
			const input = document.getElementById('quick-add');
			if (!input) return;
			event.preventDefault();
			closeNav();
			input.focus();
		} else if (event.key === 'Escape') {
			closeNav();
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="min-h-dvh">
	<!-- Mobile drawer: a checkbox so it also opens without JavaScript. -->
	<input
		id="nav-toggle"
		type="checkbox"
		class="peer sr-only md:hidden"
		aria-label="Show lists"
		bind:this={navToggle}
	/>
	<label
		for="nav-toggle"
		aria-hidden="true"
		class="fixed inset-0 z-30 hidden bg-black/40 peer-checked:block md:peer-checked:hidden"
	></label>
	<aside
		class="fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] -translate-x-full border-r border-line bg-surface transition-transform peer-checked:translate-x-0 md:w-64 md:translate-x-0"
	>
		<Sidebar lists={data.lists} counts={data.counts} email={data.email} guest={!!data.guest} />
	</aside>

	<div class="md:pl-64">
		<header
			class="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-line bg-canvas/90 px-2 backdrop-blur md:hidden"
		>
			<label for="nav-toggle" class="btn-ghost cursor-pointer px-2.5 text-lg" title="Lists"
				>☰</label
			>
			<span class="text-sm font-semibold">Todo</span>
		</header>
		{#if data.guest && !bannerDismissed}
			<div
				class="flex items-start gap-2 border-b border-line bg-raised px-4 py-2 text-sm text-muted md:px-8"
				role="status"
			>
				<p class="min-w-0 flex-1">
					You're using a temporary guest account. It will be deleted on {data.guest.deletesOn}.
				</p>
				{#if hydrated}
					<button
						type="button"
						class="-my-1 shrink-0 rounded px-2 py-1 hover:bg-canvas hover:text-ink"
						aria-label="Dismiss"
						onclick={dismissBanner}>✕</button
					>
				{/if}
			</div>
		{/if}
		<main class="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-10">
			{@render children()}
		</main>
	</div>
</div>
