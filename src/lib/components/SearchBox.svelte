<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';

	type Props = {
		id: string;
		/** 'always': results update as you type. 'desktop': only at md+ (in the phone drawer, typing live would hide the results behind it). */
		live?: 'always' | 'desktop';
		class?: string;
	};
	let { id, live = 'always', class: className = '' }: Props = $props();

	const DEBOUNCE_MS = 250;
	const current = $derived(
		page.url.pathname === '/search' ? (page.url.searchParams.get('q') ?? '') : ''
	);
	let value = $state(untrack(() => current));
	let input = $state<HTMLInputElement>();
	let timer: ReturnType<typeof setTimeout> | undefined;

	// Follow the URL (e.g. the other search box), unless this one is being typed in.
	$effect(() => {
		const q = current;
		if (untrack(() => document.activeElement !== input)) value = q;
	});

	function oninput() {
		if (live === 'desktop' && !matchMedia('(min-width: 768px)').matches) return;
		clearTimeout(timer);
		timer = setTimeout(() => {
			const q = value.trim();
			goto(q ? `/search?q=${encodeURIComponent(q)}` : '/search', {
				keepFocus: true,
				noScroll: true,
				replaceState: page.url.pathname === '/search'
			});
		}, DEBOUNCE_MS);
	}
</script>

<!-- A plain GET form: Enter searches without JS too. -->
<form method="GET" action="/search" role="search" class={className}>
	<label for={id} class="sr-only">Search tasks</label>
	<input
		bind:this={input}
		{id}
		name="q"
		type="search"
		autocomplete="off"
		enterkeyhint="search"
		placeholder="Search"
		maxlength="200"
		bind:value
		{oninput}
		class="w-full py-1.5 text-sm"
	/>
</form>
