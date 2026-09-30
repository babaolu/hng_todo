import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RepeatRule } from '$lib/repeat';
import { tasks } from './db/schema';
import type { Db } from './db/types';
import { createListStore } from './lists';
import { createTaskStore } from './tasks';
import { createTestDb, createUser } from './test/db';

let db: Db;
let close: () => Promise<void>;
let userId: string;
let store: ReturnType<typeof createTaskStore>;

// Thu 1 Oct 2026. 5 Oct is a Monday.
const TODAY = '2026-10-01';
const everyMon: RepeatRule = { freq: 'weekly', interval: 1, weekdays: [1], anchor: '2026-09-28' };
const everyMonThu: RepeatRule = {
	freq: 'weekly',
	interval: 1,
	weekdays: [1, 4],
	anchor: '2026-09-28'
};

beforeAll(async () => {
	({ db, close } = await createTestDb());
	userId = await createUser(db, 'me@example.com');
	store = createTaskStore(db);
});
afterAll(() => close());
beforeEach(async () => {
	await db.delete(tasks);
});

async function recurring(
	dueDate: string,
	rule: RepeatRule = everyMon,
	listId: string | null = null
) {
	return (await store.create(userId, {
		title: 'water plants',
		listId,
		dueDate,
		repeatRule: rule
	}))!;
}
const live = async () =>
	db
		.select()
		.from(tasks)
		.where(and(eq(tasks.userId, userId), isNull(tasks.deletedAt), isNull(tasks.completedAt)));

describe('creating and setting repeats', () => {
	it('a recurring task gets a series id and must have a due date', async () => {
		const t = await recurring('2026-10-05');
		expect(t.seriesId).toMatch(/^[0-9a-f-]{36}$/);
		expect(t.repeatRule).toEqual(everyMon);
		expect(
			await store.create(userId, { title: 'x', listId: null, repeatRule: everyMon })
		).toBeNull();
	});

	it('refuses an invalid rule', async () => {
		const bad = {
			freq: 'weekly',
			interval: 1,
			weekdays: [9],
			anchor: TODAY
		} as unknown as RepeatRule;
		expect(
			await store.create(userId, { title: 'x', listId: null, dueDate: TODAY, repeatRule: bad })
		).toBeNull();
	});

	it('setting a repeat on an undated task sets its due date to the first occurrence on or after today', async () => {
		const t = (await store.create(userId, { title: 'x', listId: null }))!;
		const updated = await store.setRepeat(userId, t.id, everyMonThu, TODAY);
		expect(updated).toMatchObject({ dueDate: '2026-10-01', repeatRule: everyMonThu }); // today is a Thursday
		const t2 = (await store.create(userId, { title: 'y', listId: null }))!;
		expect((await store.setRepeat(userId, t2.id, everyMon, TODAY))!.dueDate).toBe('2026-10-05');
	});

	it('removing the repeat keeps the task and its date', async () => {
		const t = await recurring('2026-10-05');
		const updated = await store.setRepeat(userId, t.id, null, TODAY);
		expect(updated).toMatchObject({ repeatRule: null, dueDate: '2026-10-05', completedAt: null });
	});

	it('an invalid rule already in the database reads as "not recurring"', async () => {
		const t = await recurring('2026-10-05');
		await db.execute(
			// bypasses the column type on purpose
			(await import('drizzle-orm'))
				.sql`update tasks set repeat_rule = '{"freq":"hourly"}'::jsonb where id = ${t.id}`
		);
		expect((await store.get(userId, t.id))!.repeatRule).toBeNull();
	});
});

