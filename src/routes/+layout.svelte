<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import Toasts from '$lib/components/Toasts.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Todo</title>
</svelte:head>

{@render children()}
<Toasts />
