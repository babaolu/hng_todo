/**
 * Guest mode end to end through the real hooks, login and logout actions and
 * task/list actions, against PGlite, with the GUEST_MODE switch mocked.
 */
import {
	isActionFailure,
	isHttpError,
	isRedirect,
	type Cookies,
	type RequestEvent
} from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthStore } from './auth';
import { lists, sessions, tasks, users } from './db/schema';
import type { Db } from './db/types';
import { createGuestStore } from './guests';
import { createListStore } from './lists';
import { hashPassword } from './password';
import { SESSION_COOKIE } from './session';
import { createTaskStore } from './tasks';
import { createTestDb, createUser } from './test/db';

const mode = vi.hoisted(() => ({ on: true }));
const stores = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock('$lib/server/guest-mode', () => ({ guestModeOn: () => mode.on }));
vi.mock('$lib/server/data', () => ({ data: stores, useDb: () => {} }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));

const hooks = await import('../../hooks.server');
const loginRoute = await import('../../routes/login/+page.server');
const logoutRoute = await import('../../routes/logout/+page.server');
const { taskActions, listActions } = await import('./actions');

let db: Db;
let close: () => Promise<void>;
let realId: string;

beforeAll(async () => {
	({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
	mode.on = true;
	await db.delete(users);
	Object.assign(stores, {
		auth: createAuthStore(db),
		guests: createGuestStore(db),
		lists: createListStore(db),
		tasks: createTaskStore(db)
	});
	realId = await createUser(db, 'real@example.com', await hashPassword('a-real-password-1'));
	await db
		.update(users)
		.set({ createdAt: new Date(Date.now() - 30 * 86_400_000) })
		.where(eq(users.id, realId));
	await createListStore(db).create(realId, 'Real list');
	await createTaskStore(db).create(realId, { title: 'real task', listId: null });
});

function jar(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	return {
		values,
		get: (name: string) => values.get(name),
		getAll: () => [...values].map(([name, value]) => ({ name, value })),
		set: (name: string, value: string) => void values.set(name, value),
		delete: (name: string) => void values.delete(name),
		serialize: () => ''
	} as unknown as Cookies & { values: Map<string, string> };
}

function event(
	path: string,
	{
		cookies = jar(),
		form,
		user = null,
		ip = '203.0.113.5'
	}: {
		cookies?: ReturnType<typeof jar>;
		form?: Record<string, string>;
		user?: unknown;
		ip?: string;
	} = {}
) {
	const body = new FormData();
	for (const [k, v] of Object.entries(form ?? {})) body.set(k, v);
	return {
		url: new URL(`http://localhost${path}`),
		cookies,
		locals: { user },
		request: new Request(`http://localhost${path}`, {
			method: form ? 'POST' : 'GET',
			body: form ? body : undefined
		}),
		getClientAddress: () => ip
		// Stands in for any route's RequestEvent in these tests.
	} as any as RequestEvent<any, any> & { cookies: ReturnType<typeof jar> };
}

async function caught(fn: () => unknown) {
	try {
		return { value: await fn() };
	} catch (thrown) {
		return { thrown };
	}
}

/** Create a guest through the real action; returns its session cookie and id. */
async function createGuestViaAction(ip = '203.0.113.5', tz?: string) {
	const cookies = jar(tz ? { tz } : {});
	const r = await caught(() =>
		loginRoute.actions.guest(event('/login', { cookies, form: {}, ip }))
	);
	expect(isRedirect(r.thrown) && r.thrown.location).toBe('/');
	const token = cookies.values.get(SESSION_COOKIE)!;
	const session = await createAuthStore(db).validateSession(token);
	return { token, user: session!.user };
}

/** What beforeEach gives the real user; asserted exactly, so a wrongful delete can't hide. */
const REAL_ROWS = { user: 1, lists: 1, tasks: 1 };

const guestCount = async () =>
	(await db.select().from(users).where(eq(users.isGuest, true))).length;
const realRows = async () => ({
	user: (await db.select().from(users).where(eq(users.id, realId))).length,
	lists: (await db.select().from(lists).where(eq(lists.userId, realId))).length,
	tasks: (await db.select().from(tasks).where(eq(tasks.userId, realId))).length
});

describe('creating a guest from /login', () => {
	it('shows the button only when guest mode is on', () => {
		expect(loginRoute.load({} as never)).toEqual({ guestMode: true });
		mode.on = false;
		expect(loginRoute.load({} as never)).toEqual({ guestMode: false });
	});

	it('creates a guest with sample data, signs it in, and uses a valid tz cookie', async () => {
		const { user } = await createGuestViaAction('203.0.113.5', 'Africa/Lagos');
		expect(user).toMatchObject({ isGuest: true, timeZone: 'Africa/Lagos' });
		expect((await db.select().from(tasks).where(eq(tasks.userId, user.id))).length).toBe(8);
	});

	it('falls back to UTC for an invalid tz cookie', async () => {
		const { user } = await createGuestViaAction('203.0.113.6', 'Mars/Olympus');
		expect(user.timeZone).toBe('UTC');
	});

	it('returns 404 when guest mode is off, and creates nothing', async () => {
		mode.on = false;
		const r = await caught(() => loginRoute.actions.guest(event('/login', { form: {} })));
		expect(isHttpError(r.thrown) && r.thrown.status).toBe(404);
		expect(await guestCount()).toBe(0);
	});

	it('explains the per-IP limit and the global cap', async () => {
		for (let i = 0; i < 10; i++) await createGuestViaAction('198.51.100.1');
		const limited: unknown = await loginRoute.actions.guest(
			event('/login', { form: {}, ip: '198.51.100.1' })
		);
		expect(isActionFailure(limited) && [limited.status, limited.data]).toEqual([
			429,
			{ guestError: 'Too many guest accounts from your network. Try again in an hour.' }
		]);

		stores.guests = createGuestStore(db, { limits: { perIpPerHour: 10, total: 10 } });
		const full: unknown = await loginRoute.actions.guest(
			event('/login', { form: {}, ip: '198.51.100.2' })
		);
		expect(isActionFailure(full) && [full.status, full.data]).toEqual([
			503,
			{ guestError: 'Guest mode is full right now, try again later.' }
		]);
	});
});

describe('guest mode off', () => {
	it('start-up cleanup deletes every guest and no real user', async () => {
		await createGuestViaAction('203.0.113.7');
		await createGuestViaAction('203.0.113.8');
		mode.on = false;
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});
		await hooks.init();
		expect(await guestCount()).toBe(0);
		expect(await realRows()).toEqual(REAL_ROWS);
		expect(log).toHaveBeenCalledWith('[guest-mode] off: deleted 2 guest account(s) at start-up');
		log.mockRestore();
	});

	it('start-up cleanup does nothing while guest mode is on', async () => {
		await createGuestViaAction();
		await hooks.init();
		expect(await guestCount()).toBe(1);
	});

	it('an existing guest session is deleted, its cookie cleared, and the request sent to /login', async () => {
		const { token, user } = await createGuestViaAction();
		const other = await createGuestViaAction('203.0.113.9');
		mode.on = false;
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const cookies = jar({ [SESSION_COOKIE]: token });
		const r = await caught(() =>
			hooks.handle({
				event: event('/upcoming', { cookies }),
				resolve: async () => new Response('ok')
			})
		);
		expect(isRedirect(r.thrown) && r.thrown.location).toBe('/login');
		expect(cookies.values.has(SESSION_COOKIE)).toBe(false);
		expect((await db.select().from(users).where(eq(users.id, user.id))).length).toBe(0);
		// only that guest; the other goes at start-up or at its own next request
		expect((await db.select().from(users).where(eq(users.id, other.user.id))).length).toBe(1);
		vi.restoreAllMocks();
	});

	it('the same on /login itself: deleted and shown the login page, no redirect loop', async () => {
		const { token } = await createGuestViaAction();
		mode.on = false;
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const e = event('/login', { cookies: jar({ [SESSION_COOKIE]: token }) });
		const res = await hooks.handle({ event: e, resolve: async () => new Response('login page') });
		expect(await (res as Response).text()).toBe('login page');
		expect(e.locals.user).toBeNull();
		expect(await guestCount()).toBe(0);
		vi.restoreAllMocks();
	});

	it('login housekeeping deletes all guests, and real users still log in', async () => {
		await createGuestViaAction();
		mode.on = false;
		const r = await caught(() =>
			loginRoute.actions.login(
				event('/login', { form: { email: 'real@example.com', password: 'a-real-password-1' } })
			)
		);
		expect(isRedirect(r.thrown) && r.thrown.location).toBe('/');
		expect(await guestCount()).toBe(0);
	});
});

