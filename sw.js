// sw.js

const CACHE_NAME = 'grid-generator-v1';

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

// On install, cache all the app shell files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('ServiceWorker: Caching app shell');
      return cache.addAll(FILES_TO_CACHE);
    })
  );
});

// On fetch, serve from cache first
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // If the file is in the cache, return it.
      // Otherwise, fetch it from the network.
      return response || fetch(event.request);
    })
  );
});
