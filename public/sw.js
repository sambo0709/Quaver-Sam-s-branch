const CACHE = 'quaver-v4';
// Only cache images — HTML and CSS are always served fresh from the network
const ASSETS = [
  '/quaver-q-dark.png',
  '/quaver-q-light.png',
  '/manifest.json',
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Never intercept API or auth calls
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/spotify/')) return;

  // Spotify artwork and other third-party media should be handled directly by
  // the browser. Cross-origin failures cannot be repaired by Quaver's cache and
  // responding with a rejected fetch makes the service worker surface an error.
  if (url.origin !== self.location.origin) return;

  // HTML and CSS: always network-first so updates are instant
  if (url.pathname.endsWith('.html') || url.pathname.endsWith('.css') || url.pathname === '/') {
    e.respondWith(
      fetch(e.request).catch(function() { return caches.match(e.request); })
    );
    return;
  }

  // Images/manifest: cache-first
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request);
    })
  );
});
