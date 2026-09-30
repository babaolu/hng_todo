import { deserialize } from '$app/forms';
import { goto, invalidateAll } from '$app/navigation';
import type { ActionResult } from '@sveltejs/kit';
import { toasts } from './toasts.svelte';

let queue: Promise<unknown> = Promise.resolve();
let pending = 0;

/**
 * POST to a form action on the current page from script (drag and drop,
 * keyboard shortcuts, undo). Calls run one at a time, in order, so quick
 * successive moves reach the server in the order they were made. Page data is
 * refreshed once the queue drains, or immediately on failure, which rolls back
 * whatever the caller changed optimistically.
 */
export function postAction(
	name: string,
	fields: Record<string, string | null | undefined>
): Promise<ActionResult> {
	pending++;
	const run = queue.then(() => send(name, fields));
	queue = run.catch(() => {});
	return run.then(async (result) => {
		pending--;
		if (result.type === 'redirect') {
			await goto(result.location, { invalidateAll: true });
		} else if (result.type !== 'success') {
			toasts.show(failureMessage(result));
			await invalidateAll();
		} else if (pending === 0) {
			await invalidateAll();
		}
		return result;
	});
}

async function send(
	name: string,
	fields: Record<string, string | null | undefined>
): Promise<ActionResult> {
	const body = new FormData();
	for (const [key, value] of Object.entries(fields)) body.set(key, value ?? '');
	try {
		const response = await fetch(`?/${name}`, {
			method: 'POST',
			body,
			headers: { 'x-sveltekit-action': 'true' }
		});
		return deserialize(await response.text());
	} catch {
		return { type: 'error', error: new Error('Network error') };
	}
}

export function failureMessage(result: ActionResult): string {
	if (result.type === 'failure') {
		const message = Object.values(result.data ?? {}).find((v) => typeof v === 'string');
		if (message) return message as string;
	}
	return "Something went wrong. Your change wasn't saved.";
}

/** True when a keypress should go to a text field rather than a shortcut. */
export function isTyping(event: KeyboardEvent): boolean {
	const el = event.target as HTMLElement | null;
	return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

export const isTemp = (id: string) => id.startsWith('temp-');

/** The nearest saved items either side of index `i` (skipping optimistic placeholders). */
export function neighbours(items: { id: string }[], i: number) {
	const before = items.slice(0, i).findLast((item) => !isTemp(item.id));
	const after = items.slice(i + 1).find((item) => !isTemp(item.id));
	return { prevId: before?.id ?? null, nextId: after?.id ?? null };
}
