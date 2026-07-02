/*
 * Mon Relevé — Service Worker v2.0
 * Offline-first · Auto-update · iOS PWA compatible
 */

const APP_VERSION = '2.0';
const CACHE_CORE = 'mr-core-v2.0';
const CACHE_CDN = 'mr-cdn-v1';

// Core assets (versioned — cleared on update)
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-512.png',
  './icon-192.png',
  './icon-180.png'
];

// CDN assets (persistent — only cleared if CDN URLs change)
const CDN_ASSETS = [
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js'
];

// ── Install: cache core + CDN assets ──
self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_CORE).then(cache => cache.addAll(CORE_ASSETS)),
      caches.open(CACHE_CDN).then(cache =>
        // Only add CDN assets if not already cached
        Promise.all(CDN_ASSETS.map(url =>
          cache.match(url).then(existing => existing || cache.add(url))
        ))
      )
    ]).then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches, claim clients ──
self.addEventListener('activate', event => {
  const validCaches = [CACHE_CORE, CACHE_CDN];
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !validCaches.includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => {
        // Notify all clients that a new version is active
        self.clients.matchAll().then(clients => {
          clients.forEach(client => client.postMessage({ type: 'SW_UPDATED', version: APP_VERSION }));
        });
      })
  );
});

// ── Fetch strategy ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension, blob, data URLs
  if (!url.protocol.startsWith('http')) return;

  // Strategy for index.html / navigation: Network-first with cache fallback
  // This ensures updates are picked up quickly while still working offline
  if (event.request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache the fresh copy
          const clone = response.clone();
          caches.open(CACHE_CORE).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          // Offline: serve from cache
          return caches.match(event.request)
            .then(cached => cached || caches.match('./index.html'))
            .then(cached => cached || new Response('Hors ligne — veuillez vous reconnecter.', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            }));
        })
    );
    return;
  }

  // Strategy for CDN scripts: Cache-first (they're versioned by URL)
  if (CDN_ASSETS.some(cdn => event.request.url.startsWith(cdn.split('@')[0]))) {
    event.respondWith(
      caches.match(event.request)
        .then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            const clone = response.clone();
            caches.open(CACHE_CDN).then(cache => cache.put(event.request, clone));
            return response;
          });
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Strategy for manifest.json and sw.js: Network-first
  if (url.pathname.endsWith('.json') || url.pathname.endsWith('.js')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_CORE).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Default: Cache-first with network fallback
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request))
      .catch(() => caches.match('./index.html'))
  );
});

// ── Listen for skip-waiting message from client ──
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
