// Offline shell. The phone hits the network exactly once — the first load —
// then serves the app from this cache forever, which is the whole point: the
// commute runs through a tunnel and a parking garage.
//
// Bump CACHE_VERSION whenever you change any file below, or the phone will keep
// serving the old copy.

const CACHE_VERSION = 'commute-v13';

const SHELL = [
  '.',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'js/app.js',
  'js/store.js',
  'js/seed.js',
  'js/format.js',
  'js/dom.js',
  'js/editor.js',
  'js/table.js',
  'js/charts.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // addAll is atomic, so one bad path would poison the whole install.
      // Individual puts keep a typo from taking the app offline entirely.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The seed file is deliberately absent in production; never cache a 404 for it.
  if (url.pathname.endsWith('seed.local.json')) {
    event.respondWith(fetch(request).catch(() => new Response('', { status: 404 })));
    return;
  }

  // Cache-first: correctness here means "always opens", not "always freshest".
  // A background revalidate picks up new versions when there is a network.
  event.respondWith(
    caches.match(request).then((hit) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});
