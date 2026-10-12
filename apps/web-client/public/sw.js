/*
 * P6-PWA-1 — the PRECACHE-ONLY service worker.
 *
 * HONEST SCOPE (the work order's words, pinned): this worker serves ONLY
 * the precached static app-shell assets — the vite build's dist inventory,
 * injected at build time in place of the empty slot below by the
 * webflix-precache-inject plugin (apps/web-client/vite.config.ts,
 * closeBundle hook). ZERO runtime network targets exist in this source:
 * the only fetch call is the pass-through for requests that are NOT in
 * the precache (the browser's own default behavior — "anything else falls
 * through to the network"); after install the shell itself never touches
 * the network.
 *
 * No sync. No push. No telemetry. No analytics. Ever.
 */

const CACHE_NAME = "webflix-shell-precache-v1";

// The build injects the dist inventory here (webflix-precache-inject,
// vite.config.ts): this literal empty-array assignment is the INJECTION
// SLOT — the built dist/sw.js carries the real file list in its place.
self.__WF_PRECACHE_MANIFEST = [];
const PRECACHE_MANIFEST = self.__WF_PRECACHE_MANIFEST;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_MANIFEST)));
});

self.addEventListener("activate", (event) => {
  // Old caches go away; nothing else runs at activation.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    // Non-GET passes through untouched (the browser's default).
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    // Cross-origin passes through untouched — never cached, never blocked.
    return;
  }
  event.respondWith(
    caches.match(request, { cacheName: CACHE_NAME }).then((cached) => {
      if (cached) {
        // A precached asset: served from the cache. ZERO network.
        return cached;
      }
      // NOT in the precache: fall through to the network (the honest
      // fallback — the browser renders its own offline state when the
      // network is gone). Nothing is added to any cache here.
      return fetch(request);
    }),
  );
});
