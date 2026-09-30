/**
 * The most important test in the project: every data-access function, run as
 * one user, must never read or modify another user's rows. It runs for every
 * pairing of real users and guests: real -> real, guest -> real, real -> guest
 * and guest -> guest.
 */
import { asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RepeatRule } from '$lib/repeat';
import { createAuthStore } from './auth';
import { lists, tasks, users } from './db/schema';
import type { Db } from './db/types';
import { createExportStore } from './export';
import { createGuestStore } from './guests';
import { createListStore } from './lists';
import { createTaskStore } from './tasks';
import { createTestDb, createUser } from './test/db';

let db: Db;
let close: () => Promise<void>;
let taskStore: ReturnType<typeof createTaskStore>;
let listStore: ReturnType<typeof createListStore>;

const TODAY = '2026-10-01';
const TOMORROW = '2026-10-02';
const EVERY_DAY: RepeatRule = { freq: 'daily', interval: 1, anchor: TODAY };

type Attacker = { id: string; list: string; task: string; inboxTask: string };
type Victim = {
	id: string;
	list: string;
	otherList: string;
	task: string;
	secondTask: string;
	inboxTask: string;
	doneTask: string;
	deletedTask: string;
	recurring: string;
};
const attackers = {} as Record<'real' | 'guest', Attacker>;
const victims = {} as Record<'real' | 'guest', Victim>;

async function snapshotOf(userId: string) {
	return {
		lists: await db.select().from(lists).where(eq(lists.userId, userId)).orderBy(asc(lists.id)),
		tasks: await db.select().from(tasks).where(eq(tasks.userId, userId)).orderBy(asc(tasks.id)),
		user: await db.select().from(users).where(eq(users.id, userId))
	};
}
const before = {} as Record<'real' | 'guest', Awaited<ReturnType<typeof snapshotOf>>>;

async function makeUser(email: string, guest: boolean) {
	const id = await createUser(db, email);
	if (guest)
		await db.update(users).set({ isGuest: true, guestIp: '203.0.113.1' }).where(eq(users.id, id));
	return id;
}

async function seedAttacker(id: string): Promise<Attacker> {
	const list = (await listStore.create(id, 'A list')).id;
	const task = (await taskStore.create(id, { title: 'A task', listId: list }))!.id;
	const inboxTask = (await taskStore.create(id, { title: 'A inbox', listId: null }))!.id;
	await taskStore.setDueDate(id, task, TODAY);
	return { id, list, task, inboxTask };
}

async function seedVictim(id: string): Promise<Victim> {
	const list = (await listStore.create(id, 'B list')).id;
	const otherList = (await listStore.create(id, 'B other')).id;
	const task = (await taskStore.create(id, { title: 'B task', listId: list }))!.id;
	const secondTask = (await taskStore.create(id, { title: 'B second', listId: list }))!.id;
	const inboxTask = (await taskStore.create(id, { title: 'B inbox', listId: null }))!.id;
	const doneTask = (await taskStore.create(id, { title: 'B done', listId: null }))!.id;
	await taskStore.setCompleted(id, doneTask, true);
	const deletedTask = (await taskStore.create(id, { title: 'B deleted', listId: list }))!.id;
	await taskStore.remove(id, deletedTask);
	// Something in Today (due today, and pinned) and in Upcoming.
	await taskStore.setDueDate(id, task, TODAY);
	await taskStore.setPinned(id, secondTask, true);
	await taskStore.setDueDate(id, inboxTask, TOMORROW);
	const recurring = (await taskStore.create(id, {
		title: 'B recurring',
		listId: list,
		dueDate: TODAY,
		repeatRule: EVERY_DAY
	}))!.id;
	return { id, list, otherList, task, secondTask, inboxTask, doneTask, deletedTask, recurring };
}

beforeAll(async () => {
	({ db, close } = await createTestDb());
	taskStore = createTaskStore(db);
	listStore = createListStore(db);
	attackers.real = await seedAttacker(await makeUser('a@example.com', false));
	attackers.guest = await seedAttacker(await makeUser('guest-a@guest.invalid', true));
	victims.real = await seedVictim(await makeUser('b@example.com', false));
	victims.guest = await seedVictim(await makeUser('guest-b@guest.invalid', true));
	before.real = await snapshotOf(victims.real.id);
	before.guest = await snapshotOf(victims.guest.id);
});

afterEach(async () => {
	// Whatever the attacker just tried, every victim's data is byte-for-byte unchanged.
	expect(await snapshotOf(victims.real.id)).toEqual(before.real);
	expect(await snapshotOf(victims.guest.id)).toEqual(before.guest);
});

afterAll(() => close());

