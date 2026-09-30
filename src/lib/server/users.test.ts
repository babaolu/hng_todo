import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthStore } from './auth';
import { sessions, users } from './db/schema';
import type { Db } from './db/types';
import { createTestDb } from './test/db';
import { createAccount, resetPassword } from './users';

let db: Db;
let close: () => Promise<void>;
const IP = '203.0.113.1';
const hashOf = async (email: string) =>
	(await db.select().from(users).where(eq(users.email, email)))[0]?.passwordHash;

beforeAll(async () => {
	({ db, close } = await createTestDb());
});
afterAll(() => close());

describe('createAccount (user:add)', () => {
	it('creates a new account that can log in', async () => {
		expect(await createAccount(db, ' New@Example.com ', 'a-long-password-1')).toEqual({
			ok: true,
			email: 'new@example.com'
		});
		const login = await createAuthStore(db).login('new@example.com', 'a-long-password-1', IP);
		expect(login.ok).toBe(true);
	});

	it('refuses an existing email and changes nothing', async () => {
		const before = await hashOf('new@example.com');
		expect((await createAccount(db, 'NEW@example.com', 'another-password-2')).ok).toBe(false);
		expect(await hashOf('new@example.com')).toBe(before);
	});

	it('enforces the 12-character minimum and a plausible email', async () => {
		expect((await createAccount(db, 'short@example.com', 'elevenchars')).ok).toBe(false);
		expect((await createAccount(db, 'not-an-email', 'a-long-password-1')).ok).toBe(false);
		expect(await hashOf('short@example.com')).toBeUndefined();
	});
});

describe('resetPassword (user:add --reset)', () => {
	it('fails for an email that does not exist, creating nothing', async () => {
		expect((await resetPassword(db, 'ghost@example.com', 'a-long-password-1')).ok).toBe(false);
		expect(await hashOf('ghost@example.com')).toBeUndefined();
	});

	it('changes the password and signs out that user only', async () => {
		await createAccount(db, 'other@example.com', 'other-password-1');
		const auth = createAuthStore(db);
		const [me] = await db.select().from(users).where(eq(users.email, 'new@example.com'));
		const [other] = await db.select().from(users).where(eq(users.email, 'other@example.com'));
		await auth.createSession(me.id);
		const { token: otherToken } = await auth.createSession(other.id);

		expect(await resetPassword(db, 'new@example.com', 'brand-new-password-3')).toEqual({
			ok: true,
			email: 'new@example.com'
		});
		expect(await db.select().from(sessions).where(eq(sessions.userId, me.id))).toEqual([]);
		expect(await auth.validateSession(otherToken)).not.toBeNull();
		expect((await auth.login('new@example.com', 'a-long-password-1', IP)).ok).toBe(false);
		expect((await auth.login('new@example.com', 'brand-new-password-3', IP)).ok).toBe(true);
	});
});
