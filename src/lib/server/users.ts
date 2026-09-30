import { eq } from 'drizzle-orm';
import { normalizeEmail } from './auth';
import { sessions, users } from './db/schema';
import type { Db } from './db/types';
import { hashPassword, MIN_PASSWORD_LENGTH } from './password';

export type AccountResult = { ok: true; email: string } | { ok: false; error: string };

function validate(rawEmail: string, password: string): AccountResult {
	const email = normalizeEmail(rawEmail);
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
		return { ok: false, error: 'Invalid email address.' };
	if (password.length < MIN_PASSWORD_LENGTH) {
		return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
	}
	return { ok: true, email };
}

/** Create a new account. Fails, changing nothing, if the email is already taken. */
export async function createAccount(
	db: Db,
	rawEmail: string,
	password: string
): Promise<AccountResult> {
	const check = validate(rawEmail, password);
	if (!check.ok) return check;
	const [row] = await db
		.insert(users)
		.values({ email: check.email, passwordHash: await hashPassword(password) })
		.onConflictDoNothing({ target: users.email })
		.returning({ id: users.id });
	return row ? check : { ok: false, error: `${check.email} already exists; nothing changed.` };
}

/** Set a new password for an existing account and sign out its sessions. Fails if it doesn't exist. */
export async function resetPassword(
	db: Db,
	rawEmail: string,
	password: string
): Promise<AccountResult> {
	const check = validate(rawEmail, password);
	if (!check.ok) return check;
	const [row] = await db
		.update(users)
		.set({ passwordHash: await hashPassword(password) })
		.where(eq(users.email, check.email))
		.returning({ id: users.id });
	if (!row) return { ok: false, error: `${check.email} does not exist; nothing changed.` };
	await db.delete(sessions).where(eq(sessions.userId, row.id));
	return check;
}
