/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/**
 * A deliberately small service worker: it caches only hashed build assets and
 * an offline page, and never caches pages, data or anything user-specific.
 * See $lib/sw-policy for the rules.
 */
import { build, files, version } from '$service-worker';
import { cacheName, OFFLINE_PAGE, precacheList, staleCaches, strategyFor } from '$lib/sw-policy';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = cacheName(version);
const PRECACHE = precacheList(build, files);
const precached = new Set(PRECACHE);

sw.addEventListener('install', (event) => {
	// Take over as soon as this build's assets are cached, so nobody stays on an old version.
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of staleCaches(await caches.keys(), CACHE)) await caches.delete(key);
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	const strategy = strategyFor({
		method: request.method,
		url: new URL(request.url),
		mode: request.mode,
		origin: sw.location.origin,
		precached
	});

	if (strategy === 'cache-first') {
		event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
	} else if (strategy === 'network-then-offline') {
		event.respondWith(
			fetch(request).catch(async () => (await caches.match(OFFLINE_PAGE)) ?? Response.error())
		);
	}
	// 'passthrough': not handled here, so the browser fetches it normally (nothing cached).
});
