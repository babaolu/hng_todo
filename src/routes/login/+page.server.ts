import { error, fail, redirect } from '@sveltejs/kit';
import { isValidTimeZone } from '$lib/dates';
import { data } from '$lib/server/data';
import { guestCleanup, guestModeOn } from '$lib/server/guest-mode';
import { clientIp, setSessionCookie } from '$lib/server/session';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ guestMode: guestModeOn() });

export const actions = {
	login: async (event) => {
		const form = await event.request.formData();
		const email = String(form.get('email') ?? '').slice(0, 320);
		const password = String(form.get('password') ?? '').slice(0, 1024);

		// Housekeeping: expired guests go while guest mode is on, every guest when it's "off",
		// nothing otherwise.
		await data.guests.housekeep(guestCleanup());

		const result = await data.auth.login(email, password, clientIp(event));
		if (!result.ok) {
			const message =
				result.reason === 'locked'
					? 'Too many failed attempts. Try again in 15 minutes.'
					: 'Invalid email or password.';
			return fail(result.reason === 'locked' ? 429 : 400, { email, message });
		}

		const { token, expiresAt } = await data.auth.createSession(result.user.id);
		setSessionCookie(event.cookies, token, expiresAt);
		redirect(303, '/');
	},

	/** "Continue as guest": a POST only, so nothing is ever created by a GET. */
	guest: async (event) => {
		if (!guestModeOn()) error(404, 'Not found');

		const zone = event.cookies.get('tz');
		const result = await data.guests.create(
			clientIp(event),
			zone && isValidTimeZone(zone) ? zone : 'UTC'
		);
		if (!result.ok) {
			return fail(result.reason === 'full' ? 503 : 429, {
				guestError:
					result.reason === 'full'
						? 'Guest mode is full right now, try again later.'
						: 'Too many guest accounts from your network. Try again in an hour.'
			});
		}

		setSessionCookie(event.cookies, result.token, result.expiresAt);
		redirect(303, '/');
	}
} satisfies Actions;
