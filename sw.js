// sw.js - Service Worker PWA
// ⚠ Mettre à jour CACHE_NAME à chaque déploiement pour invalider le cache existant.

// Un seul numéro à tenir à jour ici : la page lit le sien dans version.js, et
// SW_APP_VERSION faisait doublon avec les deux — une occasion de plus de les
// laisser diverger.
const CACHE_NAME = 'cado-cache-23.14';

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
  './carroyageDFCI.js',
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

  // Leaflet et ses greffons — servis depuis le dépôt, donc pré-cachables.
  // Tant qu'ils venaient d'unpkg.com / cdnjs.cloudflare.com, ils échappaient au
  // pré-cache : l'application se disait hors-ligne mais ne démarrait pas sans
  // réseau, et restait sur une page blanche dès que le CDN était filtré ou lent.
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.wms.js',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/leaflet-draw/leaflet.draw.js',
  './vendor/leaflet-draw/leaflet.draw.css',
  './vendor/leaflet-draw/images/spritesheet.png',
  './vendor/leaflet-draw/images/spritesheet-2x.png',
  './vendor/leaflet-draw/images/spritesheet.svg',

  // Manifeste
  './manifest.json',

  // Icônes
  './icons/icon-192x192.png',
  './icons/icon-512x512.png'
];

// Installation
//
// PAS de skipWaiting() ici. Il faisait prendre la main au nouveau Service Worker
// immédiatement, y compris sur une page DÉJÀ en train de se charger : celle-ci
// commençait sur l'ancien cache et finissait sur le nouveau, avec à l'arrivée un
// mélange possible de deux versions dans un seul onglet — et le numéro affiché
// restait celui d'avant, puisque index.html et version.js avaient été lus avant
// la bascule. D'où l'impression d'un « conflit de version ».
//
// Le nouveau Service Worker attend donc son tour. Il prend la main soit quand
// tous les onglets de l'application sont fermés, soit quand l'utilisateur clique
// « Recharger » dans la notification (message SKIP_WAITING ci-dessous). Dans les
// deux cas, une page donnée est servie de bout en bout par une seule version.
self.addEventListener('install', (event) => {
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

// La page demande la bascule immédiate (clic sur « Recharger »). C'est le seul
// chemin par lequel un Service Worker en attente prend la main sans attendre la
// fermeture des onglets — et la page se recharge juste après, donc elle repart
// entièrement sur la nouvelle version.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
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
      // claim() sert la toute première installation : sans lui, la page qui vient
      // d'enregistrer le Service Worker resterait non contrôlée jusqu'au
      // rechargement suivant. Sur une mise à jour, la page se recharge de toute
      // façon (évènement controllerchange, côté index.html).
      return self.clients.claim();
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
      // Sinon on va le chercher sur le réseau. En cas d'échec on renvoie une
      // erreur réseau en bonne et due forme : rendre `undefined` faisait échouer
      // respondWith() lui-même, ce que le navigateur signalait par un ERR_FAILED
      // opaque au lieu de la vraie cause.
      return fetch(event.request).catch(() => Response.error());
    })
  );
});
