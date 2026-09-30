import { redirect } from '@sveltejs/kit';
import { data } from '$lib/server/data';
import { clearSessionCookie, SESSION_COOKIE } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

/** Guests get a confirmation page (leaving deletes their data); everyone else goes home. */
export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user?.isGuest) redirect(303, '/');
	return {};
};

export const actions = {
	default: async ({ cookies, locals }) => {
		if (locals.user?.isGuest) {
			// Leaving as a guest deletes the account and everything in it (cascades to sessions).
			await data.guests.remove(locals.user.id);
		} else {
			const token = cookies.get(SESSION_COOKIE);
			if (token) await data.auth.invalidateSession(token);
		}
		clearSessionCookie(cookies);
		redirect(303, '/login');
	}
} satisfies Actions;
