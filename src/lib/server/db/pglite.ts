import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema';
import type { Db } from './types';

/**
 * Embedded Postgres with the committed migrations applied. Used by the tests
 * (in memory) and by `pnpm dev` when DATABASE_URL is `pglite:<dir>`.
 * Never used in production.
 */
export async function createPgliteDb(
	dataDir?: string
): Promise<{ db: Db; close: () => Promise<void> }> {
	const client = new PGlite(dataDir);
	const db = drizzle({ client, schema });
	await migrate(db, { migrationsFolder: 'drizzle' });
	return { db, close: () => client.close() };
}