describe('guest sessions while guest mode is on', () => {
	it('the hook signs the guest in as a guest', async () => {
		const { token } = await createGuestViaAction();
		const e = event('/', { cookies: jar({ [SESSION_COOKIE]: token }) });
		await hooks.handle({ event: e, resolve: async () => new Response('ok') });
		expect(e.locals.user).toMatchObject({ isGuest: true });
	});

	it('a guest cannot log in through the password form', async () => {
		const { user } = await createGuestViaAction();
		const r: unknown = await loginRoute.actions.login(
			event('/login', { form: { email: user.email, password: 'anything-at-all' } })
		);
		expect(isActionFailure(r) && r.data).toEqual({
			email: user.email,
			message: 'Invalid email or password.'
		});
	});
});

describe('per-guest caps (real users are not capped)', () => {
	async function fill(userId: string, n: number) {
		await db
			.insert(tasks)
			.values(
				Array.from({ length: n }, (_, i) => ({ userId, title: `bulk ${i}`, order: `a${i}` }))
			);
	}

	it('a guest at 200 tasks (deleted ones included) gets a friendly error', async () => {
		const { user } = await createGuestViaAction();
		await fill(user.id, 200 - 8 - 1); // 8 sample tasks
		const ok = await taskActions.addTask(event('/', { user, form: { title: 'one more' } }));
		expect(isActionFailure(ok)).toBe(false);
		// soft-deleting doesn't free a slot
		await db.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.userId, user.id));
		const capped = await taskActions.addTask(event('/', { user, form: { title: 'too many' } }));
		expect(isActionFailure(capped) && [capped.status, capped.data]).toEqual([
			403,
			{ addError: 'Guest accounts can hold up to 200 tasks, including completed and deleted ones.' }
		]);
	});

	it('a real user with 200+ tasks can keep adding', async () => {
		await fill(realId, 250);
		const realUser = {
			id: realId,
			email: 'real@example.com',
			timeZone: 'UTC',
			isGuest: false,
			guestExpiresAt: null
		};
		const r = await taskActions.addTask(
			event('/', { user: realUser, form: { title: 'still fine' } })
		);
		expect(isActionFailure(r)).toBe(false);
	});

	it('a guest at 20 lists gets a friendly error; a real user does not', async () => {
		const { user } = await createGuestViaAction();
		const listStore = createListStore(db);
		for (let i = 0; i < 18; i++) await listStore.create(user.id, `L${i}`); // + Home and Work
		const capped: unknown = await listActions.createList(
			event('/', { user, form: { name: 'one too many' } })
		);
		expect(isActionFailure(capped) && [capped.status, capped.data]).toEqual([
			403,
			{ listError: 'Guest accounts can have up to 20 lists, including deleted ones.' }
		]);

		for (let i = 0; i < 25; i++) await listStore.create(realId, `R${i}`);
		const realUser = {
			id: realId,
			email: 'real@example.com',
			timeZone: 'UTC',
			isGuest: false,
			guestExpiresAt: null
		};
		const r = await caught(() =>
			listActions.createList(event('/', { user: realUser, form: { name: 'fine' } }))
		);
		expect(isRedirect(r.thrown)).toBe(true); // created, then redirected to the new list
	});
});

