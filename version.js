// version.js

// Source unique de vérité pour la version de l'application.
const APP_VERSION = '22.21';

const CHANGELOG = [
  {
    version: '22.21',
    date: '2026-05-28',
    changes: [
      'MBTiles Creator : sur-zoom retiré — le rendu reflète fidèlement les tuiles téléchargées',
      'Export de zone : génération d\'image désactivée en sur-zoom (warning affiché)',
    ],
  },
  {
    version: '22.20',
    date: '2026-05-28',
    changes: [
      'Indicateur de zoom bleu → orange "Sur-zoom : XX" quand le niveau dépasse le natif du layer',
      'Nouveaux fonds de carte IGN : Ortho IGN HD (zoom 20) et Plan IGN J+1 (mises à jour quotidiennes)',
      'Génération d\'image et export de zone cappés au zoom natif du provider (qualité préservée)',
    ],
  },
  {
    version: '22.19',
    date: '2026-05-28',
    changes: [
      'Sur-zoom universel jusqu\'au niveau 22 sur tous les fonds de carte (OSM, IGN, Google, Yandex, Bing…)',
      'Appliqué aux 3 cartes Leaflet : Carroyage rapide, Export de zone, MBTiles Creator',
    ],
  },
  {
    version: '22.18',
    date: '2026-05-28',
    changes: [
      'Changelog interactif : cliquer sur le numéro de version dans le titre pour consulter les mises à jour',
      'Bouton "Voir les nouveautés" dans la notification de mise à jour automatique',
    ],
  },
  {
    version: '22.17',
    date: '2026-05-22',
    changes: [
      'Sur-zoom des MBTiles chargés jusqu\'au niveau 22 (ré-échantillonnage Leaflet)',
      'Fix favicon 404 + normalisation des noms de fichiers PNG',
    ],
  },
  {
    version: '22.16',
    date: '2026-05-21',
    changes: [
      'Nettoyage dépôt : retrait des fichiers Docker et GitLab CI exclusifs au pipeline interne',
    ],
  },
  {
    version: '22.15',
    date: '2026-05-18',
    changes: [
      'Tuiles MBTiles générées en JPEG (meilleure compatibilité, taille réduite)',
      'Outil de diagnostic MBTiles intégré',
    ],
  },
  {
    version: '22.14',
    date: '2026-05-11',
    changes: [
      'Optimisations performances web (chargement différé, compression assets)',
      'Marqueurs de vérification d\'adresses BAN sur la carte',
    ],
  },
  {
    version: '22.13',
    date: '2026-04-20',
    changes: [
      'Intégration Street View (Google) depuis la carte via clic droit',
      'Lien DualMaps pour comparaison side-by-side',
    ],
  },
  {
    version: '22.12',
    date: '2026-04-11',
    changes: [
      'Support des grands fichiers MBTiles sans saturation RAM (mode OFPS)',
      'Intégration Yandex Maps + nombreuses nouvelles couches IGN',
      'Corrections d\'accessibilité (labels de formulaires)',
    ],
  },
  {
    version: '22.10',
    date: '2026-04-08',
    changes: [
      'Mode déviation : export de zone avec rotation personnalisée',
      'Boussole affichant la déviation réelle',
      'Fix export KML/KMZ : déviation appliquée à la géométrie du carroyage',
    ],
  },
  {
    version: '22.07',
    date: '2026-03-25',
    changes: [
      'Import de fichiers MBTiles depuis drones DJI (couche de base)',
      'Fix affichage carte mobile en mode MBTiles Creator',
    ],
  },
  {
    version: '22.06',
    date: '2026-03-24',
    changes: [
      'Couche MBTiles DJI passée en baselayer',
      'Corrections diverses (nommage fichiers, recherche)',
    ],
  },
];
