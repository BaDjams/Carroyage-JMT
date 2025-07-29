// sw.js

const CACHE_NAME = 'grid-generator-v12.7.1';

// List all the files your app needs to function offline
const FILES_TO_CACHE = [
  '/',
  'index.html',
  'style.css',
  'carroyageUTM.js',
  'carroyageCado.js',
  // IMPORTANT: You must list all your icon data files here
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
  'https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js',
  'https://cdn.jsdelivr.net/npm/open-location-code@1.0.4/js/openlocationcode.min.js'
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
