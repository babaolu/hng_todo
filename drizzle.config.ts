import { defineConfig } from 'drizzle-kit';
import { describeDatabase, loadEnv } from './scripts/env';

const envFile = loadEnv();
// drizzle-kit connects over TCP (node-postgres), so prefer Neon's direct (non-pooler) host.
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || '';
if (url) console.log(`drizzle-kit: ${describeDatabase(url)} (from ${envFile})`);

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',
	dbCredentials: { url },
	strict: true,
	verbose: true
});
