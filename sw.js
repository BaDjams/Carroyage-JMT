// sw.js - Service Worker PWA
// ⚠ Mettre à jour CACHE_NAME à chaque déploiement pour invalider le cache existant.

const CACHE_NAME = 'cado-cache-23.0';
const SW_APP_VERSION = '23.0';

// Liste EXACTE des fichiers à mettre en cache.
// Si un seul fichier manque, la PWA ne s'installera pas.
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './help.html',
  './style.css',
  './tailwind.min.css',
  './flowbite.min.css',

  // Scripts principaux
  './utilities.js',
  './carroyageUTM.js',
  './carroyageCado.js',
  './carroyageCFSI.js',
  './carroyageToCSV.js',
  './carroyageToMbtiles.js',
  './imagetoprint.js',
  './zoneDownloader.js',
  './map-layers.js',
  './icons.js',
  './icons-catalog.js',
  './settingsManager.js',
  './version.js',
  './mbtilesCreator.js',
  './seedManager.js',
  './tileSource.js',
  './geotiffExport.js',

  // SQL.js (WASM) — ÉCRITURE des MBTiles (carroyageToMbtiles.js / mbtilesCreator.js)
  './sql-wasm.js',
  './sql-wasm.wasm',

  // wa-sqlite (WASM) — LECTURE paresseuse des MBTiles volumineux (tileSource.js)
  './vendor/wa-sqlite/wa-sqlite-async.js',
  './vendor/wa-sqlite/wa-sqlite-async.wasm',
  './vendor/wa-sqlite/sqlite-api.js',
  './vendor/wa-sqlite/sqlite-constants.js',
  './vendor/wa-sqlite/VFS.js',

  // Librairies tierces
  './jszip.min.js',
  './openlocationcode.min.js',

  // Manifeste
  './manifest.json',

  // Icônes
  './icons/icon-192x192.png',
  './icons/icon-512x512.png'
];

// Installation
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // IMPORTANT : `cache: 'reload'` force chaque requête à IGNORER le cache HTTP
      // du navigateur. Sans ça, addAll() peut ré-enregistrer une version périmée
      // (ex. version.js d'une version précédente) dans le nouveau cache du SW →
      // la PWA reste bloquée sur l'ancien numéro de version après un bump.
      const freshRequests = ASSETS_TO_CACHE.map((u) => new Request(u, { cache: 'reload' }));
      // On ne bloque pas tout si un fichier non-critique manque, mais pour une PWA
      // stricte il vaut mieux que tout soit là.
      return cache.addAll(freshRequests).catch(err => {
          console.error("Erreur lors de la mise en cache des fichiers:", err);
      });
    })
  );
});

// Activation et nettoyage des anciens caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Suppression ancien cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    }).then(() => {
      return self.clients.matchAll();
    }).then((clients) => {
      clients.forEach(client => {
        client.postMessage({ type: 'VERSION_UPDATE', version: SW_APP_VERSION });
      });
    })
  );
});

// Interception des requêtes (Stratégie: Cache falling back to Network)
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Proxy CORS pour les tuiles Yandex : le SW fetch sans restriction CORS
  // et renvoie la réponse avec Access-Control-Allow-Origin pour débloquer canvas.drawImage()
  if (url.includes('maps.yandex.net')) {
    event.respondWith(
      (async () => {
          try {
            let res;
            try { res = await fetch(url, { mode: 'cors', credentials: 'omit' }); }
            catch (_) { res = await fetch(url, { mode: 'no-cors', credentials: 'omit' }); }
            const buf = await res.arrayBuffer();
            const headers = new Headers(res.headers);
            headers.set('Access-Control-Allow-Origin', '*');
            return new Response(buf, { status: res.status, statusText: res.statusText, headers });
          } catch (_) {
            return new Response('', { status: 503 });
          }
        })()
    );
    return;
  }

  // On ignore les requêtes vers les tuiles de cartes (Google/IGN/Bing) pour ne pas saturer le cache
  // et on ignore les requêtes data: et blob:
  if (url.includes('google.com') ||
      url.includes('geopf.fr') ||
      url.includes('openstreetmap') ||
      url.includes('virtualearth') ||
      url.startsWith('data:') ||
      url.startsWith('blob:')) {
    return; // On laisse le réseau gérer normalement
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      // Si trouvé dans le cache, on le retourne
      if (response) {
        return response;
      }
      // Sinon on va le chercher sur le réseau
      return fetch(event.request).catch(() => {
          // Gestion hors ligne optionnelle ici
      });
    })
  );
});
