import {
	and,
	asc,
	count,
	desc,
	eq,
	getTableColumns,
	gt,
	ilike,
	isNotNull,
	isNull,
	lte,
	min,
	ne,
	or,
	sql
} from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { isDateString } from '../dates';
import {
	firstOccurrence,
	nextAfterCompletion,
	parseRule,
	recurringDue,
	type RepeatRule
} from '../repeat';
import { lists, tasks, type Task } from './db/schema';
import type { Db } from './db/types';
import { generateKeyBetween, keyBetween } from './ordering';

/** null = Inbox */
export type ListId = string | null;

export const SEARCH_LIMIT = 100;

/** The words of a search query; nothing until the query has at least 2 characters. */
export function searchWords(query: string): string[] {
	const trimmed = query.trim();
	if (trimmed.length < 2) return [];
	return trimmed.split(/\s+/).slice(0, 10);
}

/** LIKE treats % and _ as wildcards and \ as its escape character: make them literal. */
export function escapeLike(text: string): string {
	return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

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

	/**
	 * Clearing the due date of a recurring task gives it the rule's first
	 * occurrence on or after `today` instead (the database's CHECK is the backstop).
	 */
	async function keepRecurringDue<V extends { dueDate?: string | null }>(
		userId: string,
		id: string,
		values: V,
		today: string | undefined
	): Promise<V> {
		if (values.dueDate !== null) return values;
		const task = await get(userId, id);
		if (!task?.repeatRule) return values;
		if (!today) throw new Error("today is required to clear a recurring task's due date");
		return { ...values, dueDate: recurringDue(task.repeatRule, null, today) };
	}

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

		/**
		 * Search titles and notes, case-insensitively. Every word must appear in the
		 * title or the notes; % _ and \ match literally. Open tasks first (by due
		 * date), then completed ones (newest first). Queries under 2 characters match nothing.
		 */
		search(userId: string, query: string, limit = SEARCH_LIMIT) {
			const words = searchWords(query);
			if (words.length === 0) return Promise.resolve([] as Task[]);
			const matches = words.map((word) => {
				const pattern = `%${escapeLike(word)}%`;
				return or(ilike(tasks.title, pattern), ilike(tasks.notes, pattern));
			});
			return db
				.select()
				.from(tasks)
				.where(and(live(userId), ...matches))
				.orderBy(
					sql`${tasks.completedAt} is not null`,
					sql`${tasks.dueDate} asc nulls last`,
					desc(tasks.completedAt),
					desc(tasks.createdAt),
					asc(tasks.id)
				)
				.limit(limit);
		},

		/** Every task row the user has, soft-deleted and completed included (for guest caps). */
		async countAll(userId: string): Promise<number> {
			const [row] = await db.select({ n: count() }).from(tasks).where(eq(tasks.userId, userId));
			return row?.n ?? 0;
		},

		/**
		 * New tasks go to the top of their list. Returns null if the list isn't the
		 * user's, or the input is invalid (a recurring task needs a due date).
		 */
		async create(
			userId: string,
			input: {
				title: string;
				listId: ListId;
				dueDate?: string | null;
				repeatRule?: RepeatRule | null;
				/** The user's today: gives an undated recurring task its first occurrence. */
				today?: string;
			}
		) {
			if (!(await ownsList(userId, input.listId))) return null;
			if (input.dueDate != null && !isDateString(input.dueDate)) return null;
			const rule = input.repeatRule ? parseRule(input.repeatRule) : null;
			if (input.repeatRule && !rule) return null;
			if (rule && !input.dueDate && !input.today) return null;
			const dueDate = recurringDue(rule, input.dueDate, input.today ?? '');
			const [row] = await db
				.insert(tasks)
				.values({
					userId,
					listId: input.listId,
					title: input.title,
					dueDate,
					repeatRule: rule,
					seriesId: rule ? randomUUID() : null,
					order: await topKey(userId, input.listId)
				})
				.returning();
			return row;
		},

		/**
		 * `today` (the user's day) is needed when clearing the due date: a recurring
		 * task can't lose it, so it goes to the rule's first occurrence instead.
		 */
		async update(
			userId: string,
			id: string,
			values: {
				title?: string;
				notes?: string | null;
				dueDate?: string | null;
				pinnedToday?: boolean;
			},
			today?: string
		) {
			if (values.dueDate != null && !isDateString(values.dueDate)) return null;
			return update(userId, id, await keepRecurringDue(userId, id, values, today));
		},

		/** Set or clear (null) the due date: a 'YYYY-MM-DD' calendar day. See `update` for `today`. */
		async setDueDate(userId: string, id: string, dueDate: string | null, today?: string) {
			if (dueDate !== null && !isDateString(dueDate)) return null;
			return update(userId, id, await keepRecurringDue(userId, id, { dueDate }, today));
		},

		setPinned(userId: string, id: string, pinned: boolean) {
			return update(userId, id, { pinnedToday: pinned });
		},

		setCompleted(userId: string, id: string, completed: boolean) {
			return update(userId, id, { completedAt: completed ? new Date() : null });
		},

		/**
		 * Set a repeat (the due date moves onto the rule: the first occurrence on or
		 * after the current due date, or today when there is none) or end one (null).
		 */
		async setRepeat(userId: string, id: string, rule: RepeatRule | null, today: string) {
			const task = await get(userId, id);
			if (!task) return null;
			if (!rule) return update(userId, id, { repeatRule: null });
			const valid = parseRule(rule);
			if (!valid) return null;
			return update(userId, id, {
				repeatRule: valid,
				seriesId: task.seriesId ?? randomUUID(),
				dueDate: firstOccurrence(valid, recurringDue(valid, task.dueDate, today)!)
			});
		},

		/**
		 * Complete a task. For a recurring task this also creates the next
		 * occurrence, in the same statement: the insert only happens if the update
		 * matched an open task, so a double submit can never create two. The copy
		 * takes user_id and everything else from the matched row, never from input.
		 * `allowNext: false` (the guest cap) completes without creating the next one.
		 */
		async complete(
			userId: string,
			id: string,
			today: string,
			{ allowNext = true, now = new Date() }: { allowNext?: boolean; now?: Date } = {}
		) {
			const task = await get(userId, id);
			if (!task || task.completedAt) return null;
			const rule = task.repeatRule;
			const nextDue = rule && task.dueDate ? nextAfterCompletion(rule, task.dueDate, today) : null;
			const createNext = !!nextDue && allowNext;
			const order = createNext ? await topKey(userId, task.listId) : null;
			const at = now.toISOString();

			const result = await db.execute<{ done_id: string | null; next_id: string | null }>(sql`
				with done as (
					update ${tasks}
					set completed_at = ${at}::timestamptz, updated_at = ${at}::timestamptz
					where id = ${id} and user_id = ${userId} and completed_at is null and deleted_at is null
					returning *
				), next as (
					insert into ${tasks} (user_id, list_id, title, notes, due_date, repeat_rule, series_id,
						previous_id, "order", pinned_today, created_at, updated_at)
					select user_id, list_id, title, notes, ${nextDue}::date, repeat_rule, series_id,
						id, ${order}, false, ${at}::timestamptz, ${at}::timestamptz
					from done
					where ${createNext}::boolean and repeat_rule is not null
					returning id
				)
				select (select id from done) as done_id, (select id from next) as next_id
			`);
			const [row] = (
				result as unknown as { rows: { done_id: string | null; next_id: string | null }[] }
			).rows;
			if (!row?.done_id) return null;
			return {
				task: (await db.select().from(tasks).where(eq(tasks.id, row.done_id)))[0],
				next: row.next_id ? await get(userId, row.next_id) : null,
				/** A recurring task completed without its next occurrence (guest cap). */
				nextBlocked: !!nextDue && !allowNext
			};
		},

		/**
		 * Undo a completion. If the occurrence generated from this one is untouched
		 * (never edited, moved, completed or deleted), it is soft-deleted and this one
		 * is the live occurrence again. If it was touched, it stays and this one
		 * loses its repeat, so a series never has two live occurrences. One statement.
		 */
		async uncomplete(userId: string, id: string, { now = new Date() }: { now?: Date } = {}) {
			const at = now.toISOString();
			const result = await db.execute<{ id: string | null }>(sql`
				with target as (
					select id from ${tasks}
					where id = ${id} and user_id = ${userId} and completed_at is not null and deleted_at is null
				), generated as (
					select id, (completed_at is null and deleted_at is null and updated_at = created_at) as untouched
					from ${tasks}
					where previous_id in (select id from target) and user_id = ${userId}
				), dropped as (
					update ${tasks} set deleted_at = ${at}::timestamptz
					where id in (select id from generated where untouched)
					returning id
				), restored as (
					update ${tasks}
					set completed_at = null, updated_at = ${at}::timestamptz,
						repeat_rule = case when exists (select 1 from generated where not untouched)
							then null else repeat_rule end
					where id in (select id from target)
					returning id
				)
				select (select id from restored) as id
			`);
			const [row] = (result as unknown as { rows: { id: string | null }[] }).rows;
			return row?.id ? get(userId, row.id) : null;
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
