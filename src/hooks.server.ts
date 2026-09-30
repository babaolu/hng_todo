import { redirect, type Handle, type ServerInit } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isValidTimeZone } from '$lib/dates';
import { data, useDb } from '$lib/server/data';
import { guestCleanup, guestModeOn } from '$lib/server/guest-mode';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from '$lib/server/session';

export const init: ServerInit = async () => {
	// Local development without Neon: DATABASE_URL=pglite:./.pglite
	// (import.meta.env.DEV is false in production builds, so this is compiled out.)
	if (import.meta.env.DEV && env.DATABASE_URL?.startsWith('pglite:')) {
		const { createPgliteDb } = await import('$lib/server/db/pglite');
		useDb((await createPgliteDb(env.DATABASE_URL.slice('pglite:'.length))).db);
	}

	// GUEST_MODE=off: remove every guest account. Only an explicit "off" deletes, never an
	// unset or unknown value, and never during a build (see guest-mode.ts). Changing
	// GUEST_MODE on Vercel needs a redeploy, so every new instance runs this. A failure here
	// mustn't stop the server starting; the per-request check below and login housekeeping
	// are the backup.
	if (guestCleanup() === 'all') {
		try {
			const deleted = await data.guests.deleteAll();
			console.log(`[guest-mode] off: deleted ${deleted} guest account(s) at start-up`);
		} catch (err) {
			console.error('[guest-mode] start-up cleanup failed', err);
		}
	}
};

const PUBLIC_PATHS = new Set(['/login']);
const TZ_COOKIE = 'tz';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;

	const token = event.cookies.get(SESSION_COOKIE);
	if (token) {
		const session = await data.auth.validateSession(token);
		if (session?.user.isGuest && !guestModeOn()) {
			// Guests aren't allowed now: sign this one out. With GUEST_MODE=off its account and
			// data go too; otherwise (unset or unknown value) nothing is deleted.
			if (guestCleanup() === 'all') {
				await data.guests.remove(session.user.id);
				console.log('[guest-mode] off: deleted 1 guest account on request');
			}
			clearSessionCookie(event.cookies);
		} else if (session) {
			event.locals.user = session.user;
			if (session.renewed) setSessionCookie(event.cookies, token, session.expiresAt);

			// The browser reports its zone in a `tz` cookie (see routes/+layout.svelte); keep the
			// stored zone in sync so "today" is the user's day. Without JS, the stored zone is used.
			const zone = event.cookies.get(TZ_COOKIE);
			if (zone && zone !== session.user.timeZone && isValidTimeZone(zone)) {
				await data.auth.setTimeZone(session.user.id, zone);
				event.locals.user = { ...session.user, timeZone: zone };
			}
		} else {
			clearSessionCookie(event.cookies);
		}
	}

	const isPublic = PUBLIC_PATHS.has(event.url.pathname);
	if (!event.locals.user && !isPublic) redirect(303, '/login');
	if (event.locals.user && isPublic) redirect(303, '/');

	return resolve(event);
};
