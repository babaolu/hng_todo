<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { isTyping } from '$lib/actions';
	import Sidebar from '$lib/components/Sidebar.svelte';

	let { data, children } = $props();
	// Not bound with bind:checked: hydration would undo a tap made before JS loaded.
	let navToggle = $state<HTMLInputElement>();
	const closeNav = () => navToggle && (navToggle.checked = false);

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
		<Sidebar lists={data.lists} counts={data.counts} email={data.email} />
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
		<main class="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-10">
			{@render children()}
		</main>
	</div>
</div>
