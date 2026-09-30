import { users } from '../db/schema';
import { createPgliteDb } from '../db/pglite';
import type { Db } from '../db/types';

/** A fresh in-memory Postgres with the committed migrations applied. */
export const createTestDb = () => createPgliteDb();

export async function createUser(db: Db, email: string, passwordHash = 'unused'): Promise<string> {
	const [row] = await db.insert(users).values({ email, passwordHash }).returning({ id: users.id });
	return row.id;
}
