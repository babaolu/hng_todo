import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { todayIn } from '$lib/dates';
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

const TODAY = '2026-10-01';

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

async function add(title: string, dueDate: string | null, listId: string | null = null) {
	return (await taskStore.create(userId, { title, listId, dueDate }))!;
}
const titles = (rows: { title: string }[]) => rows.map((t) => t.title);

describe('Today', () => {
	it('includes overdue, due today and pinned tasks, across lists', async () => {
		const work = await listStore.create(userId, 'Work');
		await add('overdue', '2026-09-28');
		await add('today in work', TODAY, work.id);
		await add('tomorrow', '2026-10-02');
		await add('undated', null);
		const pinned = await add('pinned undated', null);
		await taskStore.setPinned(userId, pinned.id, true);
		const pinnedLater = await add('pinned for later', '2026-10-20');
		await taskStore.setPinned(userId, pinnedLater.id, true);

		expect(titles(await taskStore.listToday(userId, TODAY))).toEqual([
			'overdue',
			'today in work',
			'pinned for later',
			'pinned undated'
		]);
		expect(await taskStore.todayCount(userId, TODAY)).toBe(4);
	});

	it('leaves out completed and deleted tasks', async () => {
		const done = await add('done', TODAY);
		await taskStore.setCompleted(userId, done.id, true);
		const gone = await add('gone', TODAY);
		await taskStore.remove(userId, gone.id);
		await add('still here', TODAY);
		expect(titles(await taskStore.listToday(userId, TODAY))).toEqual(['still here']);
	});

	it('sorts by due date, then list (Inbox first, then list order), then manual order', async () => {
		const b = await listStore.create(userId, 'B');
		const a = await listStore.create(userId, 'A');
		await listStore.reorder(userId, a.id, null, b.id); // A before B
		await add('b1', TODAY, b.id);
		await add('a1', TODAY, a.id);
		await add('inbox', TODAY);
		await add('a2', TODAY, a.id); // new tasks go on top, so a2 before a1
		await add('older', '2026-09-30', b.id);
		expect(titles(await taskStore.listToday(userId, TODAY))).toEqual([
			'older',
			'inbox',
			'a2',
			'a1',
			'b1'
		]);
	});
});

describe('Upcoming', () => {
	it('includes only tasks due after today, by date', async () => {
		await add('today', TODAY);
		await add('overdue', '2026-09-01');
		await add('in a month', '2026-11-01');
		await add('tomorrow', '2026-10-02');
		await add('undated', null);
		expect(titles(await taskStore.listUpcoming(userId, TODAY))).toEqual(['tomorrow', 'in a month']);
	});
});

describe('due dates and pins', () => {
	it('stores and clears calendar days without shifting them', async () => {
		const t = await add('x', null);
		expect((await taskStore.setDueDate(userId, t.id, '2026-12-31'))!.dueDate).toBe('2026-12-31');
		expect((await taskStore.get(userId, t.id))!.dueDate).toBe('2026-12-31');
		expect((await taskStore.setDueDate(userId, t.id, null))!.dueDate).toBeNull();
	});

	it('rejects malformed dates', async () => {
		const t = await add('x', null);
		expect(await taskStore.setDueDate(userId, t.id, '2026-02-30')).toBeNull();
		expect(await taskStore.update(userId, t.id, { dueDate: 'friday' })).toBeNull();
		expect(
			await taskStore.create(userId, { title: 'y', listId: null, dueDate: '31/12/2026' })
		).toBeNull();
	});
});

describe("Today follows the user's time zone, not the server's", () => {
	it('Africa/Lagos: a task due on the Lagos date shows at 00:30 Lagos time (still yesterday in UTC)', async () => {
		await add('due 2 Oct', '2026-10-02');
		const now = new Date('2026-10-01T23:30:00Z');

		expect(titles(await taskStore.listToday(userId, todayIn('Africa/Lagos', now)))).toEqual([
			'due 2 Oct'
		]);
		// The server's own (UTC) date would miss it.
		expect(await taskStore.listToday(userId, todayIn('UTC', now))).toEqual([]);
	});

	it('America/New_York across the end of DST: due today until local midnight, then overdue', async () => {
		await add('due 1 Nov', '2026-11-01');
		const at = (iso: string) => todayIn('America/New_York', new Date(iso));

		// 23:30 EST on 1 Nov (already 2 Nov in UTC): still due today, not overdue
		const lateEvening = at('2026-11-02T04:30:00Z');
		expect(lateEvening).toBe('2026-11-01');
		expect(titles(await taskStore.listToday(userId, lateEvening))).toEqual(['due 1 Nov']);
		expect(await taskStore.listUpcoming(userId, lateEvening)).toEqual([]);

		// the evening before (23:30 EDT on 31 Oct): upcoming, not today
		const dayBefore = at('2026-11-01T03:30:00Z');
		expect(dayBefore).toBe('2026-10-31');
		expect(await taskStore.listToday(userId, dayBefore)).toEqual([]);
		expect(titles(await taskStore.listUpcoming(userId, dayBefore))).toEqual(['due 1 Nov']);

		// 00:30 EST on 2 Nov: overdue, still in Today
		const nextDay = at('2026-11-02T05:30:00Z');
		expect(nextDay).toBe('2026-11-02');
		const rows = await taskStore.listToday(userId, nextDay);
		expect(rows[0].dueDate! < nextDay).toBe(true);
	});
});
