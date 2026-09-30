/**
 * The quick-add form action, run for real against PGlite: the server re-parses
 * the text itself, a date picked in the chip overrides the parsed one, and
 * parse=false keeps the text literal.
 */
import { isActionFailure, type RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { todayIn } from '$lib/dates';
import { createAuthStore } from './auth';
import type { Db } from './db/types';
import { createListStore } from './lists';
import { createTaskStore } from './tasks';
import { createTestDb, createUser } from './test/db';

const stores = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock('./data', () => ({ data: stores }));

const { dateOrderFor, taskActions } = await import('./actions');

let db: Db;
let close: () => Promise<void>;
let userId: string;
const ZONE = 'Africa/Lagos';

beforeAll(async () => {
	({ db, close } = await createTestDb());
	userId = await createUser(db, 'me@example.com');
	Object.assign(stores, {
		auth: createAuthStore(db),
		lists: createListStore(db),
		tasks: createTaskStore(db)
	});
});
afterAll(() => close());

function event(fields: Record<string, string>, headers: Record<string, string> = {}) {
	const body = new FormData();
	for (const [key, value] of Object.entries({ listId: 'inbox', ...fields })) body.set(key, value);
	return {
		locals: { user: { id: userId, email: 'me@example.com', timeZone: ZONE } },
		request: new Request('http://localhost/?/addTask', { method: 'POST', body, headers })
	} as unknown as RequestEvent;
}

async function add(fields: Record<string, string>, headers?: Record<string, string>) {
	const result = await taskActions.addTask(event(fields, headers));
	if (isActionFailure(result)) return { status: result.status, data: result.data };
	return {
		status: 200,
		task: (result as { added: { title: string; dueDate: string | null } }).added
	};
}

describe('addTask: a date picked in the chip', () => {
	it('overrides the parsed date, and the phrase is still stripped from the title', async () => {
		const r = await add({ title: 'pay rent tomorrow', dueDate: '2030-01-15' });
		expect(r.task).toMatchObject({ title: 'pay rent', dueDate: '2030-01-15' });
	});

	it('without a picked date, the server uses its own parse', async () => {
		const r = await add({ title: 'pay rent tomorrow' });
		const tomorrow = new Date(Date.parse(todayIn(ZONE)) + 86_400_000).toISOString().slice(0, 10);
		expect(r.task).toMatchObject({ title: 'pay rent', dueDate: tomorrow });
	});

	it.each(['2030-02-30', '15/01/2030', '2030-1-15', 'tomorrow', '2030-01-15T00:00:00Z'])(
		'rejects an invalid dueDate %s with 400 and creates nothing',
		async (dueDate) => {
			const r = await add({ title: `invalid ${dueDate}`, dueDate });
			expect(r.status).toBe(400);
			expect((await db.query.tasks.findMany()).some((t) => t.title.startsWith('invalid'))).toBe(
				false
			);
		}
	);

	it('parse=false wins: the text stays literal and dueDate is ignored', async () => {
		const r = await add({ title: 'call May tomorrow', parse: 'false', dueDate: '2030-01-15' });
		expect(r.task).toMatchObject({ title: 'call May tomorrow', dueDate: null });
		// ...even a malformed one, since it isn't used
		const r2 = await add({ title: 'literal', parse: 'false', dueDate: 'garbage' });
		expect(r2.task).toMatchObject({ title: 'literal', dueDate: null });
	});
});

describe('addTask: slash-date order', () => {
	it('uses the dateOrder field: dmy by default, mdy when sent', async () => {
		expect((await add({ title: 'exam 10/3/2030', dateOrder: 'dmy' })).task?.dueDate).toBe(
			'2030-03-10'
		);
		expect((await add({ title: 'exam 10/3/2030', dateOrder: 'mdy' })).task?.dueDate).toBe(
			'2030-10-03'
		);
	});

	it('treats an unexpected dateOrder as dmy', async () => {
		expect((await add({ title: 'exam 10/3/2030', dateOrder: 'ymd' })).task?.dueDate).toBe(
			'2030-03-10'
		);
	});

	it('without the field (no JS), falls back to Accept-Language', async () => {
		const us = await add({ title: 'exam 10/3/2030' }, { 'accept-language': 'en-US,en;q=0.9' });
		const gb = await add({ title: 'exam 10/3/2030' }, { 'accept-language': 'en-GB,en;q=0.9' });
		const none = await add({ title: 'exam 10/3/2030' });
		expect([us.task?.dueDate, gb.task?.dueDate, none.task?.dueDate]).toEqual([
			'2030-10-03',
			'2030-03-10',
			'2030-03-10'
		]);
	});

	it('dateOrderFor validates the field', () => {
		const req = new Request('http://localhost', { headers: { 'accept-language': 'en-US' } });
		const form = (v?: string) => {
			const f = new FormData();
			if (v !== undefined) f.set('dateOrder', v);
			return f;
		};
		expect(dateOrderFor(form('mdy'), req)).toBe('mdy');
		expect(dateOrderFor(form('dmy'), req)).toBe('dmy');
		expect(dateOrderFor(form('<script>'), req)).toBe('dmy');
		expect(dateOrderFor(form(), req)).toBe('mdy');
	});
});
