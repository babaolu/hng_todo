import { env } from '$env/dynamic/private';

/**
 * GUEST_MODE=on enables guest accounts; anything else (or unset) means off.
 * Read on every call, never cached, so every request sees the current setting.
 */
export function guestModeOn(): boolean {
	return env.GUEST_MODE === 'on';
}
