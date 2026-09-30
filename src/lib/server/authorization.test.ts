/**
 * The most important test in the project: every data-access function, run as
 * user A, must never read or modify user B's rows.
 */
import { asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { lists, tasks } from './db/schema';
import type { Db } from './db/types';
import { createListStore } from './lists';
import { createTaskStore } from './tasks';
import { createTestDb, createUser } from './test/db';

let db: Db;
let close: () => Promise<void>;
let taskStore: ReturnType<typeof createTaskStore>;
let listStore: ReturnType<typeof createListStore>;

let a: string;
let b: string;
const A = {} as { list: string; task: string; inboxTask: string };
const B = {} as {
	list: string;
	otherList: string;
	task: string;
	secondTask: string;
	inboxTask: string;
	doneTask: string;
	deletedTask: string;
};

async function snapshotOf(userId: string) {
	return {
		lists: await db.select().from(lists).where(eq(lists.userId, userId)).orderBy(asc(lists.id)),
		tasks: await db.select().from(tasks).where(eq(tasks.userId, userId)).orderBy(asc(tasks.id))
	};
}
let bBefore: Awaited<ReturnType<typeof snapshotOf>>;

beforeAll(async () => {
	({ db, close } = await createTestDb());
	taskStore = createTaskStore(db);
	listStore = createListStore(db);
	a = await createUser(db, 'a@example.com');
	b = await createUser(db, 'b@example.com');

	A.list = (await listStore.create(a, 'A list')).id;
	A.task = (await taskStore.create(a, { title: 'A task', listId: A.list }))!.id;
	A.inboxTask = (await taskStore.create(a, { title: 'A inbox', listId: null }))!.id;

	B.list = (await listStore.create(b, 'B list')).id;
	B.otherList = (await listStore.create(b, 'B other')).id;
	B.task = (await taskStore.create(b, { title: 'B task', listId: B.list }))!.id;
	B.secondTask = (await taskStore.create(b, { title: 'B second', listId: B.list }))!.id;
	B.inboxTask = (await taskStore.create(b, { title: 'B inbox', listId: null }))!.id;
	B.doneTask = (await taskStore.create(b, { title: 'B done', listId: null }))!.id;
	await taskStore.setCompleted(b, B.doneTask, true);
	B.deletedTask = (await taskStore.create(b, { title: 'B deleted', listId: B.list }))!.id;
	await taskStore.remove(b, B.deletedTask);

	bBefore = await snapshotOf(b);
});

afterEach(async () => {
	// Whatever A just tried, B's data is byte-for-byte unchanged.
	expect(await snapshotOf(b)).toEqual(bBefore);
});

afterAll(() => close());

const bTaskIds = () => [B.task, B.secondTask, B.inboxTask, B.doneTask, B.deletedTask];
const bListIds = () => [B.list, B.otherList];

describe('tasks, run as user A against user B', () => {
	it('listActive never returns B tasks, even for B list ids', async () => {
		expect(await taskStore.listActive(a, B.list)).toEqual([]);
		const inbox = await taskStore.listActive(a, null);
		expect(inbox.map((t) => t.id)).toEqual([A.inboxTask]);
	});

	it('listCompleted (Logbook) never returns B tasks', async () => {
		await taskStore.setCompleted(a, A.task, true);
		const done = await taskStore.listCompleted(a);
		expect(done.map((t) => t.id)).toEqual([A.task]);
		await taskStore.setCompleted(a, A.task, false);
	});

	it('activeCounts only counts A tasks', async () => {
		expect(await taskStore.activeCounts(a)).toEqual({ inbox: 1, [A.list]: 1 });
	});

	it('get returns null for every B task', async () => {
		for (const id of bTaskIds()) expect(await taskStore.get(a, id)).toBeNull();
	});

	it('create refuses to add a task to a B list', async () => {
		expect(await taskStore.create(a, { title: 'sneaky', listId: B.list })).toBeNull();
		expect(await db.select().from(tasks).where(eq(tasks.title, 'sneaky'))).toEqual([]);
	});

	it('update cannot change B tasks', async () => {
		for (const id of bTaskIds()) {
			expect(await taskStore.update(a, id, { title: 'pwned', notes: 'pwned' })).toBeNull();
		}
	});

	it('setCompleted cannot complete or uncomplete B tasks', async () => {
		for (const id of bTaskIds()) {
			expect(await taskStore.setCompleted(a, id, true)).toBeNull();
			expect(await taskStore.setCompleted(a, id, false)).toBeNull();
		}
	});

	it('move cannot move B tasks, nor move A tasks into B lists', async () => {
		for (const id of bTaskIds()) {
			expect(await taskStore.move(a, id, null)).toBeNull();
			expect(await taskStore.move(a, id, A.list)).toBeNull();
		}
		expect(await taskStore.move(a, A.task, B.list)).toBeNull();
		expect((await taskStore.get(a, A.task))!.listId).toBe(A.list);
	});

	it('reorder cannot move B tasks, nor use B tasks as neighbours', async () => {
		for (const id of bTaskIds()) {
			expect(await taskStore.reorder(a, id, null, null)).toBeNull();
			expect(await taskStore.reorder(a, A.inboxTask, id, null)).toBeNull();
			expect(await taskStore.reorder(a, A.inboxTask, null, id)).toBeNull();
		}
	});

	it('remove cannot delete B tasks', async () => {
		for (const id of bTaskIds()) expect(await taskStore.remove(a, id)).toBeNull();
	});

	it('restore cannot undelete B tasks', async () => {
		expect(await taskStore.restore(a, B.deletedTask)).toBeNull();
	});
});

describe('lists, run as user A against user B', () => {
	it('all never returns B lists', async () => {
		expect((await listStore.all(a)).map((l) => l.id)).toEqual([A.list]);
	});

	it('get returns null for B lists', async () => {
		for (const id of bListIds()) expect(await listStore.get(a, id)).toBeNull();
	});

	it('rename cannot rename B lists', async () => {
		for (const id of bListIds()) expect(await listStore.rename(a, id, 'pwned')).toBeNull();
	});

	it('setArchived cannot archive B lists', async () => {
		for (const id of bListIds()) {
			expect(await listStore.setArchived(a, id, true)).toBeNull();
			expect(await listStore.setArchived(a, id, false)).toBeNull();
		}
	});

	it('reorder cannot move B lists, nor use B lists as neighbours', async () => {
		for (const id of bListIds()) {
			expect(await listStore.reorder(a, id, null, null)).toBeNull();
			expect(await listStore.reorder(a, A.list, id, null)).toBeNull();
			expect(await listStore.reorder(a, A.list, null, id)).toBeNull();
		}
	});

	it('remove cannot delete B lists or move their tasks to the Inbox', async () => {
		for (const id of bListIds()) expect(await listStore.remove(a, id)).toBe(false);
	});
});

describe('sanity: the same calls work for the owner', () => {
	it('B can do what A could not', async () => {
		expect(await taskStore.get(b, B.task)).not.toBeNull();
		expect(await listStore.get(b, B.list)).not.toBeNull();
	});
});
