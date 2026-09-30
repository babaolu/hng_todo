import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

/**
 * Any drizzle Postgres database built with our schema. The app passes a
 * neon-http instance; tests pass a PGlite instance.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
