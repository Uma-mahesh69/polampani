// Service worker: cache the app shell so PolamPani opens on a flaky village connection.
// API calls always go to the network; static assets are network-first with an offline fallback.
const CACHE = 'polampani-v3';
const SHELL = [
  '/', '/index.html', '/css/app.css', '/js/main.js', '/js/core.js', '/js/i18n.js', '/js/te.js', '/js/ui.js', '/js/map.js',
  '/js/charts.js', '/js/views/public.js', '/js/views/shared.js', '/js/views/auth.js', '/js/views/farmer.js',
  '/js/views/worker.js', '/js/views/account.js', '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css', '/vendor/fonts.css',
  '/icons/icon.svg', '/icons/icon-192.png', '/manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Network first so updates show immediately; fall back to the cache when offline.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('/index.html'))),
  );
});
