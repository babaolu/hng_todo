import { existsSync } from 'node:fs';
import { config } from 'dotenv';

/**
 * Load exactly one env file for CLI scripts: `ENV_FILE` if set, else `.env`.
 * A named file must exist and wins over variables already in the shell, so
 * `ENV_FILE=.env.production.local` can never fall back to the local database.
 */
export function loadEnv(): string {
	const file = process.env.ENV_FILE;
	if (file && !existsSync(file)) throw new Error(`ENV_FILE ${file} does not exist`);
	config({ path: file ?? '.env', override: !!file, quiet: true });
	return file ?? '.env';
}

/** Where a connection string points, safe to print: the host, never credentials. */
export function describeDatabase(url: string | undefined): string {
	if (!url) return '(none)';
	if (url.startsWith('pglite:'))
		return `local PGlite (${url.slice('pglite:'.length) || 'in memory'})`;
	try {
		return new URL(url).host;
	} catch {
		return '(unparseable URL)';
	}
}
