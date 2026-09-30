<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import ShortcutsDialog from '$lib/components/ShortcutsDialog.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import {
		createDispatcher,
		onShortcut,
		runShortcut,
		SHORTCUTS,
		type ShortcutAction
	} from '$lib/keyboard';

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

	// ---- Keyboard: the app's one keydown listener (see $lib/keyboard) ----
	let shortcutsDialog = $state<ShortcutsDialog>();
	const desktop = () => matchMedia('(min-width: 768px)').matches;
	const focusField = (id: string) => {
		const el = document.getElementById(id);
		if (!el) return false;
		el.focus();
		return true;
	};

	onMount(() => {
		const dispatcher = createDispatcher(SHORTCUTS);
		// Capture phase: runs before row-level handlers (e.g. drag and drop's Space).
		const listener = (event: KeyboardEvent) => {
			const action = dispatcher.handle(event);
			if (action && runShortcut(action as ShortcutAction, event)) {
				event.preventDefault();
				event.stopPropagation();
			}
		};
		window.addEventListener('keydown', listener, { capture: true });

		const off = [
			onShortcut('quickAdd', () => (closeNav(), focusField('quick-add'))),
			onShortcut('search', () => {
				// Phones: the search page has its own box; elsewhere the sidebar's, in the drawer.
				if (!desktop() && focusField('search-page')) return true;
				if (!desktop() && navToggle) navToggle.checked = true;
				return focusField('search');
			}),
			onShortcut('goToday', () => (goto('/'), true)),
			onShortcut('goUpcoming', () => (goto('/upcoming'), true)),
			onShortcut('goInbox', () => (goto('/inbox'), true)),
			onShortcut('help', () => (shortcutsDialog?.open(), true)),
			// Esc: after the dialog (30) and the panel (20), the drawer, then clear focus.
			onShortcut(
				'escape',
				() => {
					if (!navToggle?.checked) return false;
					closeNav();
					return true;
				},
				10
			),
			onShortcut('escape', () => {
				const el = document.activeElement as HTMLElement | null;
				if (!el || el === document.body) return false;
				el.blur();
				return true;
			})
		];
		return () => {
			window.removeEventListener('keydown', listener, { capture: true });
			off.forEach((unregister) => unregister());
		};
	});
</script>

<ShortcutsDialog bind:this={shortcutsDialog} />

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
