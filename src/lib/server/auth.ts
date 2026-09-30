import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, lt, type SQL } from 'drizzle-orm';
import { loginAttempts, sessions, users } from './db/schema';
import type { Db } from './db/types';
import { verifyDummy, verifyPassword } from './password';

const DAY = 24 * 60 * 60 * 1000;
export const SESSION_TTL = 30 * DAY;
/** Sliding renewal: extend once less than this much lifetime remains. */
const RENEW_WITHIN = 15 * DAY;

/** Failures from one IP for one email before that email is locked for that IP. */
export const MAX_FAILED_LOGINS = 5;
/** Failures from one IP across all emails before that IP is blocked (password spraying). */
export const MAX_FAILED_LOGINS_PER_IP = 20;
export const LOCKOUT_WINDOW = 15 * 60 * 1000;
/** Failed attempts older than this are deleted. */
const ATTEMPT_RETENTION = DAY;

export type SessionUser = { id: string; email: string };
export type LoginResult =
	{ ok: true; user: SessionUser } | { ok: false; reason: 'invalid' | 'locked' };

export type AuthStore = ReturnType<typeof createAuthStore>;

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function createAuthStore(db: Db, clock: () => Date = () => new Date()) {
	/**
	 * True when the latest `max` failures matching `where` all fall inside one
	 * window and the newest is less than a window ago. Attempts made while
	 * locked are not recorded, so a lock lifts LOCKOUT_WINDOW after the failure
	 * that triggered it.
	 */
	async function tooMany(where: SQL | undefined, max: number): Promise<boolean> {
		const recent = await db
			.select({ at: loginAttempts.attemptedAt })
			.from(loginAttempts)
			.where(where)
			.orderBy(desc(loginAttempts.attemptedAt))
			.limit(max);
		if (recent.length < max) return false;
		const newest = recent[0].at.getTime();
		const oldest = recent[recent.length - 1].at.getTime();
		return newest - oldest <= LOCKOUT_WINDOW && clock().getTime() - newest < LOCKOUT_WINDOW;
	}

	const fromIp = (ip: string) => eq(loginAttempts.ip, ip);
	const pair = (email: string, ip: string) => and(eq(loginAttempts.email, email), fromIp(ip));

	return {
		/**
		 * Lockout is per (email, IP), so someone else failing against your email
		 * from their address can't lock you out of yours; each IP is also capped
		 * across all emails. Never reveals whether an email exists: unknown emails
		 * cost the same time and count the same way.
		 */
		async login(rawEmail: string, password: string, ip: string): Promise<LoginResult> {
			const email = normalizeEmail(rawEmail);
			const [ipBlocked, pairLocked] = await Promise.all([
				tooMany(fromIp(ip), MAX_FAILED_LOGINS_PER_IP),
				tooMany(pair(email, ip), MAX_FAILED_LOGINS)
			]);
			if (ipBlocked || pairLocked) return { ok: false, reason: 'locked' };

			const [user] = await db.select().from(users).where(eq(users.email, email));
			const valid = user
				? await verifyPassword(user.passwordHash, password)
				: (await verifyDummy(password), false);

			if (!valid) {
				const now = clock();
				await db.insert(loginAttempts).values({ email, ip, attemptedAt: now });
				// Housekeeping for every email, not just this one (uses the attempted_at index).
				await db
					.delete(loginAttempts)
					.where(lt(loginAttempts.attemptedAt, new Date(now.getTime() - ATTEMPT_RETENTION)));
				return { ok: false, reason: 'invalid' };
			}

			await db.delete(loginAttempts).where(pair(email, ip));
			return { ok: true, user: { id: user.id, email: user.email } };
		},

		/** Returns the raw token for the cookie; only its SHA-256 hash is stored. */
		async createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
			const token = randomBytes(32).toString('base64url');
			const expiresAt = new Date(clock().getTime() + SESSION_TTL);
			await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
			return { token, expiresAt };
		},

		async validateSession(
			token: string
		): Promise<{ user: SessionUser; expiresAt: Date; renewed: boolean } | null> {
			const tokenHash = hashToken(token);
			const [row] = await db
				.select({
					id: sessions.id,
					expiresAt: sessions.expiresAt,
					userId: users.id,
					email: users.email
				})
				.from(sessions)
				.innerJoin(users, eq(users.id, sessions.userId))
				.where(eq(sessions.tokenHash, tokenHash));
			if (!row) return null;

			const now = clock().getTime();
			if (row.expiresAt.getTime() <= now) {
				await db.delete(sessions).where(eq(sessions.id, row.id));
				return null;
			}

			let expiresAt = row.expiresAt;
			const renewed = expiresAt.getTime() - now < RENEW_WITHIN;
			if (renewed) {
				expiresAt = new Date(now + SESSION_TTL);
				await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, row.id));
			}
			return { user: { id: row.userId, email: row.email }, expiresAt, renewed };
		},

		async invalidateSession(token: string): Promise<void> {
			await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
		}
	};
}
