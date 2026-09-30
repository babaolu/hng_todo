/**
 * Search results rendered on the server (what a browser without JS gets): a notes
 * excerpt under the title only when the notes match, with markup shown as text.
 */
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { Task } from '$lib/types';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/navigation', () => ({ pushState: () => {}, goto: () => {} }));
vi.mock('$app/state', () => ({
	page: {
		url: new URL('http://localhost/search?q=rent'),
		state: {},
		data: { today: '2026-09-30', timeZone: 'UTC' },
		form: null
	}
}));

const TaskView = (await import('./TaskView.svelte')).default;

let n = 0;
function task(title: string, notes: string | null): Task {
	n += 1;
	return {
		id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
		userId: '00000000-0000-4000-8000-000000000000',
		listId: null,
		title,
		notes,
		order: `a${n}`,
		dueDate: null,
		pinnedToday: false,
		repeatRule: null,
		seriesId: null,
		completedAt: null,
		deletedAt: null,
		createdAt: new Date('2026-09-01T00:00:00Z'),
		updatedAt: new Date('2026-09-01T00:00:00Z')
	} as Task;
}

function search(tasks: Task[], words: string[]) {
	const { body } = render(TaskView, {
		props: {
			tasks,
			lists: [],
			listId: null,
			selected: null,
			mode: 'search',
			quickAdd: false,
			highlightWords: words,
			empty: 'No matches.',
			header: createRawSnippet(() => ({ render: () => '<h1>Search</h1>' }))
		}
	});
	return body;
}

/** The excerpt spans in the HTML, with Svelte's hydration comments removed. */
const excerpts = (html: string) =>
	[...html.matchAll(/<span[^>]*data-notes-excerpt[^>]*>([\s\S]*?)<\/span>/g)].map((m) =>
		m[1].replace(/<!--[\s\S]*?-->/g, '').trim()
	);

describe('search results without JS', () => {
	it('show a highlighted notes excerpt when the notes match', () => {
		const html = search([task('Monthly bills', 'Remember: the rent is due on the 1st')], ['rent']);
		expect(excerpts(html)).toEqual([
			'Remember: the <mark class="rounded-sm bg-accent-soft px-0.5 text-inherit">rent</mark> is due on the 1st'
		]);
	});

	it('show no excerpt when only the title matches', () => {
		const html = search([task('Pay the rent', 'Ask about the boiler too')], ['rent']);
		expect(html).toContain('<mark');
		expect(excerpts(html)).toEqual([]);
	});

	it('render HTML in notes as text, never as markup', () => {
		const html = search(
			[task('Snippet', '<script>alert("rent")</script><img src=x onerror=alert(1)>')],
			['rent']
		);
		const [shown] = excerpts(html);
		expect(shown).toContain('&lt;script>alert("<mark');
		expect(shown).toContain('&lt;/script>&lt;img src=x onerror=alert(1)>');
		expect(html).not.toMatch(/<script>alert|<img src=x/);
	});
});
