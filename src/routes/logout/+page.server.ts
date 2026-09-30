import { redirect } from '@sveltejs/kit';
import { data } from '$lib/server/data';
import { clearSessionCookie, SESSION_COOKIE } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => redirect(303, '/');

export const actions = {
	default: async ({ cookies }) => {
		const token = cookies.get(SESSION_COOKIE);
		if (token) await data.auth.invalidateSession(token);
		clearSessionCookie(cookies);
		redirect(303, '/login');
	}
} satisfies Actions;