describe('completing a recurring task', () => {
	it('completes it and creates the next occurrence, copying the right fields', async () => {
		const list = await createListStore(db).create(userId, 'Home');
		const t = await recurring('2026-10-05', everyMon, list.id);
		await store.update(userId, t.id, { notes: 'the ferns too', pinnedToday: true });
		const other = (await store.create(userId, { title: 'already in Home', listId: list.id }))!;

		const r = await store.complete(userId, t.id, TODAY);
		expect(r!.task.completedAt).not.toBeNull();
		expect(r!.next).toMatchObject({
			userId,
			title: 'water plants',
			notes: 'the ferns too',
			listId: list.id,
			dueDate: '2026-10-12',
			repeatRule: everyMon,
			seriesId: t.seriesId,
			previousId: t.id,
			pinnedToday: false,
			completedAt: null
		});
		// on top of its list
		const home = await store.listActive(userId, list.id);
		expect(home.map((x) => x.id)).toEqual([r!.next!.id, other.id]);
	});

	it('a non-recurring task just completes', async () => {
		const t = (await store.create(userId, { title: 'once', listId: null, dueDate: TODAY }))!;
		const r = await store.complete(userId, t.id, TODAY);
		expect(r).toMatchObject({ next: null, nextBlocked: false });
		expect(r!.task.completedAt).not.toBeNull();
	});

	it('skips missed occurrences: two weeks late creates one task for the next future date', async () => {
		const t = await recurring('2026-09-14'); // a Monday, 2+ weeks ago
		const r = await store.complete(userId, t.id, TODAY);
		expect(r!.next!.dueDate).toBe('2026-10-05');
		expect((await live()).length).toBe(1);
	});

	it('finishing early moves to the occurrence after the due date', async () => {
		const t = await recurring('2026-10-05'); // due Monday, done Thursday
		expect((await store.complete(userId, t.id, TODAY))!.next!.dueDate).toBe('2026-10-12');
	});

	it('a completion on the occurrence day itself', async () => {
		const t = await recurring(TODAY, everyMonThu); // Thursday
		expect((await store.complete(userId, t.id, TODAY))!.next!.dueDate).toBe('2026-10-05');
	});

	it('a second completion (double click) creates nothing', async () => {
		const t = await recurring('2026-10-05');
		expect((await store.complete(userId, t.id, TODAY))!.next).not.toBeNull();
		expect(await store.complete(userId, t.id, TODAY)).toBeNull();
		expect((await live()).length).toBe(1);
		expect((await db.select().from(tasks).where(eq(tasks.seriesId, t.seriesId!))).length).toBe(2);
	});

	it('two completions at the same moment create exactly one next occurrence', async () => {
		const t = await recurring('2026-10-05');
		const results = await Promise.all(
			Array.from({ length: 5 }, () => store.complete(userId, t.id, TODAY))
		);
		expect(results.filter((r) => r?.next).length).toBe(1);
		expect((await live()).length).toBe(1);
		expect((await db.select().from(tasks).where(eq(tasks.seriesId, t.seriesId!))).length).toBe(2);
	});

	it('allowNext: false (guest cap) completes without creating the next one', async () => {
		const t = await recurring('2026-10-05');
		const r = await store.complete(userId, t.id, TODAY, { allowNext: false });
		expect(r).toMatchObject({ next: null, nextBlocked: true });
		expect(r!.task.completedAt).not.toBeNull();
		expect(await live()).toEqual([]);
	});

	it('history is kept: every completed occurrence stays in the Logbook', async () => {
		let t = await recurring('2026-10-05');
		for (let i = 0; i < 3; i++) t = (await store.complete(userId, t.id, TODAY))!.next!;
		expect((await store.listCompleted(userId)).length).toBe(3);
		expect((await live()).map((x) => x.dueDate)).toEqual(['2026-10-26']);
	});
});

describe('undoing a completion', () => {
	it('untouched next occurrence: it is removed and the original is live and recurring again', async () => {
		const t = await recurring('2026-10-05');
		const { next } = (await store.complete(userId, t.id, TODAY))!;
		const restored = await store.uncomplete(userId, t.id);
		expect(restored).toMatchObject({ id: t.id, completedAt: null, repeatRule: everyMon });
		expect(
			(await db.select().from(tasks).where(eq(tasks.id, next!.id)))[0].deletedAt
		).not.toBeNull();
		expect((await live()).map((x) => x.id)).toEqual([t.id]);
	});

	it.each([
		['edited', (id: string) => store.update(userId, id, { title: 'water ALL the plants' })],
		['pinned', (id: string) => store.setPinned(userId, id, true)],
		['moved', (id: string) => store.setDueDate(userId, id, '2026-10-20')],
		['completed', (id: string) => store.complete(userId, id, TODAY)],
		['deleted', (id: string) => store.remove(userId, id)]
	])(
		'touched (%s) next occurrence: it stays and the original loses its repeat',
		async (_, touch) => {
			const t = await recurring('2026-10-05');
			const { next } = (await store.complete(userId, t.id, TODAY))!;
			await new Promise((r) => setTimeout(r, 5)); // so updated_at differs from created_at
			await touch(next!.id);
			const restored = await store.uncomplete(userId, t.id);
			expect(restored).toMatchObject({ completedAt: null, repeatRule: null });
			const after = (await db.select().from(tasks).where(eq(tasks.id, next!.id)))[0];
			expect(after.repeatRule).toEqual(everyMon);
			// never more than one live recurring occurrence in the series
			const liveRecurring = (await live()).filter((x) => x.seriesId === t.seriesId && x.repeatRule);
			expect(liveRecurring.length).toBeLessThanOrEqual(1);
		}
	);

	it('uncompleting a non-recurring task just reopens it', async () => {
		const t = (await store.create(userId, { title: 'once', listId: null }))!;
		await store.complete(userId, t.id, TODAY);
		expect(await store.uncomplete(userId, t.id)).toMatchObject({
			completedAt: null,
			repeatRule: null
		});
	});

	it('uncompleting something not completed does nothing', async () => {
		const t = await recurring('2026-10-05');
		expect(await store.uncomplete(userId, t.id)).toBeNull();
	});
});

