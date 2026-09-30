import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';
import type { Db } from './types';

export function createNeonDb(url: string): Db {
	return drizzle({ client: neon(url), schema });
}
