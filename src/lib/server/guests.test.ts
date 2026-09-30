import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays, todayIn } from '$lib/dates';
import { createAuthStore, GUEST_TTL } from './auth';
import { lists, loginAttempts, sessions, tasks, users } from './db/schema';
import type { Db } from './db/types';
import { createGuestStore, GUEST_PASSWORD_HASH } from './guests';
import { createListStore } from './lists';
import { hashPassword } from './password';
import { createTaskStore } from './tasks';
import { createTestDb, createUser } from './test/db';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let db: Db;
let close: () => Promise<void>;
let now: Date;
const clock = () => now;
const guests = (limits = { perIpPerHour: 10, total: 500 }) =>
	createGuestStore(db, { clock, limits });
const taskStore = () => createTaskStore(db);
const listStore = () => createListStore(db);

beforeAll(async () => {
	({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
	now = new Date('2026-10-01T10:00:00Z');
	await db.delete(users); // cascades to everything
	await db.delete(loginAttempts);
});

/** A real user created 30 days ago, with a list, tasks in it and a session. */
async function realUserWithData() {
	const id = await createUser(db, 'real@example.com', await hashPassword('a-real-password-1'));
	await db
		.update(users)
		.set({ createdAt: new Date(now.getTime() - 30 * DAY) })
		.where(eq(users.id, id));
	const list = await listStore().create(id, 'Real list');
	await taskStore().create(id, { title: 'real task in list', listId: list.id });
	await taskStore().create(id, { title: 'real inbox task', listId: null });
	await createAuthStore(db, clock).createSession(id);
	return id;
}

async function rowsFor(userId: string) {
	return {
		user: (await db.select().from(users).where(eq(users.id, userId))).length,
		sessions: (await db.select().from(sessions).where(eq(sessions.userId, userId))).length,
		lists: (await db.select().from(lists).where(eq(lists.userId, userId))).length,
		tasks: (await db.select().from(tasks).where(eq(tasks.userId, userId))).length
	};
}

async function makeGuest(ip = '203.0.113.1', zone = 'UTC') {
	const result = await guests().create(ip, zone);
	if (!result.ok) throw new Error(result.reason);
	return result;
}

describe('creating a guest', () => {
	it('creates a guest user with a session that ends exactly 7 days after creation', async () => {
		const g = await makeGuest();
		const [row] = await db.select().from(users).where(eq(users.id, g.userId));
		expect(row).toMatchObject({ isGuest: true, guestIp: '203.0.113.1', timeZone: 'UTC' });
		expect(row.email).toMatch(/^guest-[0-9a-f-]{36}@guest\.invalid$/);
		expect(row.passwordHash).toBe(GUEST_PASSWORD_HASH);
		expect(g.expiresAt.getTime()).toBe(now.getTime() + GUEST_TTL);
		const session = await createAuthStore(db, clock).validateSession(g.token);
		expect(session?.user).toMatchObject({ isGuest: true, guestExpiresAt: g.expiresAt });
	});

	it('seeds sample data on the right days (UTC)', async () => {
		const g = await makeGuest('203.0.113.1', 'UTC');
		const today = todayIn('UTC', now); // 2026-10-01
		const all = await db.select().from(tasks).where(eq(tasks.userId, g.userId));
		const by = (title: string) => all.find((t) => t.title === title)!;
		expect(all).toHaveLength(9);
		expect(
			(await db.select().from(lists).where(eq(lists.userId, g.userId))).map((l) => l.name).sort()
		).toEqual(['Home', 'Work']);
		expect(by('Return library books').dueDate).toBe(addDays(today, -2)); // overdue
		expect(by('Plan the week').dueDate).toBe(today);
		expect(by('Read me: how quick-add works')).toMatchObject({ dueDate: null, pinnedToday: true });
		expect(by('Read me: how quick-add works').notes).toMatch(/next tue.*15\/10|15\/10/s);
		expect(by('Read me: how quick-add works').notes).toContain('#home');
		expect(by('Dentist appointment').dueDate).toBe(addDays(today, 1));
		expect(by('Team retro').dueDate).toBe(addDays(today, 7));
		expect(by('Ideas for the weekend')).toMatchObject({ dueDate: null, listId: null });
		expect(by('Set up a guest account').completedAt).not.toBeNull();
		expect(by('Water the plants')).toMatchObject({
			dueDate: today,
			repeatRule: { freq: 'daily', interval: 3, anchor: today }
		});
		expect(by('Read me: how quick-add works').notes).toContain('every mon and thu');
		const store = taskStore();
		expect((await store.listToday(g.userId, today)).map((t) => t.title)).toEqual(
			expect.arrayContaining([
				'Return library books',
				'Plan the week',
				'Read me: how quick-add works'
			])
		);
		expect((await store.listCompleted(g.userId)).map((t) => t.title)).toEqual([
			'Set up a guest account'
		]);
	});

	it("seeds relative to the guest's own day: Lagos at 00:30 is already tomorrow in UTC terms", async () => {
		now = new Date('2026-10-01T23:30:00Z'); // 00:30 on 2 Oct in Lagos
		const g = await makeGuest('203.0.113.2', 'Africa/Lagos');
		const plan = (
			await db
				.select()
				.from(tasks)
				.where(and(eq(tasks.userId, g.userId), eq(tasks.title, 'Plan the week')))
		)[0];
		expect(plan.dueDate).toBe('2026-10-02');
		const utc = await makeGuest('203.0.113.3', 'UTC');
		const planUtc = (
			await db
				.select()
				.from(tasks)
				.where(and(eq(tasks.userId, utc.userId), eq(tasks.title, 'Plan the week')))
		)[0];
		expect(planUtc.dueDate).toBe('2026-10-01');
	});
});

describe('guest lifetime is fixed at 7 days', () => {
	it('a guest 6 days 23 hours old with recent activity survives cleanup; one exactly 7 days old is deleted', async () => {
		const start = now.getTime();
		const old = await makeGuest('203.0.113.11');
		now = new Date(start + HOUR);
		const young = await makeGuest('203.0.113.10');
		// Both were active a minute before the check.
		now = new Date(start + 7 * DAY - 60_000);
		await taskStore().create(young.userId, { title: 'recent', listId: null });
		await taskStore().create(old.userId, { title: 'recent', listId: null });
		await createAuthStore(db, clock).validateSession(young.token);
		await createAuthStore(db, clock).validateSession(old.token);
		now = new Date(start + 7 * DAY); // old: exactly 7 days; young: 6 days 23 hours

		expect(await guests().deleteExpired()).toBe(1);
		expect((await rowsFor(young.userId)).user).toBe(1);
		expect(await rowsFor(old.userId)).toEqual({ user: 0, sessions: 0, lists: 0, tasks: 0 });
	});

	it('a guest session is never extended, and stops working at 7 days however recently used', async () => {
		const g = await makeGuest();
		const auth = createAuthStore(db, clock);
		for (let day = 1; day <= 6; day++) {
			now = new Date(now.getTime() + DAY);
			const s = await auth.validateSession(g.token);
			expect(s?.renewed).toBe(false);
			expect(s?.expiresAt.getTime()).toBe(g.expiresAt.getTime());
		}
		now = new Date(g.expiresAt.getTime());
		expect(await auth.validateSession(g.token)).toBeNull();
	});
});

describe('cleanup only ever deletes guests', () => {
	it('deleteExpired (guest mode on) leaves a 30-day-old real user and all its data alone', async () => {
		const real = await realUserWithData();
		const before = await rowsFor(real);
		const g = await makeGuest();
		now = new Date(now.getTime() + 8 * DAY);
		expect(await guests().housekeep(true)).toBe(1);
		expect(await rowsFor(real)).toEqual(before);
		expect((await rowsFor(g.userId)).user).toBe(0);
	});

	it('deleteAll (guest mode off) deletes every guest and no real user', async () => {
		const real = await realUserWithData();
		const before = await rowsFor(real);
		const g1 = await makeGuest('203.0.113.20');
		const g2 = await makeGuest('203.0.113.21');
		expect(await guests().housekeep(false)).toBe(2);
		expect(await rowsFor(real)).toEqual(before);
		for (const g of [g1, g2]) {
			expect(await rowsFor(g.userId)).toEqual({ user: 0, sessions: 0, lists: 0, tasks: 0 });
		}
		expect(await db.select().from(users).where(eq(users.isGuest, true))).toEqual([]);
	});

	it('remove() deletes one guest and everything it owns, and refuses real users and other guests', async () => {
		const real = await realUserWithData();
		const before = await rowsFor(real);
		const g1 = await makeGuest('203.0.113.30');
		const g2 = await makeGuest('203.0.113.31');
		const g2Before = await rowsFor(g2.userId);

		expect(await guests().remove(real)).toBe(false);
		expect(await rowsFor(real)).toEqual(before);

		expect(await guests().remove(g1.userId)).toBe(true);
		expect(await rowsFor(g1.userId)).toEqual({ user: 0, sessions: 0, lists: 0, tasks: 0 });
		expect(await rowsFor(g2.userId)).toEqual(g2Before);
	});

	it('deleting a user cascades through tasks that reference its lists', async () => {
		// Sample data puts tasks in the guest's lists (tasks.list_id has no cascade of its own).
		const g = await makeGuest();
		const inLists = await db.select().from(tasks).where(eq(tasks.userId, g.userId));
		expect(inLists.some((t) => t.listId !== null)).toBe(true);
		// Including a soft-deleted list that still has tasks pointing at it.
		const [home] = await db
			.select()
			.from(lists)
			.where(and(eq(lists.userId, g.userId), eq(lists.name, 'Home')));
		await db.update(lists).set({ deletedAt: now }).where(eq(lists.id, home.id));
		expect(await guests().remove(g.userId)).toBe(true);
		expect(await rowsFor(g.userId)).toEqual({ user: 0, sessions: 0, lists: 0, tasks: 0 });
	});
});

describe('abuse limits', () => {
	it('allows 10 guests per IP per hour, then refuses that IP only', async () => {
		for (let i = 0; i < 10; i++) {
			expect((await guests().create('198.51.100.7', 'UTC')).ok).toBe(true);
			now = new Date(now.getTime() + 60_000);
		}
		expect(await guests().create('198.51.100.7', 'UTC')).toEqual({
			ok: false,
			reason: 'rate-limited'
		});
		expect((await guests().create('198.51.100.8', 'UTC')).ok).toBe(true);
		// An hour after the first one, a slot frees up.
		now = new Date(now.getTime() + 51 * 60_000);
		expect((await guests().create('198.51.100.7', 'UTC')).ok).toBe(true);
	});

	it('refuses new guests once the global cap is reached, and never counts real users', async () => {
		await realUserWithData();
		const store = guests({ perIpPerHour: 100, total: 3 });
		for (let i = 0; i < 3; i++)
			expect((await store.create(`198.51.100.${i}`, 'UTC')).ok).toBe(true);
		expect(await store.create('198.51.100.99', 'UTC')).toEqual({ ok: false, reason: 'full' });
		// Expired guests are cleared first, freeing room.
		now = new Date(now.getTime() + 7 * DAY);
		expect((await store.create('198.51.100.99', 'UTC')).ok).toBe(true);
	});
});

describe('guests cannot log in with a password', () => {
	it('rejects a guest email like an unknown one, even if the stored hash would match', async () => {
		const g = await makeGuest();
		const [row] = await db.select().from(users).where(eq(users.id, g.userId));
		const auth = createAuthStore(db, clock);
		expect(await auth.login(row.email, 'anything', '203.0.113.1')).toEqual({
			ok: false,
			reason: 'invalid'
		});
		// Even with a real argon2 hash of that password in place, the guest is refused.
		await db
			.update(users)
			.set({ passwordHash: await hashPassword('guessable-password') })
			.where(eq(users.id, g.userId));
		expect(await auth.login(row.email, 'guessable-password', '203.0.113.1')).toEqual({
			ok: false,
			reason: 'invalid'
		});
		// ...and the attempt counts toward lockout like any other failure.
		expect(
			(await db.select().from(loginAttempts).where(eq(loginAttempts.email, row.email))).length
		).toBe(2);
	});
});
