import { fail, redirect } from '@sveltejs/kit';
import { data } from '$lib/server/data';
import { setSessionCookie } from '$lib/server/session';
import type { Actions } from './$types';

export const actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '').slice(0, 320);
		const password = String(form.get('password') ?? '').slice(0, 1024);

		// adapter-vercel returns X-Forwarded-For, which Vercel overwrites with the real client IP.
		// Take the first entry, and never pass null (it would match no lockout rows).
		const ip = (getClientAddress() ?? '').split(',')[0].trim() || 'unknown';
		const result = await data.auth.login(email, password, ip);
		if (!result.ok) {
			const message =
				result.reason === 'locked'
					? 'Too many failed attempts. Try again in 15 minutes.'
					: 'Invalid email or password.';
			return fail(result.reason === 'locked' ? 429 : 400, { email, message });
		}

		const { token, expiresAt } = await data.auth.createSession(result.user.id);
		setSessionCookie(cookies, token, expiresAt);
		redirect(303, '/');
	}
} satisfies Actions;
