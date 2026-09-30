import { createNeonDb } from '../src/lib/server/db/neon';
import type { Db } from '../src/lib/server/db/types';

/** Open DATABASE_URL: Neon over HTTP, or a local `pglite:<dir>` database. */
export async function openDatabase(url: string): Promise<{ db: Db; close: () => Promise<void> }> {
	if (url.startsWith('pglite:')) {
		const { createPgliteDb } = await import('../src/lib/server/db/pglite');
		return createPgliteDb(url.slice('pglite:'.length));
	}
	return { db: createNeonDb(url), close: async () => {} };
}
