// Service worker — coquille d'application (app shell) pour l'installabilité PWA
// et un fonctionnement dégradé hors-ligne. Les appels /api ne sont pas mis en
// cache (données temps réel) : réseau d'abord, sans repli.
const CACHE = 'toumai-shell-v1';
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Données live : toujours le réseau, jamais le cache.
  if (url.pathname.startsWith('/api') || url.pathname === '/health') {
    return; // laisse le navigateur gérer la requête réseau
  }

  // Coquille : cache d'abord, repli réseau (puis mise en cache).
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
          return res;
        }),
    ),
  );
});
