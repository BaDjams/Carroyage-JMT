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
  // Pour que cela fonctionne, vous devez mettre à jour la "revision" d'un fichier quand vous le modifiez.
  // Si vous n'utilisez pas d'outil de build, vous pouvez changer manuellement la révision (ex: 'v1.1').
  workbox.precaching.precacheAndRoute([
    { url: '/', revision: 'v1' },
    { url: 'index.html', revision: 'v1' },
    { url: 'style.css', revision: 'v1' },
    { url: 'help.html', revision: 'v1' },
    { url: 'imagetoprint.js', revision: 'v1' },
    { url: 'carroyageUTM.js', revision: 'v1' },
    { url: 'carroyageCado.js', revision: 'v1' },
    { url: 'map-layers.js', revision: 'v1' },
    // On met aussi en cache le fichier de version pour être sûr qu'il est à jour.
    { url: 'version.js', revision: 'v1' }, 
    { url: 'FFFFFF-images.js', revision: 'v1' },
    { url: '000000-images.js', revision: 'v1' },
    { url: 'FF0000-images.js', revision: 'v1' },
    { url: 'FFA500-images.js', revision: 'v1' },
    { url: 'FFFF00-images.js', revision: 'v1' },
    { url: '008000-images.js', revision: 'v1' },
    { url: '0000FF-images.js', revision: 'v1' },
    { url: '800080-images.js', revision: 'v1' },
    { url: 'A52A2A-images.js', revision: 'v1' },
    { url: '808080-images.js', revision: 'v1' },
    // Fichiers CDN
    { url: 'tailwind.min.css', revision: 'cdn-v1' },
    { url: 'flowbite.min.css', revision: 'cdn-v1' },
    { url: 'jszip.min.js', revision: 'cdn-v1' },
    { url: 'FileSaver.min.js', revision: 'cdn-v1' },
    { url: 'openlocationcode.min.js', revision: 'cdn-v1' }
  ]);

  // 4. Logique de communication vers la page
  // Cet événement se déclenche quand le nouveau Service Worker prend le contrôle.
  self.addEventListener('activate', (event) => {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(windowClients => {
        // On parcourt toutes les fenêtres ouvertes de l'application
        windowClients.forEach(windowClient => {
          // Et on envoie un message contenant la nouvelle version
          windowClient.postMessage({
            type: 'VERSION_UPDATE',
            version: APP_VERSION
          });
        });
      })
    );
  });

} else {
  console.log(`Erreur critique : Workbox ou le fichier de version n'a pas pu être chargé.`);
}