describe.each([
	['a real user', 'real', 'another real user', 'real'],
	['a guest', 'guest', 'a real user', 'real'],
	['a real user', 'real', 'a guest', 'guest'],
	['a guest', 'guest', 'another guest', 'guest']
] as const)('%s against %s', (_a, attackerKey, _b, victimKey) => {
	let a: string;
	let A: Attacker;
	let B: Victim;
	beforeAll(() => {
		A = attackers[attackerKey];
		a = A.id;
		B = victims[victimKey];
	});
	const bTaskIds = () => [
		B.task,
		B.secondTask,
		B.inboxTask,
		B.doneTask,
		B.deletedTask,
		B.recurring
	];
	const bListIds = () => [B.list, B.otherList];

	describe('tasks', () => {
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

		it("search never returns B tasks, even for words only B's tasks contain", async () => {
			expect((await taskStore.search(a, 'task')).map((t) => t.id)).toEqual([A.task]);
			expect(await taskStore.search(a, 'B task')).toEqual([]);
			expect(await taskStore.search(a, 'recurring')).toEqual([]);
			expect(await taskStore.search(a, 'deleted')).toEqual([]);
		});

		it('countAll only counts A tasks (guest cap)', async () => {
			const own = await db.select().from(tasks).where(eq(tasks.userId, a));
			expect(await taskStore.countAll(a)).toBe(own.length);
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

		it('listToday never returns B tasks, due, pinned or recurring', async () => {
			expect((await taskStore.listToday(a, TODAY)).map((t) => t.id)).toEqual([A.task]);
		});

		it('listUpcoming never returns B tasks', async () => {
			expect(await taskStore.listUpcoming(a, TODAY)).toEqual([]);
		});

		it('todayCount only counts A tasks', async () => {
			expect(await taskStore.todayCount(a, TODAY)).toBe(1);
		});

		it('setDueDate cannot set or clear due dates on B tasks', async () => {
			for (const id of bTaskIds()) {
				expect(await taskStore.setDueDate(a, id, '2030-01-01')).toBeNull();
				expect(await taskStore.setDueDate(a, id, null)).toBeNull();
			}
		});

		it('setPinned cannot pin or unpin B tasks', async () => {
			for (const id of bTaskIds()) {
				expect(await taskStore.setPinned(a, id, true)).toBeNull();
				expect(await taskStore.setPinned(a, id, false)).toBeNull();
			}
		});

		it('update cannot change due date or pin on B tasks', async () => {
			for (const id of bTaskIds()) {
				expect(await taskStore.update(a, id, { dueDate: null, pinnedToday: false })).toBeNull();
			}
		});

		it('create with a due date still refuses B lists', async () => {
			expect(
				await taskStore.create(a, { title: 'sneaky', listId: B.list, dueDate: TODAY })
			).toBeNull();
		});

		it('complete cannot complete B tasks or generate occurrences for anyone', async () => {
			const own = async () => (await db.select().from(tasks).where(eq(tasks.userId, a))).length;
			const before = await own();
			for (const id of bTaskIds()) expect(await taskStore.complete(a, id, TODAY)).toBeNull();
			expect(await own()).toBe(before);
		});

		it('uncomplete cannot reopen B tasks or touch their occurrences', async () => {
			for (const id of bTaskIds()) expect(await taskStore.uncomplete(a, id)).toBeNull();
		});

		it('setRepeat cannot set or end repeats on B tasks', async () => {
			for (const id of bTaskIds()) {
				expect(await taskStore.setRepeat(a, id, EVERY_DAY, TODAY)).toBeNull();
				expect(await taskStore.setRepeat(a, id, null, TODAY)).toBeNull();
			}
		});

		it('create with a repeat still refuses B lists', async () => {
			expect(
				await taskStore.create(a, {
					title: 'sneaky',
					listId: B.list,
					dueDate: TODAY,
					repeatRule: EVERY_DAY
				})
			).toBeNull();
		});

		it("setTimeZone for A leaves B's zone alone", async () => {
			await createAuthStore(db).setTimeZone(a, 'Africa/Lagos');
			expect((await db.select().from(users).where(eq(users.id, a)))[0].timeZone).toBe(
				'Africa/Lagos'
			);
		});
	});

	describe('lists', () => {
		it('all never returns B lists', async () => {
			expect((await listStore.all(a)).map((l) => l.id)).toEqual([A.list]);
		});

		it('countAll only counts A lists (guest cap)', async () => {
			expect(await listStore.countAll(a)).toBe(1);
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

	describe('export', () => {
		/** Every key anywhere in a JSON value. */
		const keysOf = (value: unknown): string[] =>
			Array.isArray(value)
				? value.flatMap(keysOf)
				: value && typeof value === 'object'
					? Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)])
					: [];

		it("contains only A's own lists and tasks", async () => {
			const out = await createExportStore(db).build(a, 'UTC');
			const ownTasks = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.userId, a));
			const ownLists = await db.select({ id: lists.id }).from(lists).where(eq(lists.userId, a));
			expect(out.tasks.map((t) => t.id).sort()).toEqual(ownTasks.map((t) => t.id).sort());
			expect(out.lists.map((l) => l.id).sort()).toEqual(ownLists.map((l) => l.id).sort());
			const json = JSON.stringify(out);
			for (const id of [B.id, B.list, B.otherList, ...bTaskIds()]) expect(json).not.toContain(id);
		});

		it('never contains account details: ids, emails, hashes, sessions, IPs, login attempts', async () => {
			const out = await createExportStore(db).build(a, 'UTC');
			const forbidden = [
				'user_id',
				'userId',
				'email',
				'password_hash',
				'passwordHash',
				'token_hash',
				'tokenHash',
				'session',
				'sessions',
				'guest_ip',
				'guestIp',
				'is_guest',
				'isGuest',
				'ip',
				'login_attempts',
				'attempted_at'
			];
			expect(keysOf(out).filter((k) => forbidden.includes(k))).toEqual([]);
			const [me] = await db.select().from(users).where(eq(users.id, a));
			const json = JSON.stringify(out);
			expect(json).not.toContain(a);
			expect(json).not.toContain(me.email);
			expect(json).not.toContain(me.passwordHash);
		});
	});

	it('sanity: B can do what A could not', async () => {
		expect(await taskStore.get(B.id, B.task)).not.toBeNull();
		expect(await listStore.get(B.id, B.list)).not.toBeNull();
	});
});

describe('guest store', () => {
	it('remove() refuses a real user, whoever calls it', async () => {
		expect(await createGuestStore(db).remove(victims.real.id)).toBe(false);
	});
});
