/**
 * Create or update the single account from ADMIN_EMAIL / ADMIN_PASSWORD.
 * Usage: pnpm seed:user   (reads .env; real env vars take precedence)
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { normalizeEmail } from '../src/lib/server/auth';
import { createNeonDb } from '../src/lib/server/db/neon';
import { sessions, users } from '../src/lib/server/db/schema';
import type { Db } from '../src/lib/server/db/types';
import { hashPassword } from '../src/lib/server/password';

const { DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (!DATABASE_URL || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
	console.error('DATABASE_URL, ADMIN_EMAIL and ADMIN_PASSWORD must all be set.');
	process.exit(1);
}
if (ADMIN_PASSWORD.length < 12) {
	console.error('ADMIN_PASSWORD must be at least 12 characters.');
	process.exit(1);
}

let db: Db;
let close = async () => {};
if (DATABASE_URL.startsWith('pglite:')) {
	const { createPgliteDb } = await import('../src/lib/server/db/pglite');
	({ db, close } = await createPgliteDb(DATABASE_URL.slice('pglite:'.length)));
} else {
	db = createNeonDb(DATABASE_URL);
}

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

console.log(`Seeded ${email}.`);
