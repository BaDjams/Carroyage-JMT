// sw.js

// 1. Importation des bibliothèques nécessaires
// Workbox pour la gestion intelligente du cache
importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.4.1/workbox-sw.js');
// Votre fichier de version pour la communication avec la page
importScripts('version.js');

// On s'assure que tout est bien chargé avant de continuer
if (workbox && typeof APP_VERSION !== 'undefined') {
  console.log(`Workbox et la version ${APP_VERSION} sont chargés !`);

  // 2. Configuration de Workbox pour une mise à jour rapide
  // Force le nouveau Service Worker à s'activer dès qu'il est installé.
  workbox.core.skipWaiting();
  // Force le Service Worker à prendre le contrôle de la page immédiatement.
  workbox.core.clientsClaim();

  // 3. Pré-mise en cache (Pre-caching)
  // C'est ici que la magie opère. Workbox va mettre en cache tous ces fichiers.
  // Lors d'une mise à jour, il ne téléchargera QUE les fichiers dont le contenu a changé.
  workbox.precaching.precacheAndRoute([
    { url: '/', revision: APP_VERSION },
    { url: 'index.html', revision: APP_VERSION },
    { url: 'utilities.js', revision: APP_VERSION },
    { url: 'style.css', revision: APP_VERSION },
    { url: 'help.html', revision: APP_VERSION },
    { url: 'imagetoprint.js', revision: APP_VERSION },
    { url: 'carroyageUTM.js', revision: APP_VERSION },
    { url: 'carroyageCado.js', revision: APP_VERSION },
    { url: 'zoneDowloader.js', revision: APP_VERSION },
    { url: 'map-layers.js', revision: APP_VERSION },
    // Fichiers CDN - Attention, le pre-caching de ressources externes peut être moins fiable.
    // Assurez-vous que ces ressources ont le header CORS approprié.
    { url: 'https://cdn.tailwindcss.com/3.3.3/tailwind.min.css', revision: null },
    { url: 'https://unpkg.com/flowbite@1.8.1/dist/flowbite.min.css', revision: null },
    { url: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', revision: null },
    { url: 'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js', revision: null },
    { url: 'https://cdn.jsdelivr.net/npm/openlocationcode@1.0.3/openlocationcode.min.js', revision: null }
  ]);

  // 4. Logique de communication vers la page
  // Cet événement se déclenche quand le nouveau Service Worker prend le contrôle.
  self.addEventListener('activate', (event) => {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(windowClients => {
        windowClients.forEach(windowClient => {
          windowClient.postMessage({
            type: 'VERSION_UPDATE',
            version: APP_VERSION
          });
        });
      })
    );
  });

  // 5. Stratégie de cache à l'exécution (Runtime Caching) - PARTIE AJOUTÉE
  // C'est la partie manquante. Elle intercepte les requêtes pendant que l'application s'exécute.
  // Elle permet à votre application d'être fonctionnelle hors ligne et de devenir installable.

  // Stratégie "Stale-While-Revalidate" pour les CSS et JS :
  // On sert le fichier depuis le cache (très rapide), puis on vérifie en arrière-plan
  // s'il y a une nouvelle version pour la prochaine visite.
  workbox.routing.registerRoute(
    // On cible les fichiers CSS, JS et les Web Workers
    ({ request }) => request.destination === 'style' ||
                     request.destination === 'script' ||
                     request.destination === 'worker',
    // On utilise la stratégie StaleWhileRevalidate
    new workbox.strategies.StaleWhileRevalidate({
      // On donne un nom au cache pour le débogage
      cacheName: 'asset-cache',
    })
  );

  // Stratégie "Cache First" pour les images :
  // Si l'image est dans le cache, on la sert. Sinon, on fait une requête réseau
  // et on met la réponse en cache pour les prochaines fois.
  workbox.routing.registerRoute(
    ({ request }) => request.destination === 'image',
    new workbox.strategies.CacheFirst({
      cacheName: 'image-cache',
      plugins: [
        new workbox.expiration.ExpirationPlugin({
          maxEntries: 60, // On ne garde que 60 images en cache
          maxAgeSeconds: 30 * 24 * 60 * 60, // 30 jours
        })
      ]
    })
  );

} else {
  console.log(`Erreur critique : Workbox ou le fichier de version n'a pas pu être chargé.`);
}
