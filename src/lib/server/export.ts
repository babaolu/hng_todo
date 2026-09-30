/**
 * "Download my data": the user's lists and tasks as JSON. Columns are
 * whitelisted here, so account details (user ids, emails, password hashes,
 * sessions, guest IPs, login attempts) can never end up in an export.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { todayIn } from '../dates';
import { lists, tasks } from './db/schema';
import type { Db } from './db/types';

export const EXPORT_FORMAT = 'todo-export';
export const EXPORT_VERSION = 1;

export type ExportStore = ReturnType<typeof createExportStore>;

export function createExportStore(db: Db) {
	return {
		async build(userId: string, timeZone: string, now: Date = new Date()) {
			const [listRows, taskRows] = await Promise.all([
				db
					.select({
						id: lists.id,
						name: lists.name,
						archived: lists.archived,
						created_at: lists.createdAt,
						updated_at: lists.updatedAt
					})
					.from(lists)
					.where(and(eq(lists.userId, userId), isNull(lists.deletedAt)))
					.orderBy(asc(lists.order), asc(lists.id)),
				db
					.select({
						id: tasks.id,
						list_id: tasks.listId,
						title: tasks.title,
						notes: tasks.notes,
						due_date: tasks.dueDate,
						pinned_today: tasks.pinnedToday,
						repeat_rule: tasks.repeatRule,
						series_id: tasks.seriesId,
						completed_at: tasks.completedAt,
						created_at: tasks.createdAt,
						updated_at: tasks.updatedAt
					})
					.from(tasks)
					.where(and(eq(tasks.userId, userId), isNull(tasks.deletedAt)))
					.orderBy(asc(tasks.createdAt), asc(tasks.id))
			]);
			return {
				format: EXPORT_FORMAT,
				version: EXPORT_VERSION,
				exported_at: now.toISOString(),
				time_zone: timeZone,
				lists: listRows,
				tasks: taskRows
			};
		},

		/** todo-export-YYYY-MM-DD.json, dated in the user's zone. */
		filename(timeZone: string, now: Date = new Date()) {
			return `todo-export-${todayIn(timeZone, now)}.json`;
		}
	};
}
