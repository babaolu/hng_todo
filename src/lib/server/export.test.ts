import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { createExportStore } from './export';
import type { Db } from './db/types';
import { createListStore } from './lists';
import { createTaskStore } from './tasks';
import { createTestDb, createUser } from './test/db';

const stores = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock('$lib/server/data', () => ({ data: stores }));
const route = await import('../../routes/(app)/settings/export/+server');

let db: Db;
let close: () => Promise<void>;
let userId: string;

beforeAll(async () => {
	({ db, close } = await createTestDb());
	userId = await createUser(db, 'me@example.com');
	Object.assign(stores, { exports: createExportStore(db) });
	const lists = createListStore(db);
	const tasks = createTaskStore(db);
	const home = await lists.create(userId, 'Home');
	const old = await lists.create(userId, 'Old');
	await lists.setArchived(userId, old.id, true);
	const gone = await lists.create(userId, 'Gone');
	await lists.remove(userId, gone.id);
	await tasks.create(userId, { title: 'open', listId: home.id, dueDate: '2026-10-05' });
	const done = (await tasks.create(userId, { title: 'done', listId: null }))!;
	await tasks.setCompleted(userId, done.id, true);
	const deleted = (await tasks.create(userId, { title: 'deleted', listId: null }))!;
	await tasks.remove(userId, deleted.id);
	await tasks.create(userId, {
		title: 'recurring',
		listId: null,
		dueDate: '2026-10-05',
		repeatRule: { freq: 'daily', interval: 2, anchor: '2026-10-05' }
	});
});
afterAll(() => close());

describe('export contents', () => {
	it('has the format header, archived lists, open and completed tasks, and no deleted rows', async () => {
		const out = await createExportStore(db).build(
			userId,
			'Africa/Lagos',
			new Date('2026-09-30T10:00:00Z')
		);
		expect(out).toMatchObject({
			format: 'todo-export',
			version: 1,
			exported_at: '2026-09-30T10:00:00.000Z',
			time_zone: 'Africa/Lagos'
		});
		expect(out.lists.map((l) => [l.name, l.archived])).toEqual([
			['Home', false],
			['Old', true]
		]);
		expect(out.tasks.map((t) => t.title).sort()).toEqual(['done', 'open', 'recurring']);
		expect(out.tasks.find((t) => t.title === 'recurring')!.repeat_rule).toEqual({
			freq: 'daily',
			interval: 2,
			anchor: '2026-10-05'
		});
	});

	it('has exactly the documented fields', async () => {
		const out = await createExportStore(db).build(userId, 'UTC');
		expect(Object.keys(out.lists[0]).sort()).toEqual([
			'archived',
			'created_at',
			'id',
			'name',
			'updated_at'
		]);
		expect(Object.keys(out.tasks[0]).sort()).toEqual(
			[
				'completed_at',
				'created_at',
				'due_date',
				'id',
				'list_id',
				'notes',
				'pinned_today',
				'repeat_rule',
				'series_id',
				'title',
				'updated_at'
			].sort()
		);
	});

	it("names the file with the user's local date", () => {
		const late = new Date('2026-09-30T23:30:00Z');
		expect(createExportStore(db).filename('Africa/Lagos', late)).toBe(
			'todo-export-2026-10-01.json'
		);
		expect(createExportStore(db).filename('UTC', late)).toBe('todo-export-2026-09-30.json');
	});
});

describe('GET /settings/export', () => {
	it('returns a no-store JSON attachment', async () => {
		const res = await route.GET({
			locals: {
				user: {
					id: userId,
					email: 'me@example.com',
					timeZone: 'UTC',
					isGuest: false,
					guestExpiresAt: null
				}
			}
		} as unknown as RequestEvent<Record<string, never>, '/(app)/settings/export'>);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(res.headers.get('content-type')).toMatch(/^application\/json/);
		expect(res.headers.get('content-disposition')).toMatch(
			/^attachment; filename="todo-export-\d{4}-\d{2}-\d{2}\.json"$/
		);
		const body = await res.json();
		expect(body.format).toBe('todo-export');
		expect(JSON.stringify(body)).not.toContain('me@example.com');
	});
});
