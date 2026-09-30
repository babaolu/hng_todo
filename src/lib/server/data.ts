import { env } from '$env/dynamic/private';
import { createAuthStore } from './auth';
import { createNeonDb } from './db/neon';
import type { Db } from './db/types';
import { createGuestStore } from './guests';
import { createListStore } from './lists';
import { createTaskStore } from './tasks';

function build(db: Db) {
	return {
		auth: createAuthStore(db),
		guests: createGuestStore(db),
		lists: createListStore(db),
		tasks: createTaskStore(db)
	};
}

let stores: ReturnType<typeof build> | undefined;

function get() {
	if (!stores) {
		if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
		stores = build(createNeonDb(env.DATABASE_URL));
	}
	return stores;
}

/** Swap the driver (dev-only PGlite; see hooks.server.ts). */
export function useDb(db: Db) {
	stores = build(db);
}

/**
 * The app's data-access layer, bound to Neon. Built on first use so that
 * importing server modules (e.g. during `vite build`) needs no DATABASE_URL.
 * Routes use these and never query tables directly.
 */
export const data = {
	get auth() {
		return get().auth;
	},
	get guests() {
		return get().guests;
	},
	get lists() {
		return get().lists;
	},
	get tasks() {
		return get().tasks;
	}
};