describe('leaving as a guest', () => {
	it('shows a confirmation to guests and sends everyone else home', async () => {
		const { user } = await createGuestViaAction();
		expect(logoutRoute.load(event('/logout', { user }) as never)).toEqual({});
		const r = await caught(() =>
			logoutRoute.load(event('/logout', { user: { id: realId, isGuest: false } }) as never)
		);
		expect(isRedirect(r.thrown) && r.thrown.location).toBe('/');
	});

	it('leave-and-delete removes that guest and everything it owns, and nothing else', async () => {
		const leaving = await createGuestViaAction('203.0.113.20');
		const staying = await createGuestViaAction('203.0.113.21');
		const stayingTasks = (await db.select().from(tasks).where(eq(tasks.userId, staying.user.id)))
			.length;

		const cookies = jar({ [SESSION_COOKIE]: leaving.token });
		const r = await caught(() =>
			logoutRoute.actions.default(event('/logout', { cookies, user: leaving.user, form: {} }))
		);
		expect(isRedirect(r.thrown) && r.thrown.location).toBe('/login');
		expect(cookies.values.has(SESSION_COOKIE)).toBe(false);
		for (const table of [lists, tasks, sessions] as const) {
			expect((await db.select().from(table).where(eq(table.userId, leaving.user.id))).length).toBe(
				0
			);
		}
		expect((await db.select().from(users).where(eq(users.id, leaving.user.id))).length).toBe(0);
		expect((await db.select().from(tasks).where(eq(tasks.userId, staying.user.id))).length).toBe(
			stayingTasks
		);
		expect(await realRows()).toEqual(REAL_ROWS);
	});

	it('a real user logging out only ends the session', async () => {
		const auth = createAuthStore(db);
		const { token } = await auth.createSession(realId);
		const cookies = jar({ [SESSION_COOKIE]: token });
		await caught(() =>
			logoutRoute.actions.default(
				event('/logout', { cookies, user: { id: realId, isGuest: false }, form: {} })
			)
		);
		expect(await auth.validateSession(token)).toBeNull();
		expect(await realRows()).toEqual(REAL_ROWS);
	});
});
