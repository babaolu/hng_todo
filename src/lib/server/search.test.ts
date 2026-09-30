import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tasks } from './db/schema';
import type { Db } from './db/types';
import { createTaskStore, escapeLike, searchWords } from './tasks';
import { createTestDb, createUser } from './test/db';

let db: Db;
let close: () => Promise<void>;
let userId: string;
let store: ReturnType<typeof createTaskStore>;

beforeAll(async () => {
	({ db, close } = await createTestDb());
	userId = await createUser(db, 'me@example.com');
	store = createTaskStore(db);
});
afterAll(() => close());
beforeEach(async () => {
	await db.delete(tasks);
});

async function add(
	title: string,
	notes: string | null = null,
	extra: { done?: boolean; deleted?: boolean; due?: string } = {}
) {
	const t = (await store.create(userId, { title, listId: null, dueDate: extra.due ?? null }))!;
	if (notes) await store.update(userId, t.id, { notes });
	if (extra.done) await store.setCompleted(userId, t.id, true);
	if (extra.deleted) await store.remove(userId, t.id);
	return t;
}
const titles = async (q: string) => (await store.search(userId, q)).map((t) => t.title);

describe('search', () => {
	it('matches titles and notes, case-insensitively', async () => {
		await add('Pay the RENT');
		await add('Call landlord', 'about the rent increase');
		await add('Buy milk');
		expect((await titles('rent')).sort()).toEqual(['Call landlord', 'Pay the RENT']);
	});

	it('needs every word, in either field', async () => {
		await add('Pay rent', 'by bank transfer');
		await add('Pay the plumber');
		await add('Rent a car', null);
		expect(await titles('pay bank')).toEqual(['Pay rent']);
		expect((await titles('pay')).sort()).toEqual(['Pay rent', 'Pay the plumber']);
		expect(await titles('pay car')).toEqual([]);
	});

	it('treats % and _ literally', async () => {
		await add('50% discount');
		await add('500 discount');
		await add('snake_case rename');
		await add('snakeXcase rename');
		expect(await titles('50%')).toEqual(['50% discount']);
		expect(await titles('snake_case')).toEqual(['snake_case rename']);
		expect(await titles('%%')).toEqual([]);
		expect(await titles('__')).toEqual([]);
	});

	it('treats a backslash literally', async () => {
		await add('C:\\temp cleanup');
		await add('C:temp cleanup');
		expect(await titles('c:\\temp')).toEqual(['C:\\temp cleanup']);
	});

	it('excludes soft-deleted tasks, includes completed ones after open ones', async () => {
		await add('report draft', null, { done: true });
		await add('report final', null, { due: '2026-10-05' });
		await add('report deleted', null, { deleted: true });
		expect(await titles('report')).toEqual(['report final', 'report draft']);
	});

	it('shows nothing for queries under 2 characters', async () => {
		await add('a');
		expect(await titles('a')).toEqual([]);
		expect(await titles('  a ')).toEqual([]);
		expect(await titles('')).toEqual([]);
	});

	it('returns at most 100 results', async () => {
		await db
			.insert(tasks)
			.values(
				Array.from({ length: 120 }, (_, i) => ({ userId, title: `item ${i}`, order: `a${i}` }))
			);
		expect((await store.search(userId, 'item')).length).toBe(100);
	});

	it('helpers', () => {
		expect(escapeLike('50%_\\x')).toBe('50\\%\\_\\\\x');
		expect(searchWords('  pay   rent ')).toEqual(['pay', 'rent']);
		expect(searchWords('x')).toEqual([]);
	});
});
