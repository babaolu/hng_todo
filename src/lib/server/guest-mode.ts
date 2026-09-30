import { building } from '$app/environment';
import { env } from '$env/dynamic/private';

/**
 * GUEST_MODE, read on every call (never cached), so every request sees the current setting:
 * - "on": guests allowed; expired guests are cleaned up.
 * - "off": no new guests, guest sessions rejected, and every guest deleted.
 * - anything else, unset included: no new guests and guest sessions rejected, but nothing
 *   deleted. Only an explicit "off" may delete, so a missing variable (a misconfigured
 *   deploy, a local production-mode server) can never wipe guest data.
 */
export type GuestMode = 'on' | 'off' | 'unrecognised';

let warned = false;

export function guestMode(): GuestMode {
	const value = env.GUEST_MODE;
	if (value === 'on' || value === 'off') return value;
	if (!warned) {
		warned = true;
		console.warn('[guest-mode] unrecognised value; guests disabled, no data deleted');
	}
	return 'unrecognised';
}

export function guestModeOn(): boolean {
	return guestMode() === 'on';
}

/** What guest cleanup may delete right now: expired guests, every guest, or nothing. */
export type GuestCleanup = 'expired' | 'all' | 'none';

export function guestCleanup(): GuestCleanup {
	// Never during `vite build` (prerendering runs the server hooks with the build's env).
	if (building) return 'none';
	const mode = guestMode();
	return mode === 'on' ? 'expired' : mode === 'off' ? 'all' : 'none';
}
