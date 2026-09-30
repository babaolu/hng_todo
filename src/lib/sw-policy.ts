/**
 * What the service worker may do with a request. Kept pure so it can be tested.
 *
 * The rule: only hashed build assets (identical for everyone, never containing
 * user data) are ever served from the cache. Page navigations always go to the
 * network; if that fails, the offline page is shown. Everything else (HTML,
 * __data.json, form posts, /settings/export, API calls) passes straight
 * through and is never cached.
 */
export const CACHE_PREFIX = 'todo-static-';
export const OFFLINE_PAGE = '/offline.html';
/** Downloads start as navigations; never answer them with the offline page. */
const NEVER_INTERCEPT = ['/settings/export'];

export type Strategy = 'cache-first' | 'network-then-offline' | 'passthrough';

/** One cache per build: a new deploy gets a new cache and old ones are deleted. */
export function cacheName(version: string): string {
	return `${CACHE_PREFIX}${version}`;
}

/** The build's hashed assets, plus the offline page. */
export function precacheList(build: string[], files: string[]): string[] {
	return [...build, ...files.filter((file) => file === OFFLINE_PAGE)];
}

export function strategyFor(request: {
	method: string;
	url: URL;
	mode: string;
	origin: string;
	precached: Set<string>;
}): Strategy {
	const { method, url, mode, origin, precached } = request;
	if (method !== 'GET' || url.origin !== origin) return 'passthrough';
	if (NEVER_INTERCEPT.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`)))
		return 'passthrough';
	if (mode === 'navigate') return 'network-then-offline';
	if (!url.search && url.pathname !== OFFLINE_PAGE && precached.has(url.pathname))
		return 'cache-first';
	return 'passthrough';
}

/** Caches from earlier builds (to delete when a new service worker activates). */
export function staleCaches(keys: string[], current: string): string[] {
	return keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== current);
}
