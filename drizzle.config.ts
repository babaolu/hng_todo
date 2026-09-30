import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',
	// drizzle-kit connects over TCP (node-postgres), so prefer Neon's direct (non-pooler) host.
	dbCredentials: { url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL || '' },
	strict: true,
	verbose: true
});
