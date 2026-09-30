import { dev } from '$app/environment';
import type { Cookies, RequestEvent } from '@sveltejs/kit';

export const SESSION_COOKIE = 'session';

export function setSessionCookie(cookies: Cookies, token: string, expiresAt: Date) {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		secure: !dev,
		sameSite: 'lax',
		expires: expiresAt
	});
}

export function clearSessionCookie(cookies: Cookies) {
	cookies.delete(SESSION_COOKIE, { path: '/', httpOnly: true, secure: !dev, sameSite: 'lax' });
}

/**
 * The client's IP. adapter-vercel returns X-Forwarded-For, which Vercel overwrites
 * with the real address. Take the first entry, and never return null (it would
 * match no rate-limit rows).
 */
export function clientIp(event: Pick<RequestEvent, 'getClientAddress'>): string {
	return (event.getClientAddress() ?? '').split(',')[0].trim() || 'unknown';
}
