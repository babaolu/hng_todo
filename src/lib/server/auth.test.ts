import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuthStore, hashToken, LOCKOUT_WINDOW, SESSION_TTL } from './auth';
import { loginAttempts, sessions } from './db/schema';
import type { Db } from './db/types';
import { hashPassword } from './password';
import { createTestDb, createUser } from './test/db';

let db: Db;
let close: () => Promise<void>;
let userId: string;
let now: Date;
const auth = () => createAuthStore(db, () => now);
const advance = (ms: number) => (now = new Date(now.getTime() + ms));

const EMAIL = 'me@example.com';
const PASSWORD = 'correct horse battery staple';

beforeAll(async () => {
	({ db, close } = await createTestDb());
	userId = await createUser(db, EMAIL, await hashPassword(PASSWORD));
});
afterAll(() => close());
beforeEach(async () => {
	now = new Date('2026-01-01T12:00:00Z');
	await db.delete(loginAttempts);
	await db.delete(sessions);
});

describe('sessions', () => {
	it('stores only a SHA-256 hash of the token', async () => {
		const { token } = await auth().createSession(userId);
		const rows = await db.select().from(sessions);
		expect(rows).toHaveLength(1);
		expect(rows[0].tokenHash).toBe(hashToken(token));
		expect(rows[0].tokenHash).not.toContain(token);
	});

	it('resolves a valid token to its user', async () => {
		const { token } = await auth().createSession(userId);
		const session = await auth().validateSession(token);
		expect(session?.user).toEqual({ id: userId, email: EMAIL });
		expect(session?.renewed).toBe(false);
	});

	it('rejects an unknown token', async () => {
		expect(await auth().validateSession('nope')).toBeNull();
	});

	it('rejects and deletes an expired session', async () => {
		const { token } = await auth().createSession(userId);
		advance(SESSION_TTL + 1);
		expect(await auth().validateSession(token)).toBeNull();
		expect(await db.select().from(sessions)).toEqual([]);
	});

	it('slides the expiry forward once past the halfway point', async () => {
		const { token, expiresAt } = await auth().createSession(userId);
		advance(SESSION_TTL / 2 + 1000);
		const session = await auth().validateSession(token);
		expect(session?.renewed).toBe(true);
		expect(session!.expiresAt.getTime()).toBe(now.getTime() + SESSION_TTL);
		expect(session!.expiresAt.getTime()).toBeGreaterThan(expiresAt.getTime());
		const [row] = await db
			.select()
			.from(sessions)
			.where(eq(sessions.tokenHash, hashToken(token)));
		expect(row.expiresAt.getTime()).toBe(session!.expiresAt.getTime());
	});

	it('logout invalidates the session', async () => {
		const { token } = await auth().createSession(userId);
		await auth().invalidateSession(token);
		expect(await auth().validateSession(token)).toBeNull();
	});
});

describe('login', () => {
	it('accepts the right password, case-insensitive email', async () => {
		const result = await auth().login('  ME@Example.com ', PASSWORD);
		expect(result).toEqual({ ok: true, user: { id: userId, email: EMAIL } });
	});

	it('gives the same answer for a wrong password and an unknown email', async () => {
		expect(await auth().login(EMAIL, 'wrong')).toEqual({ ok: false, reason: 'invalid' });
		expect(await auth().login('nobody@example.com', PASSWORD)).toEqual({
			ok: false,
			reason: 'invalid'
		});
	});
});

describe('lockout', () => {
	async function failTimes(n: number, email = EMAIL) {
		for (let i = 0; i < n; i++) {
			expect(await auth().login(email, 'wrong')).toEqual({ ok: false, reason: 'invalid' });
			advance(1000);
		}
	}

	it('locks after 5 failures, even for the right password', async () => {
		await failTimes(5);
		expect(await auth().login(EMAIL, PASSWORD)).toEqual({ ok: false, reason: 'locked' });
		expect(await auth().login(EMAIL, 'wrong')).toEqual({ ok: false, reason: 'locked' });
	});

	it('does not lock after 4 failures', async () => {
		await failTimes(4);
		expect((await auth().login(EMAIL, PASSWORD)).ok).toBe(true);
	});

	it('clears after the window', async () => {
		await failTimes(5);
		advance(LOCKOUT_WINDOW - 60_000);
		expect(await auth().login(EMAIL, PASSWORD)).toEqual({ ok: false, reason: 'locked' });
		advance(60_000);
		expect((await auth().login(EMAIL, PASSWORD)).ok).toBe(true);
	});

	it('only counts failures that fall within one window', async () => {
		await failTimes(3);
		advance(LOCKOUT_WINDOW);
		await failTimes(2);
		expect((await auth().login(EMAIL, PASSWORD)).ok).toBe(true);
	});

	it('a successful login resets the count', async () => {
		await failTimes(4);
		expect((await auth().login(EMAIL, PASSWORD)).ok).toBe(true);
		await failTimes(4);
		expect((await auth().login(EMAIL, PASSWORD)).ok).toBe(true);
	});

	it('locks unknown emails too, so lockout does not reveal which emails exist', async () => {
		await failTimes(5, 'nobody@example.com');
		expect(await auth().login('nobody@example.com', 'x')).toEqual({ ok: false, reason: 'locked' });
		// and it is per-email: the real account is unaffected
		expect((await auth().login(EMAIL, PASSWORD)).ok).toBe(true);
	});
});
