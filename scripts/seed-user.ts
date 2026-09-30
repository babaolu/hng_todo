/**
 * Create or update the single account from ADMIN_EMAIL / ADMIN_PASSWORD.
 * Usage: pnpm seed:user (reads .env) or pnpm seed:user:prod (reads .env.production.local)
 */
import { eq } from 'drizzle-orm';
import { normalizeEmail } from '../src/lib/server/auth';
import { sessions, users } from '../src/lib/server/db/schema';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../src/lib/server/password';
import { openDatabase } from './db';
import { describeDatabase, loadEnv } from './env';

const envFile = loadEnv();

const { DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (!DATABASE_URL || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
	console.error('DATABASE_URL, ADMIN_EMAIL and ADMIN_PASSWORD must all be set.');
	process.exit(1);
}
if (ADMIN_PASSWORD.length < MIN_PASSWORD_LENGTH) {
	console.error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
	process.exit(1);
}

const { db, close } = await openDatabase(DATABASE_URL);

const email = normalizeEmail(ADMIN_EMAIL);
const passwordHash = await hashPassword(ADMIN_PASSWORD);

const [user] = await db
	.insert(users)
	.values({ email, passwordHash })
	.onConflictDoUpdate({ target: users.email, set: { passwordHash } })
	.returning({ id: users.id });

// A new password signs out every existing session.
await db.delete(sessions).where(eq(sessions.userId, user.id));
await close();

console.log(`Seeded ${email} in ${describeDatabase(DATABASE_URL)} (from ${envFile}).`);
