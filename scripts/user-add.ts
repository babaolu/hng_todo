/**
 * Add an account, or reset an existing account's password.
 *
 *   pnpm user:add:prod           create NEW_USER_EMAIL; fails if it already exists
 *   pnpm user:add:prod --reset   new password for an existing NEW_USER_EMAIL; signs out its sessions
 *
 * Reads NEW_USER_EMAIL / NEW_USER_PASSWORD from the env file (see scripts/env.ts).
 * Prints only the email and the database host.
 */
import { createAccount, resetPassword } from '../src/lib/server/users';
import { openDatabase } from './db';
import { describeDatabase, loadEnv } from './env';

const envFile = loadEnv();
const reset = process.argv.includes('--reset');

const { DATABASE_URL, NEW_USER_EMAIL, NEW_USER_PASSWORD } = process.env;
if (!DATABASE_URL || !NEW_USER_EMAIL || !NEW_USER_PASSWORD) {
	console.error('DATABASE_URL, NEW_USER_EMAIL and NEW_USER_PASSWORD must all be set.');
	process.exit(1);
}

const target = `${describeDatabase(DATABASE_URL)} (from ${envFile})`;
const { db, close } = await openDatabase(DATABASE_URL);
const result = reset
	? await resetPassword(db, NEW_USER_EMAIL, NEW_USER_PASSWORD)
	: await createAccount(db, NEW_USER_EMAIL, NEW_USER_PASSWORD);
await close();

if (!result.ok) {
	console.error(`${result.error} (${target})`);
	process.exit(1);
}
console.log(`${reset ? 'Reset password for' : 'Created'} ${result.email} in ${target}.`);
