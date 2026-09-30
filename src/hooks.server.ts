import { redirect, type Handle, type ServerInit } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { data, useDb } from '$lib/server/data';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from '$lib/server/session';

export const init: ServerInit = async () => {
	// Local development without Neon: DATABASE_URL=pglite:./.pglite
	// (import.meta.env.DEV is false in production builds, so this is compiled out.)
	if (import.meta.env.DEV && env.DATABASE_URL?.startsWith('pglite:')) {
		const { createPgliteDb } = await import('$lib/server/db/pglite');
		useDb((await createPgliteDb(env.DATABASE_URL.slice('pglite:'.length))).db);
	}
};

const PUBLIC_PATHS = new Set(['/login']);

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;

	const token = event.cookies.get(SESSION_COOKIE);
	if (token) {
		const session = await data.auth.validateSession(token);
		if (session) {
			event.locals.user = session.user;
			if (session.renewed) setSessionCookie(event.cookies, token, session.expiresAt);
		} else {
			clearSessionCookie(event.cookies);
		}
	}

	const isPublic = PUBLIC_PATHS.has(event.url.pathname);
	if (!event.locals.user && !isPublic) redirect(303, '/login');
	if (event.locals.user && isPublic) redirect(303, '/');

	return resolve(event);
};
