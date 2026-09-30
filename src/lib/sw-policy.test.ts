import { describe, expect, it } from 'vitest';
import { cacheName, OFFLINE_PAGE, precacheList, staleCaches, strategyFor } from './sw-policy';

const origin = 'https://todo.example';
const precached = new Set(
	precacheList(
		['/_app/immutable/entry/app.abc123.js', '/_app/immutable/assets/0.def.css'],
		['/robots.txt', OFFLINE_PAGE, '/icons/icon-192.png']
	)
);
const decide = (path: string, { method = 'GET', mode = 'cors', host = origin } = {}) =>
	strategyFor({ method, url: new URL(path, host), mode, origin, precached });

describe('service worker policy', () => {
	it('precaches only hashed build assets and the offline page', () => {
		expect([...precached].sort()).toEqual(
			[
				'/_app/immutable/assets/0.def.css',
				'/_app/immutable/entry/app.abc123.js',
				OFFLINE_PAGE
			].sort()
		);
	});

	it('serves hashed build assets from the cache', () => {
		expect(decide('/_app/immutable/entry/app.abc123.js')).toBe('cache-first');
		expect(decide('/_app/immutable/assets/0.def.css')).toBe('cache-first');
	});

	it('never caches pages: navigations go to the network, with the offline page only on failure', () => {
		for (const path of ['/', '/upcoming', '/lists/123', '/search?q=rent', '/login', '/logout'])
			expect(decide(path, { mode: 'navigate' })).toBe('network-then-offline');
	});

	it('leaves data, forms, exports and everything else alone', () => {
		expect(decide('/__data.json')).toBe('passthrough');
		expect(decide('/upcoming/__data.json?x-sveltekit-invalidated=01')).toBe('passthrough');
		expect(decide('/?/addTask', { method: 'POST' })).toBe('passthrough');
		expect(decide('/login?/login', { method: 'POST', mode: 'navigate' })).toBe('passthrough');
		expect(decide('/settings/export', { mode: 'navigate' })).toBe('passthrough');
		expect(decide('/settings/export')).toBe('passthrough');
		expect(decide('/_app/version.json')).toBe('passthrough');
		expect(decide('/icons/icon-192.png')).toBe('passthrough');
		expect(decide(OFFLINE_PAGE)).toBe('passthrough');
		expect(decide('/_app/immutable/entry/app.abc123.js?v=1')).toBe('passthrough');
		expect(decide('/_app/immutable/entry/app.abc123.js', { host: 'https://cdn.example' })).toBe(
			'passthrough'
		);
	});

	it('versions caches by build and removes the old ones', () => {
		const current = cacheName('1790000000002');
		expect(
			staleCaches([cacheName('1790000000001'), current, 'someone-elses-cache'], current)
		).toEqual([cacheName('1790000000001')]);
	});
});
