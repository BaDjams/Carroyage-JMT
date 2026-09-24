// version.js

// Source unique de vérité pour la version de l'application.
const APP_VERSION = '23.28';

// Une ligne courte par changement, telle que l'utilisateur la voit : ce qui change,
// sans le pourquoi ni le comment. Guillemets doubles : les apostrophes françaises
// s'écrivent telles quelles.
const CHANGELOG = [
  {
    version: "23.28",
    date: "2026-09-24",
    changes: [
      "Nouveau code de recréation, inscrit sur les images, dans le nom des fichiers et dans les fichiers KML, GeoJSON, GPX, CSV et MBTiles",
      "Nouveau champ « Code de recréation » en carroyage rapide et en export de zone, pour refaire une carte à l'identique",
      "En export de zone, un même code sert pour tous les carroyages : CADO, UTM, MGRS, CFSI ou DFCI",
      "Format du code au choix, base32 ou base64, dans la fenêtre « Gestion ⚙️ », renommée « Réglages »",
      "Correction du nom des fichiers vectoriels de l'export de zone en CADO",
    ],
  },
  {
    version: "23.27",
    date: "2026-09-24",
    changes: [
      "Nouvelle option « Ajouter les lignes de profondeur aquatiques » dans les trois modes, sur les côtes françaises",
      "Profondeurs comptées sous le zéro NGF, ou sous le zéro des cartes marines en saisissant son écart",
      "Correction : le numéro de version et les nouveautés ne s'affichaient plus",
    ],
  },
  {
    version: "23.26",
    date: "2026-09-24",
    changes: [
      "Carroyage rapide : option pour forcer le niveau de zoom de la carte, dans les options avancées",
    ],
  },
  {
    version: "23.25",
    date: "2026-09-23",
    changes: [
      "Images plus nettes, en carroyage rapide comme en export de zone",
      "Correction du calage de la carte sur un MBTiles qui n'a pas le zoom demandé",
    ],
  },
  {
    version: "23.24",
    date: "2026-09-22",
    changes: [
      "Nouveau fond « Lignes de profondeur (EMODnet) », libre de droits, sur les mers européennes",
      "Prise en charge des services cartographiques WMS",
    ],
  },
  {
    version: "23.23",
    date: "2026-09-21",
    changes: [
      "Le fond « Eaux intérieures (libre) » utilise le Plan IGN, en France uniquement",
      "Nouveaux fonds « Cartes marines SHOM (privé) », avec clé d'accès, et « SHOM INSPIRE (libre) »",
    ],
  },
  {
    version: "23.22",
    date: "2026-09-21",
    changes: [
      "Le fond « Eaux intérieures » est proposé à tous : sans licence i-Boating, il passe sur un fond libre",
      "Le nom du fond et le cartouche indiquent la source utilisée",
    ],
  },
  {
    version: "23.21",
    date: "2026-09-21",
    changes: [
      "Grille MGRS : coordonnées de bordure au format MGRS (« 31T BN 80 »)",
      "Grille MGRS : nom du carré de 100 km mieux placé",
    ],
  },
  {
    version: "23.20",
    date: "2026-09-21",
    changes: [
      "Nouveau fond « i-Boating Eaux intérieures », à usage privé, avec l'application i-Boating installée sur le poste",
    ],
  },
  {
    version: "23.19",
    date: "2026-09-18",
    changes: [
      "Cartouche DFCI : « 2 km + quarts » au lieu de « 1 km »",
      "Grille MGRS : coordonnées complètes en bordure",
    ],
  },
  {
    version: "23.18",
    date: "2026-09-18",
    changes: [
      "Grilles UTM et MGRS : les coordonnées de bordure suivent la couleur adaptative",
    ],
  },
  {
    version: "23.17",
    date: "2026-09-18",
    changes: [
      "Nouvelle couleur de carroyage « adaptative teintée », en jaune et violet",
    ],
  },
  {
    version: "23.16",
    date: "2026-09-18",
    changes: [
      "Nouvelle couleur de carroyage « adaptative » : claire sur fond sombre, sombre sur fond clair",
    ],
  },
  {
    version: "23.15",
    date: "2026-09-17",
    changes: [
      "CFSI : les cases colorées ne recouvrent plus la grille",
      "CFSI et DFCI : les étiquettes prennent la couleur de la grille",
      "Le cartouche indique la maille affichée",
      "Export de zone en CFSI : suppression d'un cartouche en double",
    ],
  },
  {
    version: "23.14",
    date: "2026-09-17",
    changes: [
      "Épaisseur du trait proportionnelle à la taille de l'image",
    ],
  },
  {
    version: "23.13",
    date: "2026-09-17",
    changes: [
      "Export de zone : nouveau carroyage DFCI, en image, KML/KMZ et MBTiles",
    ],
  },
  {
    version: "23.12",
    date: "2026-09-16",
    changes: [
      "Même cartouche en carroyage rapide et en export de zone",
      "Une adresse recherchée devient le nom de la carte",
      "Noms de fichiers harmonisés, sans caractères interdits",
    ],
  },
  {
    version: "23.11",
    date: "2026-09-16",
    changes: [
      "Correction : la page pouvait rester blanche au chargement",
      "L'application démarre hors connexion",
      "Correction : il fallait recharger deux fois pour obtenir une nouvelle version",
      "Notification de mise à jour rétablie",
    ],
  },
  {
    version: "23.10",
    date: "2026-09-16",
    changes: [
      "Export de zone : outil « Définir une zone autour d'un point », avec son rayon",
      "Dimensions affichées sur les côtés de la zone",
    ],
  },
  {
    version: "23.9",
    date: "2026-09-16",
    changes: [
      "Correction : tuiles OpenStreetMap bloquées sur certains réseaux",
      "Attribution des fonds de carte rétablie",
    ],
  },
  {
    version: "23.8",
    date: "2026-09-15",
    changes: [
      "Créateur MBTiles : gros volumes de tuiles désormais possibles sous Firefox",
    ],
  },
  {
    version: "23.7",
    date: "2026-09-15",
    changes: [
      "Créateur MBTiles : outil « Définir une zone autour d'un point », avec rayon réglable",
      "Dimensions affichées sur les côtés de la zone, mises à jour en direct",
    ],
  },
  {
    version: "23.6",
    date: "2026-09-07",
    changes: [
      "Nouveau champ « Coordonnées MGRS »",
      "Export de zone : nouvelle grille MGRS",
      "Correction des conversions UTM près de l'équateur",
      "Relief 3D hors connexion : altitudes du zoom 0 au zoom 12, sans réserver de niveaux de zoom",
    ],
  },
  {
    version: "23.5",
    date: "2026-07-23",
    changes: [
      "DualMaps mis à jour (version 9)",
    ],
  },
  {
    version: "23.4",
    date: "2026-07-23",
    changes: [
      "Clic droit sur la carte : « Voir sur Look Around (Apple) »",
    ],
  },
  {
    version: "23.3",
    date: "2026-07-23",
    changes: [
      "Export de zone : nouveaux formats « GeoTIFF UTM » et « DEM (ASTER) »",
    ],
  },
  {
    version: "23.2",
    date: "2026-07-16",
    changes: [
      "Nouveau format « GeoTIFF JPEG », plus léger",
    ],
  },
  {
    version: "23.1",
    date: "2026-07-21",
    changes: [
      "Créateur MBTiles : option « Inclure le relief 3D hors-ligne (MNT) »",
    ],
  },
  {
    version: "23.0",
    date: "2026-06-24",
    changes: [
      "Carroyage rapide : export GeoTIFF",
      "Correction : la version restait bloquée après une mise à jour",
    ],
  },
  {
    version: "22.23",
    date: "2026-06-23",
    changes: [
      "Ouverture des MBTiles de plus de 2 Go sous Chrome",
      "Export de zone : export GeoTIFF",
    ],
  },
  {
    version: "22.22",
    date: "2026-05-29",
    changes: [
      "Créateur MBTiles : tuiles sans perte de qualité",
    ],
  },
  {
    version: "22.21",
    date: "2026-05-28",
    changes: [
      "Créateur MBTiles : sur-zoom retiré",
      "Export de zone : pas d'image en sur-zoom",
    ],
  },
  {
    version: "22.20",
    date: "2026-05-28",
    changes: [
      "Indicateur « Sur-zoom » en orange au-delà du zoom natif du fond",
      "Images limitées au zoom natif du fond",
    ],
  },
  {
    version: "22.19",
    date: "2026-05-28",
    changes: [
      "Sur-zoom jusqu'au niveau 22 sur tous les fonds de carte",
    ],
  },
  {
    version: "22.18",
    date: "2026-05-28",
    changes: [
      "Liste des nouveautés : cliquer sur le numéro de version",
      "Bouton « Voir les nouveautés » dans la notification de mise à jour",
    ],
  },
  {
    version: "22.17",
    date: "2026-05-22",
    changes: [
      "Sur-zoom des MBTiles chargés jusqu'au niveau 22",
      "Corrections mineures",
    ],
  },
  {
    version: "22.16",
    date: "2026-05-21",
    changes: [
      "Nettoyage technique, sans changement visible",
    ],
  },
  {
    version: "22.15",
    date: "2026-05-18",
    changes: [
      "Tuiles MBTiles générées en JPEG",
      "Outil de diagnostic MBTiles",
    ],
  },
  {
    version: "22.14",
    date: "2026-05-11",
    changes: [
      "Chargement plus rapide",
      "Marqueurs de vérification d'adresses sur la carte",
    ],
  },
  {
    version: "22.13",
    date: "2026-04-20",
    changes: [
      "Clic droit sur la carte : Street View et DualMaps",
    ],
  },
  {
    version: "22.12",
    date: "2026-04-11",
    changes: [
      "Gros fichiers MBTiles pris en charge",
      "Nouveaux fonds Yandex Maps et IGN",
      "Corrections d'accessibilité",
    ],
  },
  {
    version: "22.10",
    date: "2026-04-08",
    changes: [
      "Export de zone avec rotation",
      "Boussole indiquant la déviation",
      "Correction : la déviation est appliquée aux exports KML/KMZ",
    ],
  },
  {
    version: "22.07",
    date: "2026-03-25",
    changes: [
      "Import de MBTiles de drones DJI",
      "Correction de l'affichage mobile du créateur MBTiles",
    ],
  },
  {
    version: "22.06",
    date: "2026-03-24",
    changes: [
      "MBTiles DJI en fond de carte",
      "Corrections diverses",
    ],
  },
];
