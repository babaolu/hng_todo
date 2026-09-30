import {
	and,
	asc,
	count,
	desc,
	eq,
	getTableColumns,
	gt,
	isNotNull,
	isNull,
	lte,
	min,
	ne,
	or,
	sql
} from 'drizzle-orm';
import { isDateString } from '../dates';
import { lists, tasks, type Task } from './db/schema';
import type { Db } from './db/types';
import { generateKeyBetween, keyBetween } from './ordering';

/** null = Inbox */
export type ListId = string | null;

export type TaskStore = ReturnType<typeof createTaskStore>;

export function createTaskStore(db: Db) {
	const live = (userId: string) => and(eq(tasks.userId, userId), isNull(tasks.deletedAt));
	const inList = (listId: ListId) =>
		listId === null ? isNull(tasks.listId) : eq(tasks.listId, listId);

	async function ownsList(userId: string, listId: ListId): Promise<boolean> {
		if (listId === null) return true;
		const [row] = await db
			.select({ id: lists.id })
			.from(lists)
			.where(and(eq(lists.id, listId), eq(lists.userId, userId), isNull(lists.deletedAt)));
		return !!row;
	}

	async function topKey(userId: string, listId: ListId): Promise<string> {
		const [row] = await db
			.select({ first: min(tasks.order) })
			.from(tasks)
			.where(and(live(userId), inList(listId)));
		return generateKeyBetween(null, row?.first ?? null);
	}

	async function get(userId: string, id: string) {
		const [row] = await db
			.select()
			.from(tasks)
			.where(and(eq(tasks.id, id), live(userId)));
		return row ?? null;
	}

	/** Today and Upcoming are ordered by date, then list (Inbox first), then manual order. */
	function byDate(userId: string, where: ReturnType<typeof and>) {
		return db
			.select(getTableColumns(tasks))
			.from(tasks)
			.leftJoin(lists, eq(lists.id, tasks.listId))
			.where(and(live(userId), isNull(tasks.completedAt), where))
			.orderBy(
				sql`${tasks.dueDate} asc nulls last`,
				sql`${lists.order} asc nulls first`,
				asc(tasks.order),
				asc(tasks.id)
			);
	}

	/** Due today or earlier, or pinned to Today. `today` is the user's local date. */
	const inToday = (today: string) => or(lte(tasks.dueDate, today), eq(tasks.pinnedToday, true));

	async function update(userId: string, id: string, values: Partial<Task>) {
		const [row] = await db
			.update(tasks)
			.set({ ...values, updatedAt: new Date() })
			.where(and(eq(tasks.id, id), live(userId)))
			.returning();
		return row ?? null;
	}

	return {
		/** Active (not completed) tasks in a list or the Inbox, in manual order. */
		listActive(userId: string, listId: ListId) {
			return db
				.select()
				.from(tasks)
				.where(and(live(userId), inList(listId), isNull(tasks.completedAt)))
				.orderBy(asc(tasks.order), asc(tasks.createdAt), asc(tasks.id));
		},

		/** Logbook: completed tasks, newest first. */
		listCompleted(userId: string, limit = 300) {
			return db
				.select()
				.from(tasks)
				.where(and(live(userId), isNotNull(tasks.completedAt)))
				.orderBy(desc(tasks.completedAt), desc(tasks.id))
				.limit(limit);
		},

		/** Today: active tasks due on or before `today` (overdue included) or pinned, across all lists. */
		listToday(userId: string, today: string) {
			return byDate(userId, inToday(today));
		},

		/** Upcoming: active tasks due after `today`; the view groups them by day. */
		listUpcoming(userId: string, today: string) {
			return byDate(userId, gt(tasks.dueDate, today));
		},

		async todayCount(userId: string, today: string): Promise<number> {
			const [row] = await db
				.select({ n: count() })
				.from(tasks)
				.where(and(live(userId), isNull(tasks.completedAt), inToday(today)));
			return row?.n ?? 0;
		},

		/** Active task counts keyed by list id ('inbox' for the Inbox). */
		async activeCounts(userId: string): Promise<Record<string, number>> {
			const rows = await db
				.select({ listId: tasks.listId, n: count() })
				.from(tasks)
				.where(and(live(userId), isNull(tasks.completedAt)))
				.groupBy(tasks.listId);
			return Object.fromEntries(rows.map((r) => [r.listId ?? 'inbox', r.n]));
		},

		get,

		/** New tasks go to the top of their list. Returns null if the list isn't the user's. */
		async create(
			userId: string,
			input: { title: string; listId: ListId; dueDate?: string | null }
		) {
			if (!(await ownsList(userId, input.listId))) return null;
			if (input.dueDate != null && !isDateString(input.dueDate)) return null;
			const [row] = await db
				.insert(tasks)
				.values({
					userId,
					listId: input.listId,
					title: input.title,
					dueDate: input.dueDate ?? null,
					order: await topKey(userId, input.listId)
				})
				.returning();
			return row;
		},

		update(
			userId: string,
			id: string,
			values: {
				title?: string;
				notes?: string | null;
				dueDate?: string | null;
				pinnedToday?: boolean;
			}
		) {
			if (values.dueDate != null && !isDateString(values.dueDate)) return Promise.resolve(null);
			return update(userId, id, values);
		},

		/** Set or clear (null) the due date: a 'YYYY-MM-DD' calendar day. */
		setDueDate(userId: string, id: string, dueDate: string | null) {
			if (dueDate !== null && !isDateString(dueDate)) return Promise.resolve(null);
			return update(userId, id, { dueDate });
		},

		setPinned(userId: string, id: string, pinned: boolean) {
			return update(userId, id, { pinnedToday: pinned });
		},

		setCompleted(userId: string, id: string, completed: boolean) {
			return update(userId, id, { completedAt: completed ? new Date() : null });
		},

		/** Move to another list (or the Inbox), placing the task at the top. */
		async move(userId: string, id: string, listId: ListId) {
			const task = await get(userId, id);
			if (!task || !(await ownsList(userId, listId))) return null;
			if (task.listId === listId) return task;
			return update(userId, id, { listId, order: await topKey(userId, listId) });
		},

		/**
		 * Place a task after `prevId` and before `nextId` (null = start / end) within
		 * its own list. Only the moved row is written.
		 */
		async reorder(userId: string, id: string, prevId: string | null, nextId: string | null) {
			const task = await get(userId, id);
			if (!task || id === prevId || id === nextId) return null;

			const sibling = async (siblingId: string | null) => {
				if (siblingId === null) return null;
				const [row] = await db
					.select({ order: tasks.order })
					.from(tasks)
					.where(and(eq(tasks.id, siblingId), live(userId), inList(task.listId)));
				return row ?? undefined;
			};
			const [prev, next] = await Promise.all([sibling(prevId), sibling(nextId)]);
			if (prev === undefined || next === undefined) return null;

			const order = await keyBetween(prev?.order ?? null, next?.order ?? null, async (key) => {
				const [row] = await db
					.select({ first: min(tasks.order) })
					.from(tasks)
					.where(and(live(userId), inList(task.listId), gt(tasks.order, key), ne(tasks.id, id)));
				return row?.first ?? null;
			});
			return update(userId, id, { order });
		},

		/** Soft delete. */
		remove(userId: string, id: string) {
			return update(userId, id, { deletedAt: new Date() });
		},

		/** Undo a soft delete. If its list has since been deleted, it returns to the Inbox. */
		async restore(userId: string, id: string) {
			const [task] = await db
				.select()
				.from(tasks)
				.where(and(eq(tasks.id, id), eq(tasks.userId, userId), isNotNull(tasks.deletedAt)));
			if (!task) return null;
			const listId = (await ownsList(userId, task.listId)) ? task.listId : null;
			const [row] = await db
				.update(tasks)
				.set({ deletedAt: null, listId, updatedAt: new Date() })
				.where(and(eq(tasks.id, id), eq(tasks.userId, userId)))
				.returning();
			return row ?? null;
		}
	};
}
