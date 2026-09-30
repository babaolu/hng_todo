import { error, fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { isDateString, todayIn } from '$lib/dates';
import { parseQuickAdd, type DateOrder } from '$lib/quick-add';
import { data } from './data';
import { GUEST_LIMITS } from './guests';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_TITLE = 500;
export const MAX_NOTES = 10_000;
export const MAX_LIST_NAME = 100;

export function isUuid(value: unknown): value is string {
	return typeof value === 'string' && UUID.test(value);
}

/** hooks.server.ts already redirects anonymous requests; this narrows the type and guards anyway. */
export function requireUser(locals: App.Locals): string {
	if (!locals.user) redirect(303, '/login');
	return locals.user.id;
}

function text(form: FormData, key: string): string {
	const value = form.get(key);
	return typeof value === 'string' ? value : '';
}

/** A required uuid field; anything else is a 400 before it reaches the database. */
function id(form: FormData, key = 'id'): string {
	const value = text(form, key);
	if (!isUuid(value)) error(400, `Invalid ${key}`);
	return value;
}

/** An optional uuid: '' / 'inbox' / missing mean null. */
function optionalId(form: FormData, key: string): string | null {
	const value = text(form, key);
	if (value === '' || value === 'inbox') return null;
	if (!isUuid(value)) error(400, `Invalid ${key}`);
	return value;
}

function found<T>(row: T | null | undefined): T {
	if (!row) error(404, 'Not found');
	return row;
}

type Event = RequestEvent;

async function setup({ locals, request }: Event) {
	const userId = requireUser(locals);
	const { timeZone, isGuest } = locals.user!;
	return { userId, timeZone, isGuest, form: await request.formData() };
}

/** Form actions shared by every task view (Today, Upcoming, Inbox, lists, Logbook). */
export const taskActions = {
	/**
	 * Quick-add. The raw text is parsed here (dates, #list); fields parsed by the
	 * client for its preview are never trusted. parse=false keeps the text literal.
	 */
	async addTask(event: Event) {
		const { userId, timeZone, isGuest, form } = await setup(event);
		const raw = text(form, 'title').trim();
		if (!raw) return fail(400, { addError: 'Title is required' });
		if (raw.length > MAX_TITLE) return fail(400, { addError: 'Title is too long' });
		// Guests only; deleted tasks count too, so a create/delete loop can't grow the database.
		if (isGuest && (await data.tasks.countAll(userId)) >= GUEST_LIMITS.tasks) {
			return fail(403, {
				addError: `Guest accounts can hold up to ${GUEST_LIMITS.tasks} tasks, including completed and deleted ones.`
			});
		}

		const today = todayIn(timeZone);
		let title = raw;
		let listId = optionalId(form, 'listId');
		// Only the Today view adds a default date; Upcoming, Inbox and lists add none.
		let dueDate = text(form, 'view') === 'today' ? today : null;

		// parse=false (the user dismissed a chip) keeps the text literal and ignores any picked date.
		if (text(form, 'parse') !== 'false') {
			// A date chosen in the chip's picker replaces the parsed one.
			const picked = text(form, 'dueDate');
			if (picked && !isDateString(picked)) return fail(400, { addError: 'Invalid due date' });

			const lists = raw.includes('#') ? await data.lists.all(userId) : [];
			const dateOrder = dateOrderFor(form, event.request);
			const parsed = parseQuickAdd(raw, { today, lists, dateOrder });
			title = parsed.title;
			listId = parsed.listId ?? listId;
			dueDate = picked || parsed.dueDate || dueDate;
		}

		const task = found(await data.tasks.create(userId, { title, listId, dueDate }));
		return {
			added: { id: task.id, title: task.title, listId: task.listId, dueDate: task.dueDate }
		};
	},

	async toggleTask(event: Event) {
		const { userId, form } = await setup(event);
		found(await data.tasks.setCompleted(userId, id(form), text(form, 'completed') === 'true'));
	},

	/** Save from the detail panel: title, notes, due date, pin and (optionally) list. */
	async saveTask(event: Event) {
		const { userId, form } = await setup(event);
		const taskId = id(form);
		const title = text(form, 'title').trim();
		const notes = text(form, 'notes').trim();
		if (!title) return fail(400, { saveError: 'Title is required' });
		if (title.length > MAX_TITLE) return fail(400, { saveError: 'Title is too long' });
		if (notes.length > MAX_NOTES) return fail(400, { saveError: 'Notes are too long' });

		const values: Parameters<typeof data.tasks.update>[2] = { title, notes: notes || null };
		if (form.has('dueDate')) {
			// The Clear button submits clearDue (the no-JS path); an empty date input also clears.
			const due = form.has('clearDue') ? '' : text(form, 'dueDate');
			if (due && !isDateString(due)) return fail(400, { saveError: 'Invalid due date' });
			values.dueDate = due || null;
		}
		// Checkboxes send nothing when unticked, so the form marks that the field was present.
		if (form.has('pinField')) values.pinnedToday = form.has('pinnedToday');

		found(await data.tasks.update(userId, taskId, values));
		if (form.has('listId'))
			found(await data.tasks.move(userId, taskId, optionalId(form, 'listId')));
	},

	async pinTask(event: Event) {
		const { userId, form } = await setup(event);
		found(await data.tasks.setPinned(userId, id(form), text(form, 'pinned') === 'true'));
	},

	async reorderTask(event: Event) {
		const { userId, form } = await setup(event);
		const moved = await data.tasks.reorder(
			userId,
			id(form),
			optionalId(form, 'prevId'),
			optionalId(form, 'nextId')
		);
		if (!moved) return fail(409, { reorderError: 'Could not reorder; refreshing.' });
	},

	/** One step up or down, computed on the server (the no-JS fallback for drag and drop). */
	async stepTask(event: Event) {
		const { userId, form } = await setup(event);
		const task = found(await data.tasks.get(userId, id(form)));
		const siblings = await data.tasks.listActive(userId, task.listId);
		const i = siblings.findIndex((t) => t.id === task.id);
		if (i === -1) return;
		const others = siblings.filter((t) => t.id !== task.id);
		const at =
			text(form, 'direction') === 'up' ? Math.max(0, i - 1) : Math.min(others.length, i + 1);
		await data.tasks.reorder(userId, task.id, others[at - 1]?.id ?? null, others[at]?.id ?? null);
	},

	async deleteTask(event: Event) {
		const { userId, form } = await setup(event);
		const task = found(await data.tasks.remove(userId, id(form)));
		return { deleted: { id: task.id, title: task.title } };
	},

	async restoreTask(event: Event) {
		const { userId, form } = await setup(event);
		found(await data.tasks.restore(userId, id(form)));
	}
};

/** Form actions for the sidebar and list header, available on every app page. */
export const listActions = {
	async createList(event: Event) {
		const { userId, isGuest, form } = await setup(event);
		const name = text(form, 'name').trim();
		if (!name) return fail(400, { listError: 'Name is required' });
		if (name.length > MAX_LIST_NAME) return fail(400, { listError: 'Name is too long' });
		if (isGuest && (await data.lists.countAll(userId)) >= GUEST_LIMITS.lists) {
			return fail(403, {
				listError: `Guest accounts can have up to ${GUEST_LIMITS.lists} lists, including deleted ones.`
			});
		}
		const list = await data.lists.create(userId, name);
		redirect(303, `/lists/${list.id}`);
	},

	async renameList(event: Event) {
		const { userId, form } = await setup(event);
		const name = text(form, 'name').trim();
		if (!name) return fail(400, { renameError: 'Name is required' });
		if (name.length > MAX_LIST_NAME) return fail(400, { renameError: 'Name is too long' });
		found(await data.lists.rename(userId, id(form), name));
	},

	async archiveList(event: Event) {
		const { userId, form } = await setup(event);
		found(await data.lists.setArchived(userId, id(form), text(form, 'archived') === 'true'));
	},

	async reorderList(event: Event) {
		const { userId, form } = await setup(event);
		const moved = await data.lists.reorder(
			userId,
			id(form),
			optionalId(form, 'prevId'),
			optionalId(form, 'nextId')
		);
		if (!moved) return fail(409, { reorderError: 'Could not reorder; refreshing.' });
	},

	async deleteList(event: Event) {
		const { userId, form } = await setup(event);
		if (!(await data.lists.remove(userId, id(form)))) error(404, 'Not found');
		redirect(303, '/');
	}
};

export const appActions = { ...taskActions, ...listActions };

/**
 * Day/month order for slash dates: a parsing setting, not a parse result. The
 * client sends its locale's order; anything unexpected means day-first. Without
 * JS there's no field, so the browser's preferred language decides (en-US ->
 * month-first).
 */
export function dateOrderFor(form: FormData, request: Request): DateOrder {
	if (form.has('dateOrder')) return text(form, 'dateOrder') === 'mdy' ? 'mdy' : 'dmy';
	const preferred = request.headers.get('accept-language')?.split(',')[0]?.split(';')[0];
	return preferred?.trim().toLowerCase() === 'en-us' ? 'mdy' : 'dmy';
}

/** The task open in the detail panel via ?task=<id> (the no-JS path; with JS it's shallow routing). */
export async function selectedTask(userId: string, url: URL) {
	const taskId = url.searchParams.get('task');
	return isUuid(taskId) ? data.tasks.get(userId, taskId) : null;
}
