// version.js

// Source unique de vérité pour la version de l'application.
const APP_VERSION = '23.6';

const CHANGELOG = [
  {
    version: '23.6',
    date: '2026-08-28',
    changes: [
      'Relief 3D hors-ligne (MNT) : le fichier .mbtiles contient désormais une pyramide d\'altitude COMPLÈTE du niveau 0 au niveau 12, rangée dans une table séparée (`terrain_tiles`) au lieu d\'un seul niveau pris dans les tuiles du fond',
      'Conséquence directe : cocher « Inclure le relief 3D hors-ligne » ne réserve plus AUCUN niveau de zoom. Les niveaux 0 à 12 redeviennent sélectionnables pour le fond de carte, et le zoom 12 peut contenir à la fois du fond et du relief',
      'Conséquence dans CadoTour : la vue 3D garde du relief en dézoomant et sur les tuiles lointaines, qui s\'aplatissaient jusqu\'ici faute de données d\'altitude aux niveaux inférieurs',
      'Les fichiers déjà produits (ancien format, métadonnée `mnt_zoom`) restent lus tels quels par CadoTour. Le nouveau format ne l\'écrit plus : une version ancienne de CadoTour annoncera simplement le relief indisponible, plutôt que de prendre une tuile de fond pour une carte d\'altitude',
    ],
  },
  {
    version: '23.5',
    date: '2026-07-23',
    changes: [
      'DualMaps mis à jour vers la v9 (data.mapchannels.com/dualmaps9), la v8 utilisée jusque-là étant obsolète — paramètres d\'URL inchangés (vérifiés compatibles)',
    ],
  },
  {
    version: '23.4',
    date: '2026-07-23',
    changes: [
      'Menu clic-droit sur la carte : nouvelle option « Voir sur Look Around (Apple) » (via lookmap.skzk.dev), en plus de Street View et DualMaps',
    ],
  },
  {
    version: '23.3',
    date: '2026-07-23',
    changes: [
      'Export de zone : nouveau format « GeoTIFF UTM » — image reprojetée dans la zone UTM locale (compressée JPEG, fichier .tif unique), en plus du GeoTIFF EPSG:3857 existant',
      'Fichiers numériques (export de zone) : nouveau format « DEM (ASTER) » — modèle numérique de terrain ASTER GDEM V3 (~30 m/pixel) de la zone dessinée, au format ESRI ASCII Grid (.dem), via l\'API OpenTopography (clé gratuite requise dans config.private.js)',
    ],
  },
  {
    version: '23.2',
    date: '2026-07-16',
    changes: [
      'Nouveau format d\'export « GeoTIFF JPEG » (Carroyage rapide et Export de zone) : un seul fichier .tif géoréférencé EPSG:3857 mais compressé en JPEG — bien plus léger que le GeoTIFF standard non compressé, ouvrable directement dans QGIS/ArcGIS (disponible sans déviation/rotation)',
    ],
  },
  {
    version: '23.1',
    date: '2026-07-21',
    changes: [
      'MBTiles Creator : nouvelle option "Inclure le relief 3D hors-ligne (MNT)" — ajoute les tuiles Terrarium au zoom 12 dans le même MBTiles que le fond de carte (zooms 0-12 réservés, fond à partir du zoom 13), exploitable comme source raster-dem par des applications tierces (ex. CadoTour) sans connexion',
    ],
  },
  {
    version: '23.0',
    date: '2026-06-24',
    changes: [
      'Carroyage rapide : export GeoTIFF désormais disponible (image géoréférencée EPSG:3857, fichier .tif unique) ouvrable directement dans QGIS/ArcGIS — disponible sans déviation du carroyage',
      'Fix PWA : la version restait bloquée sur l\'ancien numéro après une mise à jour (le cache du Service Worker ré-enregistrait des fichiers périmés) — le pré-cache ignore désormais le cache HTTP',
    ],
  },
  {
    version: '22.23',
    date: '2026-06-23',
    changes: [
      'MBTiles volumineux (>2 Go) : ouverture désormais possible sous Chrome/Chromium grâce à une lecture paresseuse par plages d\'octets (moteur wa-sqlite), sans charger toute la base en mémoire — lève la limite ~2 Gio qui bloquait ces fichiers',
      'Export de zone : nouveau format GeoTIFF (image géoréférencée EPSG:3857, fichier .tif unique) ouvrable directement dans QGIS/ArcGIS — disponible sans rotation du fond de carte',
    ],
  },
  {
    version: '22.22',
    date: '2026-05-29',
    changes: [
      'MBTiles Creator : tuiles des couches simples stockées dans leur format natif, sans recompression (fin de la perte de qualité JPEG→JPEG)',
      'Le format réel (JPEG/PNG/WebP) est détecté et inscrit dans les métadonnées MBTiles',
    ],
  },
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
