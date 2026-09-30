import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => nav);
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/search?q=rent'), data: {}, form: null }
}));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import QuickAdd from './QuickAdd.svelte';
import SearchBox from './SearchBox.svelte';

let component: ReturnType<typeof mount> | undefined;
beforeEach(() => {
	window.matchMedia = ((query: string) => ({
		matches: true,
		media: query,
		addEventListener() {},
		removeEventListener() {}
	})) as unknown as typeof window.matchMedia;
	nav.goto.mockClear();
});
afterEach(() => {
	if (component) unmount(component);
	component = undefined;
	document.body.innerHTML = '';
	vi.useRealTimers();
});

/** Presses Esc in the field; returns the event and whether it reached the document. */
function escape(input: HTMLInputElement) {
	let bubbled = false;
	const spy = () => (bubbled = true);
	document.addEventListener('keydown', spy);
	const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
	input.dispatchEvent(event);
	document.removeEventListener('keydown', spy);
	flushSync();
	return { prevented: event.defaultPrevented, bubbled };
}

function type(input: HTMLInputElement, text: string) {
	input.value = text;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

describe('Esc in the search box', () => {
	function setup() {
		component = mount(SearchBox, { target: document.body, props: { id: 'search' } });
		const input = document.getElementById('search') as HTMLInputElement;
		input.focus();
		return input;
	}

	it('clears the query (and updates the results), then a second Esc leaves the box', () => {
		vi.useFakeTimers();
		const input = setup();
		expect(input.value).toBe('rent'); // from the URL

		const first = escape(input);
		expect(input.value).toBe('');
		expect(document.activeElement).toBe(input);
		expect(first).toEqual({ prevented: true, bubbled: false });
		vi.runAllTimers();
		expect(nav.goto).toHaveBeenCalledWith('/search', expect.objectContaining({ keepFocus: true }));

		escape(input);
		expect(document.activeElement).not.toBe(input);
	});

	it('leaves an empty box straight away', () => {
		const input = setup();
		type(input, '');
		escape(input);
		expect(document.activeElement).not.toBe(input);
		expect(input.value).toBe('');
	});
});

describe('Esc in quick-add', () => {
	function setup() {
		component = mount(QuickAdd, {
			target: document.body,
			props: {
				listId: null,
				lists: [{ id: 'home', name: 'Home' }],
				today: '2026-09-30',
				view: 'list',
				placeholder: 'Add a task…'
			}
		});
		const input = document.getElementById('quick-add') as HTMLInputElement;
		input.focus();
		return input;
	}
	const parse = () => document.querySelector<HTMLInputElement>('input[name="parse"]')!.value;
	const chips = () => document.getElementById('quick-add-chips')!.textContent!.trim();

	it('with chips showing, keeps the text as typed and stays in the box', () => {
		const input = setup();
		type(input, 'pay rent fri #home');
		expect(chips()).toContain('Fri 2 Oct');

		expect(escape(input)).toEqual({ prevented: true, bubbled: false });
		expect(parse()).toBe('false');
		expect(chips()).not.toContain('Fri 2 Oct');
		expect(input.value).toBe('pay rent fri #home');
		expect(document.activeElement).toBe(input);

		// No chips now: the next Esc leaves the box, keeping the text.
		escape(input);
		expect(document.activeElement).not.toBe(input);
		expect(input.value).toBe('pay rent fri #home');
	});

	it('without chips, leaves the box and keeps the text', () => {
		const input = setup();
		type(input, 'buy milk');
		expect(escape(input)).toEqual({ prevented: true, bubbled: false });
		expect(document.activeElement).not.toBe(input);
		expect(input.value).toBe('buy milk');
		expect(parse()).toBe('true');
	});
});
