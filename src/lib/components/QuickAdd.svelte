<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { failureMessage } from '$lib/actions';
	import { toasts } from '$lib/toasts.svelte';

	type Props = {
		listId: string | null;
		placeholder: string;
		/** Show the new task immediately; the refresh after saving replaces it. */
		onadd?: (title: string) => void;
		/** Toast shown once saved, for views where the new task isn't visible. */
		addedMessage?: string;
	};
	let { listId, placeholder, onadd, addedMessage }: Props = $props();
</script>

<form
	method="POST"
	action="?/addTask"
	class="relative"
	use:enhance={({ formData, formElement, cancel }) => {
		const title = String(formData.get('title') ?? '').trim();
		if (!title) return cancel();
		onadd?.(title);
		formElement.reset();
		return async ({ result, update }) => {
			await update({ reset: false });
			if (result.type !== 'success') toasts.show(failureMessage(result));
			else if (addedMessage) toasts.show(addedMessage);
		};
	}}
>
	<input type="hidden" name="listId" value={listId ?? 'inbox'} />
	<label for="quick-add" class="sr-only">New task</label>
	<input
		id="quick-add"
		name="title"
		type="text"
		autocomplete="off"
		maxlength="500"
		enterkeyhint="done"
		{placeholder}
		class="w-full rounded-lg py-2.5 pr-16 pl-10 shadow-xs"
	/>
	<span class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-lg text-muted"
		>+</span
	>
	<kbd
		class="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border border-line px-1.5 text-xs text-muted sm:block"
		>N</kbd
	>
	{#if page.form?.addError}
		<p class="mt-1 text-sm text-danger">{page.form.addError}</p>
	{/if}
</form>
