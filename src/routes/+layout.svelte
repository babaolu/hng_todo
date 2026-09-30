<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import Toasts from '$lib/components/Toasts.svelte';

	let { children } = $props();

	// Tell the server this browser's time zone so "today" is the user's day
	// (hooks.server.ts validates it and stores it on the user).
	onMount(() => {
		const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		if (!zone) return;
		const secure = location.protocol === 'https:' ? '; secure' : '';
		document.cookie = `tz=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax${secure}`;
		// First visit from a new zone: the page was rendered with the old one.
		if (page.data.timeZone && page.data.timeZone !== zone) invalidateAll();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Todo</title>
</svelte:head>

{@render children()}
<Toasts />
