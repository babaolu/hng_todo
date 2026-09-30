import { existsSync } from 'node:fs';
import { config } from 'dotenv';

/**
 * Load exactly one env file for CLI scripts: `ENV_FILE` if set, else `.env`.
 * A named file must exist and wins over variables already in the shell, so
 * `ENV_FILE=.env.prod` can never fall back to the local database.
 *
 * Production credentials live in `.env.prod` because Vite never loads that name by
 * itself (it does load `.env.production*`), so `vite build` and `pnpm preview` can't
 * reach the production database.
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
