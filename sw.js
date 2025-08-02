// sw.js

// On importe notre fichier de version. C'est la première chose qu'il fait.
importScripts('version.js');

// La constante VERSION est maintenant disponible grâce à l'import.
const VERSION = APP_VERSION; 
// Le nom du cache est construit à partir de cette variable.
const CACHE_NAME = `cado-utm-generator-v${VERSION}`;

const urlsToCache = [
  '/',
  'index.html',
  'style.css',
  'helpContent.js';
  'imagetoprint.js';
  'carroyageUTM.js',
  'carroyageCado.js',
  'version.js', // IMPORTANT : On ajoute le fichier de version au cache !
  'FFFFFF-images.js',
  '000000-images.js',
  'FF0000-images.js',
  'FFA500-images.js',
  'FFFF00-images.js',
  '008000-images.js',
  '0000FF-images.js',
  '800080-images.js',
  'A52A2A-images.js',
  '808080-images.js',
  // You can also cache the CDN files if you want true offline resilience
  'tailwind.min.css',
  'flowbite.min.css',
  'jszip.min.js',
  'FileSaver.min.js',
  'openlocationcode.min.js'
];

// -- Installation --
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache ouvert pour l\'installation');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        // NOUVEAU : Forcer le nouveau Service Worker à s'activer immédiatement
        return self.skipWaiting();
      })
  );
});

// -- Activation --
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            // Nettoyer les anciens caches
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
        // NOUVEAU : Prendre le contrôle de toutes les pages immédiatement
        return self.clients.claim();
    })
  );
});


// -- Fetch (Gestion des requêtes) --
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // La stratégie est "Cache First" : on sert depuis le cache si possible
        return response || fetch(event.request);
      })
  );
});
