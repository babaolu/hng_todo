import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('lists', () => {
	it('deleting a list soft-deletes it and moves its tasks to the Inbox', async () => {
		const list = await listStore.create(userId, 'Groceries');
		const open = await taskStore.create(userId, { title: 'milk', listId: list.id });
		const done = await taskStore.create(userId, { title: 'eggs', listId: list.id });
		await taskStore.setCompleted(userId, done!.id, true);

		expect(await listStore.remove(userId, list.id)).toBe(true);
		expect(await listStore.get(userId, list.id)).toBeNull();
		expect((await listStore.all(userId)).map((l) => l.id)).not.toContain(list.id);
		expect((await taskStore.get(userId, open!.id))!.listId).toBeNull();
		expect((await taskStore.get(userId, done!.id))!.listId).toBeNull();
		expect((await taskStore.listActive(userId, null)).map((t) => t.title)).toContain('milk');
		// deleting twice is a no-op
		expect(await listStore.remove(userId, list.id)).toBe(false);
	});

	it('cannot add tasks to a deleted list', async () => {
		const list = await listStore.create(userId, 'Gone');
		await listStore.remove(userId, list.id);
		expect(await taskStore.create(userId, { title: 'x', listId: list.id })).toBeNull();
	});

	it('archive keeps the list readable and reversible', async () => {
		const list = await listStore.create(userId, 'Someday');
		expect((await listStore.setArchived(userId, list.id, true))!.archived).toBe(true);
		expect((await listStore.get(userId, list.id))!.archived).toBe(true);
		expect((await listStore.setArchived(userId, list.id, false))!.archived).toBe(false);
	});

	it('rename', async () => {
		const list = await listStore.create(userId, 'Wrok');
		expect((await listStore.rename(userId, list.id, 'Work'))!.name).toBe('Work');
	});
});

describe('task soft delete', () => {
	it('hides the task everywhere and undo brings it back', async () => {
		const task = await taskStore.create(userId, { title: 'oops', listId: null });
		await taskStore.remove(userId, task!.id);
		expect(await taskStore.get(userId, task!.id)).toBeNull();
		expect((await taskStore.listActive(userId, null)).map((t) => t.id)).not.toContain(task!.id);
		expect(await taskStore.update(userId, task!.id, { title: 'x' })).toBeNull();

		expect((await taskStore.restore(userId, task!.id))!.deletedAt).toBeNull();
		expect(await taskStore.get(userId, task!.id)).not.toBeNull();
	});

	it('undo sends the task to the Inbox if its list was deleted meanwhile', async () => {
		const list = await listStore.create(userId, 'Temp');
		const task = await taskStore.create(userId, { title: 't', listId: list.id });
		await taskStore.remove(userId, task!.id);
		await listStore.remove(userId, list.id);
		expect((await taskStore.restore(userId, task!.id))!.listId).toBeNull();
	});

	it('completed tasks leave the active view and appear in the Logbook', async () => {
		const task = await taskStore.create(userId, { title: 'done', listId: null });
		await taskStore.setCompleted(userId, task!.id, true);
		expect((await taskStore.listActive(userId, null)).map((t) => t.id)).not.toContain(task!.id);
		expect((await taskStore.listCompleted(userId))[0].id).toBe(task!.id);
		await taskStore.setCompleted(userId, task!.id, false);
		expect((await taskStore.listActive(userId, null)).map((t) => t.id)).toContain(task!.id);
	});
});
