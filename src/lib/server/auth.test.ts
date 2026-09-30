import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	createAuthStore,
	hashToken,
	LOCKOUT_WINDOW,
	MAX_FAILED_LOGINS_PER_IP,
	SESSION_TTL
} from './auth';
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

const ME = '203.0.113.10';
const ATTACKER = '198.51.100.66';

describe('login', () => {
	it('accepts the right password, case-insensitive email', async () => {
		const result = await auth().login('  ME@Example.com ', PASSWORD, ME);
		expect(result).toEqual({ ok: true, user: { id: userId, email: EMAIL } });
	});

	it('gives the same answer for a wrong password and an unknown email', async () => {
		expect(await auth().login(EMAIL, 'wrong', ME)).toEqual({ ok: false, reason: 'invalid' });
		expect(await auth().login('nobody@example.com', PASSWORD, ME)).toEqual({
			ok: false,
			reason: 'invalid'
		});
	});

	it('records the IP of failed attempts', async () => {
		await auth().login(EMAIL, 'wrong', ME);
		const rows = await db.select().from(loginAttempts);
		expect(rows.map((r) => [r.email, r.ip])).toEqual([[EMAIL, ME]]);
	});
});

describe('lockout per (email, IP)', () => {
	async function failTimes(n: number, ip: string, email = EMAIL) {
		for (let i = 0; i < n; i++) {
			expect(await auth().login(email, 'wrong', ip)).toEqual({ ok: false, reason: 'invalid' });
			advance(1000);
		}
	}

	it('locks after 5 failures from one IP, even for the right password', async () => {
		await failTimes(5, ME);
		expect(await auth().login(EMAIL, PASSWORD, ME)).toEqual({ ok: false, reason: 'locked' });
		expect(await auth().login(EMAIL, 'wrong', ME)).toEqual({ ok: false, reason: 'locked' });
	});

	it('an attacker locking my email from their IP does not lock me out from mine', async () => {
		await failTimes(5, ATTACKER);
		expect(await auth().login(EMAIL, PASSWORD, ATTACKER)).toEqual({ ok: false, reason: 'locked' });
		expect((await auth().login(EMAIL, PASSWORD, ME)).ok).toBe(true);
		// and my successful login doesn't unlock the attacker's IP
		expect(await auth().login(EMAIL, PASSWORD, ATTACKER)).toEqual({ ok: false, reason: 'locked' });
	});

	it('does not lock after 4 failures', async () => {
		await failTimes(4, ME);
		expect((await auth().login(EMAIL, PASSWORD, ME)).ok).toBe(true);
	});

	it('clears after the window', async () => {
		await failTimes(5, ME);
		advance(LOCKOUT_WINDOW - 60_000);
		expect(await auth().login(EMAIL, PASSWORD, ME)).toEqual({ ok: false, reason: 'locked' });
		advance(60_000);
		expect((await auth().login(EMAIL, PASSWORD, ME)).ok).toBe(true);
	});

	it('only counts failures that fall within one window', async () => {
		await failTimes(3, ME);
		advance(LOCKOUT_WINDOW);
		await failTimes(2, ME);
		expect((await auth().login(EMAIL, PASSWORD, ME)).ok).toBe(true);
	});

	it('records nothing while locked', async () => {
		await failTimes(5, ME);
		const before = (await db.select().from(loginAttempts)).length;
		await auth().login(EMAIL, 'wrong', ME);
		await auth().login(EMAIL, PASSWORD, ME);
		expect((await db.select().from(loginAttempts)).length).toBe(before);
	});

	it('a successful login clears only that (email, IP) pair', async () => {
		await failTimes(4, ME);
		await failTimes(4, ATTACKER);
		expect((await auth().login(EMAIL, PASSWORD, ME)).ok).toBe(true);
		const left = await db.select().from(loginAttempts);
		expect(left).toHaveLength(4);
		expect(left.every((r) => r.ip === ATTACKER)).toBe(true);
	});

	it('locks unknown emails too, so lockout does not reveal which emails exist', async () => {
		await failTimes(5, ME, 'nobody@example.com');
		expect(await auth().login('nobody@example.com', 'x', ME)).toEqual({
			ok: false,
			reason: 'locked'
		});
		// and it is per email: the real account is unaffected from the same IP
		expect((await auth().login(EMAIL, PASSWORD, ME)).ok).toBe(true);
	});
});

describe('lockout per IP (password spraying)', () => {
	/** n failures from one IP, 4 per email so no single (email, IP) pair locks. */
	async function spray(n: number, ip: string) {
		for (let i = 0; i < n; i++) {
			const email = `victim${Math.floor(i / 4)}@example.com`;
			expect(await auth().login(email, 'wrong', ip)).toEqual({ ok: false, reason: 'invalid' });
			advance(1000);
		}
	}

	it('blocks an IP after 20 failures across different emails', async () => {
		await spray(MAX_FAILED_LOGINS_PER_IP, ATTACKER);
		expect(await auth().login('fresh@example.com', 'wrong', ATTACKER)).toEqual({
			ok: false,
			reason: 'locked'
		});
		// even with the right password for another account
		expect(await auth().login(EMAIL, PASSWORD, ATTACKER)).toEqual({ ok: false, reason: 'locked' });
		// other IPs are unaffected
		expect((await auth().login(EMAIL, PASSWORD, ME)).ok).toBe(true);
	});

	it('does not block at 19', async () => {
		await spray(MAX_FAILED_LOGINS_PER_IP - 1, ATTACKER);
		expect(await auth().login('fresh@example.com', 'wrong', ATTACKER)).toEqual({
			ok: false,
			reason: 'invalid'
		});
	});

	it('clears after the window', async () => {
		await spray(MAX_FAILED_LOGINS_PER_IP, ATTACKER);
		advance(LOCKOUT_WINDOW - 60_000);
		expect(await auth().login(EMAIL, PASSWORD, ATTACKER)).toEqual({ ok: false, reason: 'locked' });
		advance(60_000);
		expect((await auth().login(EMAIL, PASSWORD, ATTACKER)).ok).toBe(true);
	});
});

describe('attempt cleanup', () => {
	it('any failed attempt deletes rows older than 24 hours, for every email', async () => {
		const old = new Date(now.getTime() - 25 * 60 * 60 * 1000);
		const recent = new Date(now.getTime() - 23 * 60 * 60 * 1000);
		await db.insert(loginAttempts).values([
			{ email: 'other@example.com', ip: ATTACKER, attemptedAt: old },
			{ email: 'legacy@example.com', ip: null, attemptedAt: old },
			{ email: 'other@example.com', ip: ATTACKER, attemptedAt: recent }
		]);
		await auth().login('someone-else@example.com', 'wrong', ME);
		const rows = await db.select().from(loginAttempts);
		expect(rows.map((r) => r.email).sort()).toEqual([
			'other@example.com',
			'someone-else@example.com'
		]);
		expect(rows.every((r) => r.attemptedAt.getTime() >= recent.getTime())).toBe(true);
	});
});
