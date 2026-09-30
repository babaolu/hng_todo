import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { lists, tasks } from './db/schema';
import type { Db } from './db/types';
import { createListStore } from './lists';
import { createTaskStore } from './tasks';
import { createTestDb, createUser } from './test/db';

let db: Db;
let close: () => Promise<void>;
let userId: string;
let taskStore: ReturnType<typeof createTaskStore>;
let listStore: ReturnType<typeof createListStore>;

beforeAll(async () => {
	({ db, close } = await createTestDb());
	userId = await createUser(db, 'me@example.com');
	taskStore = createTaskStore(db);
	listStore = createListStore(db);
});
afterAll(() => close());
beforeEach(async () => {
	await db.delete(tasks);
	await db.delete(lists);
});

/** Create tasks so they display in the given order (new tasks go on top). */
async function seed(titles: string[], listId: string | null = null) {
	const ids: Record<string, string> = {};
	for (const title of [...titles].reverse()) {
		ids[title] = (await taskStore.create(userId, { title, listId }))!.id;
	}
	return ids;
}
const titles = async (listId: string | null = null) =>
	(await taskStore.listActive(userId, listId)).map((t) => t.title);

describe('fractional ordering', () => {
	it('new tasks go to the top', async () => {
		await seed(['a', 'b', 'c']);
		expect(await titles()).toEqual(['a', 'b', 'c']);
	});

	it('moving a task between two others places it there', async () => {
		const id = await seed(['a', 'b', 'c', 'd']);
		await taskStore.reorder(userId, id.d, id.a, id.b);
		expect(await titles()).toEqual(['a', 'd', 'b', 'c']);
		await taskStore.reorder(userId, id.a, id.b, id.c);
		expect(await titles()).toEqual(['d', 'b', 'a', 'c']);
	});

	it('only the moved row is written', async () => {
		const id = await seed(['a', 'b', 'c']);
		const before = await taskStore.listActive(userId, null);
		await taskStore.reorder(userId, id.c, id.a, id.b);
		const after = await taskStore.listActive(userId, null);
		const changed = after.filter((t) => before.find((o) => o.id === t.id)!.order !== t.order);
		expect(changed.map((t) => t.title)).toEqual(['c']);
	});

	it('moves to the start and the end', async () => {
		const id = await seed(['a', 'b', 'c']);
		await taskStore.reorder(userId, id.c, null, id.a);
		expect(await titles()).toEqual(['c', 'a', 'b']);
		await taskStore.reorder(userId, id.c, id.b, null);
		expect(await titles()).toEqual(['a', 'b', 'c']);
	});

	it('survives many moves into the same gap', async () => {
		const id = await seed(['a', 'b', 'x', 'y']);
		// Repeatedly drop the next item right after 'a'.
		for (let i = 0; i < 30; i++) {
			const current = await taskStore.listActive(userId, null);
			const last = current[current.length - 1];
			await taskStore.reorder(userId, last.id, id.a, current[1].id);
		}
		const result = await titles();
		expect(result[0]).toBe('a');
		expect(result).toHaveLength(4);
	});

	it('sorts keys byte-wise, not by locale (upper case before lower case)', async () => {
		const id = await seed(['a', 'b']);
		// Force keys whose locale order differs from byte order.
		await db.update(tasks).set({ order: 'a0' }).where(eqId(id.a));
		await db.update(tasks).set({ order: 'Zz' }).where(eqId(id.b));
		expect(await titles()).toEqual(['b', 'a']);
	});

	it('recovers when neighbours have duplicate keys', async () => {
		const id = await seed(['a', 'b', 'c']);
		await db.update(tasks).set({ order: 'a1' }).where(eqId(id.a));
		await db.update(tasks).set({ order: 'a1' }).where(eqId(id.b));
		await db.update(tasks).set({ order: 'a2' }).where(eqId(id.c));
		expect(await taskStore.reorder(userId, id.c, id.a, id.b)).not.toBeNull();
		const order = await titles();
		expect(order.indexOf('c')).toBeGreaterThan(order.indexOf('a'));
	});

	it('reorders only within the task list; neighbours from another list are rejected', async () => {
		const list = await listStore.create(userId, 'Work');
		const inbox = await seed(['a', 'b']);
		const work = await seed(['w'], list.id);
		expect(await taskStore.reorder(userId, inbox.a, work.w, null)).toBeNull();
	});

	it('moving a task to another list puts it on top there', async () => {
		const list = await listStore.create(userId, 'Work');
		const inbox = await seed(['a']);
		await seed(['w1', 'w2'], list.id);
		await taskStore.move(userId, inbox.a, list.id);
		expect(await titles(list.id)).toEqual(['a', 'w1', 'w2']);
		expect(await titles()).toEqual([]);
	});

	it('lists reorder the same way', async () => {
		const l1 = await listStore.create(userId, 'one');
		const l2 = await listStore.create(userId, 'two');
		const l3 = await listStore.create(userId, 'three');
		await listStore.reorder(userId, l3.id, l1.id, l2.id);
		expect((await listStore.all(userId)).map((l) => l.name)).toEqual(['one', 'three', 'two']);
	});
});

const eqId = (id: string) => eq(tasks.id, id);
