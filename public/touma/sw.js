/**
 * Service worker de la place de marché TOUMA — portée `/touma/`.
 *
 * Ce qu'il fait, et surtout ce qu'il refuse de faire.
 *
 * **Aucune réponse de l'API n'est mise en cache.** Jamais. Un prix, un stock, un
 * état de commande ou un solde servis depuis un cache seraient des mensonges :
 * le serveur est la seule source de vérité financière, et une application qui
 * affiche un ancien montant est pire qu'une application qui affiche une erreur
 * de réseau. Les requêtes `/api/` passent donc directement au réseau.
 *
 * **La coquille est servie réseau d'abord, cache ensuite.** Les modules ES et la
 * feuille de style ne portent pas d'empreinte de contenu dans leur nom : servir
 * un module depuis le cache pendant qu'un autre arrive du réseau produirait un
 * mélange de deux versions, et des erreurs incompréhensibles. Tant qu'il y a du
 * réseau, on prend le réseau. Le cache est un filet, pas un raccourci.
 *
 * **Les images sont servies cache d'abord.** Elles ne mentent pas, elles pèsent.
 * Sur un réseau mobile d'Afrique centrale, c'est là que se gagne le temps de
 * chargement.
 *
 * **Une navigation hors ligne aboutit à une page qui l'explique**, pas au
 * dinosaure du navigateur.
 */
const VERSION = 'touma-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const IMAGE_CACHE = `${VERSION}-images`;

/** Ce qui doit être disponible pour que l'application s'ouvre sans réseau. */
const SHELL = [
  '/touma/',
  '/touma/tokens.css',
  '/touma/touma.css',
  '/touma/touma.js',
  '/touma/core.js',
  '/touma/components.js',
  '/touma/hors-ligne.html',
  '/touma/img/icon-192.png',
  '/touma/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // `addAll` échoue en bloc si un seul fichier manque : on tolère les
      // absences pour qu'une ressource renommée n'empêche pas l'installation.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Met en cache une réponse valable, sans jamais faire échouer la requête. */
async function remember(cacheName, request, response) {
  if (!response || !response.ok || response.type === 'opaque') return response;
  const copy = response.clone();
  caches.open(cacheName).then((cache) => cache.put(request, copy)).catch(() => {});
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Ressources d'un autre domaine : on ne s'en mêle pas.
  if (url.origin !== self.location.origin) return;

  // Données vivantes, flux d'événements, pièces jointes signées : réseau, point.
  if (url.pathname.startsWith('/api/')) return;

  // Tout ce qui sort de la place de marché appartient à l'autre produit.
  if (!url.pathname.startsWith('/touma')) return;

  // Navigation : réseau d'abord, puis la coquille, puis la page hors ligne.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => remember(SHELL_CACHE, '/touma/', response))
        .catch(async () => (await caches.match('/touma/')) ?? (await caches.match('/touma/hors-ligne.html')) ?? Response.error()),
    );
    return;
  }

  // Images : cache d'abord — elles ne changent pas sous nos pieds.
  if (request.destination === 'image') {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request)
            .then((response) => remember(IMAGE_CACHE, request, response))
            .catch(() => cached ?? Response.error()),
      ),
    );
    return;
  }

  // Modules et styles : réseau d'abord, cache en secours.
  event.respondWith(
    fetch(request)
      .then((response) => remember(SHELL_CACHE, request, response))
      .catch(async () => (await caches.match(request)) ?? Response.error()),
  );
});