describe('ending a series', () => {
	it('deleting the current occurrence ends it, and Undo restores it, still recurring', async () => {
		const t = await recurring('2026-10-05');
		await store.remove(userId, t.id);
		expect(await live()).toEqual([]);
		const restored = await store.restore(userId, t.id);
		expect(restored).toMatchObject({ repeatRule: everyMon, deletedAt: null });
		expect((await store.complete(userId, t.id, TODAY))!.next!.dueDate).toBe('2026-10-12');
	});

	it('removing the repeat, then completing, creates nothing', async () => {
		const t = await recurring('2026-10-05');
		await store.setRepeat(userId, t.id, null, TODAY);
		expect(await store.complete(userId, t.id, TODAY)).toMatchObject({ next: null });
	});
});

describe('a recurring task always has a due date', () => {
	// TODAY is Thu 1 Oct 2026; everyMon's first occurrence from today is Mon 5 Oct.
	it('setDueDate(null) gives the first occurrence on or after today instead', async () => {
		const t = await recurring('2026-10-12');
		expect((await store.setDueDate(userId, t.id, null, TODAY))!.dueDate).toBe('2026-10-05');
	});

	it('update({ dueDate: null }) does the same', async () => {
		const t = await recurring('2026-10-12');
		expect((await store.update(userId, t.id, { dueDate: null }, TODAY))!.dueDate).toBe(
			'2026-10-05'
		);
	});

	it('refuses to clear it without knowing today', async () => {
		const t = await recurring('2026-10-12');
		await expect(store.setDueDate(userId, t.id, null)).rejects.toThrow(/today is required/);
		expect((await store.get(userId, t.id))!.dueDate).toBe('2026-10-12');
	});

	it('a non-recurring task can still lose its date', async () => {
		const t = (await store.create(userId, { title: 'x', listId: null, dueDate: TODAY }))!;
		expect((await store.setDueDate(userId, t.id, null))!.dueDate).toBeNull();
	});

	it('create: a repeat without a date gets its first occurrence from today', async () => {
		const t = await store.create(userId, {
			title: 'x',
			listId: null,
			repeatRule: everyMon,
			today: TODAY
		});
		expect(t!.dueDate).toBe('2026-10-05');
		// ...and without today it can't be created at all
		expect(
			await store.create(userId, { title: 'y', listId: null, repeatRule: everyMon })
		).toBeNull();
	});

	it('the database rejects a recurring task without a due date (insert and update)', async () => {
		const { sql } = await import('drizzle-orm');
		/** The database's own error message (drizzle wraps it as "Failed query: …"). */
		const dbError = async (query: Promise<unknown>) => {
			try {
				await query;
				return 'no error';
			} catch (e) {
				const err = e as { cause?: { message?: string }; message: string };
				return err.cause?.message ?? err.message;
			}
		};
		expect(
			await dbError(
				db.execute(sql`
					insert into tasks (user_id, title, "order", repeat_rule)
					values (${userId}, 'bad', 'a0', ${JSON.stringify(everyMon)}::jsonb)
				`)
			)
		).toMatch(/tasks_repeat_has_due/);
		const t = await recurring('2026-10-12');
		expect(
			await dbError(db.execute(sql`update tasks set due_date = null where id = ${t.id}`))
		).toMatch(/tasks_repeat_has_due/);
		// clearing the rule and the date together is fine
		await db.execute(sql`update tasks set due_date = null, repeat_rule = null where id = ${t.id}`);
		expect((await store.get(userId, t.id))!).toMatchObject({ dueDate: null, repeatRule: null });
	});
});
