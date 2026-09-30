import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, lt } from 'drizzle-orm';
import { loginAttempts, sessions, users } from './db/schema';
import type { Db } from './db/types';
import { verifyDummy, verifyPassword } from './password';

const DAY = 24 * 60 * 60 * 1000;
export const SESSION_TTL = 30 * DAY;
/** Sliding renewal: extend once less than this much lifetime remains. */
const RENEW_WITHIN = 15 * DAY;

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_WINDOW = 15 * 60 * 1000;

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
	 * Locked when the last MAX_FAILED_LOGINS failures all fall inside one window
	 * and the most recent of them is less than a window ago. Attempts made while
	 * locked are not recorded, so the lock lifts LOCKOUT_WINDOW after the failure
	 * that triggered it.
	 */
	async function isLocked(email: string): Promise<boolean> {
		const recent = await db
			.select({ at: loginAttempts.attemptedAt })
			.from(loginAttempts)
			.where(eq(loginAttempts.email, email))
			.orderBy(desc(loginAttempts.attemptedAt))
			.limit(MAX_FAILED_LOGINS);
		if (recent.length < MAX_FAILED_LOGINS) return false;
		const newest = recent[0].at.getTime();
		const oldest = recent[recent.length - 1].at.getTime();
		return newest - oldest <= LOCKOUT_WINDOW && clock().getTime() - newest < LOCKOUT_WINDOW;
	}

	return {
		/** Never reveals whether the email exists: unknown emails cost the same and count toward lockout. */
		async login(rawEmail: string, password: string): Promise<LoginResult> {
			const email = normalizeEmail(rawEmail);
			if (await isLocked(email)) return { ok: false, reason: 'locked' };

			const [user] = await db.select().from(users).where(eq(users.email, email));
			const valid = user
				? await verifyPassword(user.passwordHash, password)
				: (await verifyDummy(password), false);

			if (!valid) {
				const now = clock();
				await db.insert(loginAttempts).values({ email, attemptedAt: now });
				await db
					.delete(loginAttempts)
					.where(
						and(
							eq(loginAttempts.email, email),
							lt(loginAttempts.attemptedAt, new Date(now.getTime() - DAY))
						)
					);
				return { ok: false, reason: 'invalid' };
			}

			await db.delete(loginAttempts).where(eq(loginAttempts.email, email));
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
