import { and, asc, eq, gt, isNull, max, min, ne, sql } from 'drizzle-orm';
import { lists, tasks } from './db/schema';
import type { Db } from './db/types';
import { generateKeyBetween, keyBetween } from './ordering';

export type ListStore = ReturnType<typeof createListStore>;

export function createListStore(db: Db) {
	const live = (userId: string) => and(eq(lists.userId, userId), isNull(lists.deletedAt));

	async function get(userId: string, id: string) {
		const [row] = await db
			.select()
			.from(lists)
			.where(and(eq(lists.id, id), live(userId)));
		return row ?? null;
	}

	async function update(userId: string, id: string, values: Partial<typeof lists.$inferInsert>) {
		const [row] = await db
			.update(lists)
			.set({ ...values, updatedAt: new Date() })
			.where(and(eq(lists.id, id), live(userId)))
			.returning();
		return row ?? null;
	}

	return {
		/** All non-deleted lists (archived included), in manual order. */
		all(userId: string) {
			return db
				.select()
				.from(lists)
				.where(live(userId))
				.orderBy(asc(lists.order), asc(lists.createdAt), asc(lists.id));
		},

		get,

		/** New lists go to the bottom of the sidebar. */
		async create(userId: string, name: string) {
			const [last] = await db
				.select({ key: max(lists.order) })
				.from(lists)
				.where(live(userId));
			const [row] = await db
				.insert(lists)
				.values({ userId, name, order: generateKeyBetween(last?.key ?? null, null) })
				.returning();
			return row;
		},

		rename(userId: string, id: string, name: string) {
			return update(userId, id, { name });
		},

		setArchived(userId: string, id: string, archived: boolean) {
			return update(userId, id, { archived });
		},

		/** Place a list after `prevId` and before `nextId` (null = start / end). */
		async reorder(userId: string, id: string, prevId: string | null, nextId: string | null) {
			if (id === prevId || id === nextId || !(await get(userId, id))) return null;
			const [prev, next] = await Promise.all(
				[prevId, nextId].map(async (siblingId) => {
					if (siblingId === null) return null;
					return (await get(userId, siblingId)) ?? undefined;
				})
			);
			if (prev === undefined || next === undefined) return null;

			const order = await keyBetween(prev?.order ?? null, next?.order ?? null, async (key) => {
				const [row] = await db
					.select({ first: min(lists.order) })
					.from(lists)
					.where(and(live(userId), gt(lists.order, key), ne(lists.id, id)));
				return row?.first ?? null;
			});
			return update(userId, id, { order });
		},

		/**
		 * Soft delete the list and move its tasks to the Inbox. One statement, so it
		 * is atomic without an interactive transaction (neon-http has none).
		 */
		async remove(userId: string, id: string): Promise<boolean> {
			const result = await db.execute<{ id: string }>(sql`
				with deleted as (
					update ${lists}
					set deleted_at = now(), updated_at = now()
					where ${lists.id} = ${id} and ${lists.userId} = ${userId} and ${lists.deletedAt} is null
					returning ${lists.id}
				), moved as (
					update ${tasks}
					set list_id = null, updated_at = now()
					where ${tasks.userId} = ${userId} and ${tasks.listId} in (select id from deleted)
				)
				select id from deleted
			`);
			return rowsOf(result).length > 0;
		}
	};
}

/** Both drivers return `{ rows }`; the shared Db type just doesn't say so. */
function rowsOf<T>(result: unknown): T[] {
	return (result as { rows: T[] }).rows;
}
