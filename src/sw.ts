/// <reference lib="webworker" />
// Offline service worker, bundled by `serwist build` (see serwist.config.js).
// Precaches the app shell, every prerendered page and the static chunks, and
// caches the self-hosted engines (/vendor) the first time a tool uses them.
import { defaultCache } from '@serwist/next/worker';
import { CacheFirst, ExpirationPlugin, NetworkOnly, type PrecacheEntry, Serwist, type SerwistGlobalConfig } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/*
 * Turbopack starts module workers as `turbopack-worker-*.js#params=…`, and the
 * bootstrap reads those params from its own location. A Response served from a
 * cache carries the cache key's URL (no fragment), so the worker would start
 * without its config. These scripts are therefore kept out of the precache
 * route, cached at install time here, and served re-wrapped in a fresh
 * Response, which keeps the request URL.
 */
// The folder between static/ and chunks/ depends on the host (Vercel adds `immutable/`), so allow any.
const TURBOPACK_WORKER = /\/_next\/static\/(?:[^/]+\/)*chunks\/turbopack-worker-[^/]+\.js$/;
const WORKER_CACHE = 'metamorpher-worker-bootstrap';

const entryUrl = (e: PrecacheEntry | string) => (typeof e === 'string' ? e : e.url);
const manifest = self.__SW_MANIFEST ?? [];
const workerUrls = manifest.map(entryUrl).filter((u) => TURBOPACK_WORKER.test(u));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(WORKER_CACHE).then((cache) => cache.addAll(workerUrls)));
});

const serwist: Serwist = new Serwist({
  precacheEntries: manifest.filter((e) => !TURBOPACK_WORKER.test(entryUrl(e))),
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && TURBOPACK_WORKER.test(url.pathname),
      handler: async ({ request, url }): Promise<Response> => {
        const cache = await caches.open(WORKER_CACHE);
        const cached = await cache.match(url.pathname, { ignoreSearch: true });
        if (cached) return new Response(await cached.blob(), { status: 200, headers: cached.headers });
        return fetch(request);
      },
    },
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/vendor/'),
      handler: new CacheFirst({
        cacheName: 'metamorpher-engines',
        plugins: [new ExpirationPlugin({ maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 90 })],
      }),
    },
    // Anything off this origin is an opt-in AI request (a model download, which
    // the AI engine stores itself, or a call to the user's own provider). Never
    // keep a second copy of those in a service-worker cache.
    { matcher: ({ sameOrigin }) => !sameOrigin, handler: new NetworkOnly() },
    // Account, sync, analytics and admin data is per user and must always be
    // fresh: never cache the API or the (request-time rendered) admin pages.
    {
      matcher: ({ url, sameOrigin }) =>
        sameOrigin && (url.pathname.startsWith('/api/') || url.pathname === '/admin' || url.pathname.startsWith('/admin/')),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
