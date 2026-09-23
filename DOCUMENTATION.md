# Carroyage-JMT — Documentation technique

**Version applicative** : 22.12
**Public visé** : développeurs et mainteneurs du projet
**Date de mise à jour** : 2026-05-05
**Dépôt** : https://github.com/BaDjams/Carroyage-JMT — miroir GitLab : https://gitlab.example.com/org/Carroyage-JMT

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Stack technique](#2-stack-technique)
3. [Architecture générale](#3-architecture-générale)
4. [Modes opérationnels](#4-modes-opérationnels)
5. [Référence des fichiers](#5-référence-des-fichiers)
6. [Systèmes de carroyage](#6-systèmes-de-carroyage)
7. [Couches cartographiques](#7-couches-cartographiques-map-layersjs)
8. [Pipelines d'export](#8-pipelines-dexport)
9. [Street View & DualMaps](#9-street-view--dualmaps)
10. [Service Worker / PWA](#10-service-worker--pwa)
11. [Configuration & secrets](#11-configuration--secrets)
12. [Build & déploiement](#12-build--déploiement)
13. [CI/CD GitLab](#13-cicd-gitlab)
14. [Conventions de code et patterns](#14-conventions-de-code-et-patterns)
15. [Maintenance & évolutions](#15-maintenance--évolutions)
16. [Troubleshooting](#16-troubleshooting)

---

## 1. Vue d'ensemble

**Carroyage-JMT** (alias **CADO**) est une application web monopage (PWA) écrite en HTML/CSS/JavaScript pur, sans étape de bundling. Elle permet de générer des carroyages tactiques (grilles de référence) sur fond cartographique selon cinq systèmes de coordonnées (CADO, UTM, MGRS, CFSI, DFCI), de les exporter dans plusieurs formats (KML, KMZ, GeoJSON, GPX, CSV, MBTiles, PNG haute résolution), de prévisualiser en temps réel sur carte Leaflet et de fonctionner hors-ligne grâce à un service worker.

**Domaine d'usage** : opérations de terrain (sécurité civile, gendarmerie, drones DJI, recherches en zones étendues).

**URL de production** : https://app.example.com (déploiement Docker derrière nginx-proxy).

---

## 2. Stack technique

| Couche | Technologie |
|---|---|
| Front-end | HTML5, CSS3, JavaScript ES2017+ vanilla (pas de framework) |
| UI | Tailwind CSS (précompilé) + Flowbite + style.css |
| Cartographie | Leaflet 1.x + Leaflet.draw |
| SQLite navigateur | sql.js (WASM) — `sql-wasm.js` + `sql-wasm.wasm` |
| Compression | JSZip + FileSaver.js |
| Encodage géo | Open Location Code (Plus Codes) |
| PWA | Service Worker natif + manifest.json |
| Stockage local | localStorage (icônes POI) + OPFS (Origin Private File System) pour gros MBTiles |
| Build (icônes) | Python 3 + Pillow |
| Conteneurisation | nginx:alpine-slim (Docker) |
| CI/CD | GitLab CI (`docker:dind` + auto-deploy via push de tag) |

**Aucun gestionnaire de paquets JS** (pas de `package.json`). Toutes les libs tierces sont vendorées dans le repo.

---

## 3. Architecture générale

### 3.1 Structure SPA monolithique

`index.html` (~150 KB) contient toute l'UI dans un unique document. Les trois modes opérationnels sont des `<div>` cachés/affichés via JS :

```
#cado-mode-container       → Mode 1 (Carroyage rapide CADO)
#zone-mode-container       → Mode 2 (Export de zone)
#creator-mode-container    → Mode 3 (Créer MBTiles)
```

Le bouton de bascule porte un attribut `data-mode` lu par le routeur JS dans `index.html`.

### 3.2 Ordre de chargement des scripts

L'ordre dans `index.html` est important — plusieurs fichiers exposent des variables globales utilisées par les suivants :

```
1. version.js          → APP_VERSION
2. JSZip / FileSaver   → libs tierces
3. utilities.js        → fonctions partagées (rotation, conversions)
4. map-layers.js       → MAP_LAYERS, clés API
5. icons.js / icons-catalog.js → ICON_LIBRARY, ICON_CATALOG
6. carroyageCado.js    → générateur CADO + init Leaflet mode 1
7. carroyageCFSI.js    → CFSI_UTILS
7b. carroyageDFCI.js   → DFCI_UTILS, drawDfciGrid (s'appuie sur CFSI_UTILS pour la projection)
7c. adaptiveInk.js     → createGridInk, resolveStaticGridColor (couleur adaptative)
8. carroyageUTM.js     → WGS84_to_UTM, WGS84_to_MGRS
9. zoneDownloader.js   → orchestrateur mode 2
10. carroyageToMbtiles.js / carroyageToCSV.js → exports
11. seedManager.js     → encodage seeds
12. tileSource.js      → abstraction MBTiles/online
13. mbtilesCreator.js  → mode 3
14. settingsManager.js → gestion icônes utilisateur
15. imagetoprint.js    → export PNG haute résolution
```

### 3.3 État global (variables `window`)

| Variable | Rôle |
|---|---|
| `window.cadoMap`, `window.zoneMap`, `window.creatorMap` | instances Leaflet par mode |
| `window.userPOIs` | tableau des points d'intérêt utilisateur |
| `loadedCadoKmlFeatures`, `loadedZoneKmlFeatures` | features KML importées |
| `cadoKmlResources`, `kmlResources` | images embarquées dans KMZ importés |
| `currentIconLibrary` | bibliothèque d'icônes courante (modifiable) |
| `MAP_LAYERS`, `ICON_LIBRARY`, `ICON_CATALOG` | catalogues statiques |
| `CFSI_UTILS`, `DFCI_UTILS`, `WGS84_to_UTM`, `WGS84_to_MGRS` | namespaces de conversion |

### 3.4 Contrats inter-modules via le DOM

Plutôt que des imports/exports, les modules communiquent via des IDs DOM stables. Modifier ces IDs casse le couplage :

| ID / classe | Lecteur principal | Écrivain principal |
|---|---|---|
| `#decimal-coords`, `#dms-coords`, `#utm-coords`, `#mercator-coords` | carroyageCado.js | UI utilisateur |
| `#cado-interactive-map` | carroyageCado.js (init) | — |
| `#zone-interactive-map` | zoneDownloader.js | — |
| `#creator-interactive-map` | mbtilesCreator.js | — |
| `.grid-parameter` (classe) | carroyageCado.js (debounce 400ms) | UI |
| `.color-option[data-color][data-name]` | carroyageCado.js, zoneDownloader.js | — |
| `#settings-modal` | settingsManager.js | — |
| `.mbtiles-status-badge`, `.mbtiles-info-bar` | tileSource.js | — |
| `#cado-mbtiles-input`, `#zone-mbtiles-input` | tileSource.js | — |

---

## 4. Modes opérationnels

### Mode 1 — Carroyage rapide (CADO)

Génère un quadrillage CADO **centré sur un point unique** (lat/lon en décimal, DMS, DM, UTM, MGRS ou Mercator). Aperçu temps réel sur carte Leaflet, exports KML/KMZ/GeoJSON/GPX/CSV/PNG/MBTiles.

**Fichier pivot** : `carroyageCado.js` (~43 KB).

### Mode 2 — Export de zone

L'utilisateur dessine un rectangle (Leaflet.draw) ou importe un KML/KMZ existant. Génère plusieurs grilles superposées (UTM, MGRS, CFSI, DFCI ou CADO, au choix) sur la zone, gère les POI utilisateur.

**Fichier pivot** : `zoneDownloader.js`.

### Mode 3 — Créer MBTiles

Interface dédiée pour générer une base MBTiles (fond de carte tuilé hors-ligne) sur une zone et plage de zoom choisies. Utilise OPFS pour stocker > 100 000 tuiles sans saturer la RAM.

**Fichier pivot** : `mbtilesCreator.js` + `seedManager.js`.

---

## 5. Référence des fichiers

### 5.1 Scripts métier

#### `index.html` (~150 KB)

Shell SPA. Contient :
- la balise `<head>` avec les imports CSS
- les trois conteneurs `*-mode-container` cachés
- les modales (paramètres, aide, Street View, DualMaps)
- les boutons de mode et le routeur JS qui bascule l'affichage
- la logique Street View / DualMaps (clic droit → menu contextuel) — voir §9

> **Maintenance** : ce fichier est gros et monolithique. Toute modification structurelle nécessite une recherche sur `id=` ou `data-*` avant édition pour vérifier le couplage avec les autres scripts.

#### `utilities.js`

Fonctions transverses :
- **Numérotation cellules** : `letterToNumber(c)`, `numberToLetter(n)` — supporte indices négatifs (Z, Y, ..., A, B, ..., Y, Z) avec un saut au-dessus de 0
- **Indices de grille** : `generateIndices(start, end)` (saute 0), `getOffsetInCells(n)`, `getNextIndex(n)`
- **Géométrie cœur** : `calculateAndRotatePoint(colNumber, rowNumber, config, a1Lat, a1Lon)` — convertit coords cellule → lat/lon avec correction cosinus de latitude et rotation via matrice autour d'un pivot. La correction utilise `config.latitude` (centre) et **non** `a1Lat` pour éviter une asymétrie en bord de zone
- **Rendu canvas** : `drawLabelWithOutline()`, `drawSubdivisionKey()` — étiquettes avec contour et barre d'échelle
- **UI** : `downloadFile()`, `showError()`, `hideError()`
- **Ligne 2 du cartouche** : `cartoucheScaleLine({ gridKind, gridDetail, scale, layerShort, zoom })` — `gridDetail` porte la maille étiquetée des carroyages emboîtés, d'où « Carroyage CFSI 100 m »
- **Couleur des étiquettes de carroyage** : `gridLabelColors(hex)` → `{ fill, halo }` — texte de la couleur des traits, liseré noir ou blanc choisi par rapport de contraste WCAG 2 ; épaisseur du liseré `GRID_LABEL_HALO_RATIO` (25 % de la police). Utilisé par le CFSI et le DFCI
- **Épaisseur des traits** : `gridLineWidthPx(level, width, height, exportScale)` et `exportUpscaleFactor(height, upscaleEnabled)` — cf. § 8.4

> Toutes les rotations passent par cette fonction. Modifier les axes ou la convention demande beaucoup de précautions : les exports KML, l'aperçu Leaflet et le PNG haute résolution doivent rester cohérents.

#### `version.js`

```js
const APP_VERSION = '22.12';
```

**Source unique** de la version. Le `CACHE_NAME` du Service Worker (`cado-cache-vXX`) est en revanche **manuellement** synchronisé.

### 5.2 Systèmes de carroyage

#### `carroyageCado.js` (~43 KB)

Module le plus important. Génère le quadrillage CADO (cellules à origine A1, taille fixe).

**Fonctions principales** :
- `generateGrid()` — orchestrateur d'export (lit l'UI, dispatche selon format choisi)
- `getGridConfiguration(lat, lon)` — extrait config depuis l'UI
- `calculateGridData(config)` — géométrie : lignes, points, rotations, avec **cache** pour éviter les recomputations
- `updateCadoGridPreview()` — rendu Leaflet temps réel, **debounce 400 ms** via `schedulePreviewUpdate`
- `generateKML()`, `generateKMZ()` — exports avec génération inline d'icônes (lettres dessinées sur canvas pour KMZ)
- `generateGeoJSON()`, `generateGPX()`
- `handleCadoKmzFile()` — import KML/KMZ via JSZip, extrait images embarquées dans `cadoKmlResources.images`

**Algorithmes notables** :
- **Lettrage** : supporte sens ascendant/descendant, indices négatifs, double saisie (étiquettes en haut **et** à droite)
- **Choix de référence** : pivot à l'origine A1 ou au centre — recalcule symétriquement les coins
- **Rotation** : appliquée comme matrice finale après projection Mercator

#### `carroyageCFSI.js` (~14 KB)

Système CFSI français (Lambert II étendu / NTF, mailles 100 m). Le DFCI a son propre module, `carroyageDFCI.js`.

**Exports** :
- `CFSI_UTILS` (IIFE) avec : conversions WGS84 ↔ Lambert II-E, parsing de codes
- `drawCfsiGridOnCanvas(ctx, bbox, latLonToPixels, margin, fontSize, lineWidth)` — rasterise, dans l'ordre, les quadrants colorés des cases repères (polygones Lambert, sous les traits), les traits, puis les étiquettes. Le cartouche est le cartouche commun de l'export de zone, auquel la fonction rend la maille étiquetée (`"100 m"` ou `"2 km"`) pour sa ligne 2
- `drawTextWithOutline(ctx, text, x, y, outlineWidth, colors)` — étiquette avec liseré ; `colors` vient de `gridLabelColors`

**Algorithmes** :
- Helmert WGS84 → NTF : `DX=168, DY=60, DZ=-320`
- Lambert II-E : 6 itérations de raffinement de latitude (précision sub-métrique)
- Décodage : Lambert → carré 100 km (alphabet 13×20) → 20 km → 2 km → 100 m

#### `adaptiveInk.js`

Couleur adaptative du carroyage : le trait et les étiquettes prennent la couleur qui contraste le mieux avec le fond qu'ils recouvrent. Deux pastilles la proposent dans chaque palette, qui mettent une clé dans `grid-color` / `utm-grid-color` à la place d'un code hexadécimal :

| Pastille | Valeur | Encre claire (fond sombre) | Encre sombre (fond clair) | Seuil de bascule | Contraste au pire cas |
|---|---|---|---|---|---|
| adaptative | `adaptive` | `#FFFFFF` | `#0F0F0F` | 0,190 | 4,4:1 |
| adaptative teintée | `adaptive-color` | `#FFE800` | `#5B1478` | 0,226 | 3,0:1 |

La paire teintée contraste moins, mais ses deux teintes sont étrangères aux verts et aux bruns d'une vue aérienne. Les paires se règlent dans `ADAPTIVE_INKS` ; en ajouter une suffit à créer une pastille de plus.

**Exports** :
- `createGridInk(ctx, colorValue, alpha)` → encre commune aux deux cas (couleur fixe ou adaptative) : `strokeFor(points)`, `strokeWithAlpha(alpha, points)`, `colorAt(x, y)`, `labelColorsAt(x, y)`
- `isAdaptiveGridColor(value)`, `resolveStaticGridColor(value, fallback)` — repli pour les sorties sans fond

**Fonctionnement** :
- le fond **déjà dessiné** est réduit par `drawImage` vers un petit canvas (une case ≈ 1 % du grand côté, plafond 400 × 400), puis converti en luminance relative et lissé en 3 × 3 — un `getImageData` sur l'image pleine demanderait des centaines de Mo
- chaque trait reçoit un dégradé le long de son tracé, échantillonné à cette maille : la couleur se fond au lieu de sauter
- bascule au point d'équi-contraste WCAG 2 de la paire, calculé par `adaptiveLuminancePivot` : `√((Lclair + 0,05)(Lsombre + 0,05)) − 0,05`, et non 0,5 — dès le milieu de l'échelle des gris, un trait sombre contraste déjà mieux qu'un trait clair
- `createGridInk` doit être appelé **après** le fond et **avant** les grilles
- canvas « teinté » (tuile sans CORS) : `getImageData` échoue, l'encre retombe sur une couleur fixe avec un avertissement console
- sans pixels de fond — KML/KMZ, MBTiles, aperçu Leaflet — `resolveStaticGridColor` impose l'encre claire de la paire (blanc ou jaune)

**Ce que l'encre couvre** : traits et étiquettes des cinq carroyages (CADO, UTM/MGRS, CFSI, DFCI), désignateurs MGRS de 100 km, et coordonnées de bordure UTM/MGRS — celles-ci sont posées sur la marge blanche, où l'encre choisit son ton sombre ; en couleur fixe elles restent en noir, sans quoi une grille blanche les rendrait invisibles. Restent en couleurs fixes, car indépendants de la grille : cartouche, boussole, barre d'échelle, croix de référence, quadrants de la clé de subdivision CADO et des cases repères CFSI, tracés KML importés et points d'intérêt.

#### `carroyageDFCI.js`

Carroyage DFCI de la sécurité civile (Lambert II étendu, mailles 2 km et subdivision .1 à .5). Réutilise la projection de `CFSI_UTILS`, qui doit donc être chargé avant l'appel.

**Exports** :
- `DFCI_UTILS` (IIFE) : `codeFromLambert(x, y)`, `fromLatLon(lat, lon)` (ex. `KD40D7.1`), `buildGrid(bbox, {step, quarters})` — géométrie commune (lignes classées `100k`/`20k`/`2k`/`quarter`, étiquettes), `count2kCells(bbox)`, `pixelsPer2k(bbox, project)`
- `drawDfciGrid(ctx, bbox, project, style)` — rendu canvas commun à l'image et aux MBTiles ; le niveau de détail (subdivision / 2 km / 20 km) suit la taille à l'écran d'une maille de 2 km
- `drawDfciGridOnCanvas(ctx, bbox, latLonToPixels, margin, fontSize, lineWidth)` — même signature que la version CFSI ; rend comme elle la maille étiquetée (`"2 km + quarts"`, `"2 km"` ou `"20 km"`)
- **Rendu adaptatif** selon zoom : pleins codes (< 700 m), 100 m avec coloration (< 3500 m), 2 km au-delà

#### `carroyageUTM.js` (~27 KB)

Systèmes UTM (Universal Transverse Mercator) et MGRS, mailles 1 km, multi-zones.

**Exports** :
- `WGS84_to_UTM` (IIFE) avec `fromLatLon(lat, lon, forceZone)`, `toLatLon(...)`, `getUTMZoneLetter(lat)`
- `WGS84_to_MGRS` (IIFE) avec `fromLatLon(lat, lon, digits, spaced)`, `toLatLon(mgrsStr)`, `get100kID(...)`
- `generateUTMGrid()` — export KMZ avec POI
- `calculateGridForZoneStrip(..., labelMode)` — génère lignes par zone avec clipping ; `labelMode` vaut `'utm'` ou `'mgrs'` et ne change que l'étiquetage (+ `squareLabels` en MGRS)
- `createUTM_KML()` — organise lignes par zone et type (Easting/Northing)

**Algorithmes** :
- **Clipping multi-zones** : pour chaque zone dans la plage, lignes tronquées via Cohen-Sutherland (`clipLineToRect()`, `clipAxis()`)
- Limites de zones : tous les 6° de longitude, **avec exceptions Norvège/Svalbard** (zones 31V, 32V, 31X, 33X, 35X, 37X)
- False easting : 500 000 m ; false northing : 10 000 000 m (hémisphère sud)

### 5.3 Modules d'export

#### `carroyageToCSV.js` (~7.5 KB)

Export WKT (compatible Google Earth Pro, QGIS, ArcGIS).

```js
generateGridCSV(filename, useUtm, useCfsi, useCado, userPOIs, optionalCadoData)
```

- Mode 1 : reçoit `optionalCadoData = {config, gridData}` directement
- Mode 2 : lit l'UI via `getZoneCadoConfigAndBounds()`
- Sortie : WKT `LINESTRING` (lignes) + `POINT` (étiquettes/POIs)

#### `carroyageToMbtiles.js` (~16 KB)

Génère MBTiles (SQLite + tuiles PNG) pour drones DJI, zoom 17-19.

**Fonctions clés** :
- `generateMbtilesProcess(filename, useUtm, useCfsi, useCado, bbox, baseZoom, userPOIs, optionalCadoData, gridMode, useDfci)`
- `processZoomLevel(...)` — pour chaque niveau de zoom : trace tout sur canvas global puis découpe
- `sliceAndStore(db, sourceCanvas, zoom, globalNwPx, globalSePx)` — découpe canvas en tuiles 256×256, insertion SQL

**Conventions** :
- TMS : Y inversé (`tmsY = (1 << z) - 1 - y`)
- Limite : `maxCanvasSize = 8192 px` — alerte au-delà
- Pré-cache des images POI avant la boucle de zoom
- Fonctions de rendu **digitales** (sans halo) : `drawDigitalUtm()`, `drawDigitalCfsiStrict()`, `drawDfciGrid()` (module DFCI, `halo: false`), `drawDigitalCado()`, `drawDigitalKml()`, `drawDigitalPois()`

#### `imagetoprint.js` (~28 KB)

Export PNG haute résolution (impression).

- `generateImageToPrint()` — télécharge tuiles, dessine grille CADO, exporte PNG
- En mode "centre", recalcule un BBox **symétrique** autour du centre de la grille (gère les colonnes négatives correctement)
- `iterativeFetchTiles()` — fetch quadtree depth-first
- `drawSubdivisionKey()` — barre d'échelle, flèche nord, sous-grille tous les 50 px
- Deux chemins de tuiles : MBTiles (`tileSourceIsActive()`) ou provider en ligne

### 5.4 Mode 3 — création MBTiles

#### `mbtilesCreator.js` (~32 KB)

Interface Mode 3 (carte Leaflet + contrôles + barre de progression).

- `initCreatorMode()` — initialise la carte avec toutes les couches disponibles
- `updateCreatorUI()` — barre de progression + alertes (seuil **8000 tuiles** RAM, **100 000** avec OPFS)
- `checkOPFS()` — détecte le support du stockage privé navigateur
- `seedTiles(selectedBbox, selectedZoom)` — orchestre via `seedManager.js`
- Case « Inclure le relief 3D hors-ligne (MNT) » : ajoute les tuiles PNG Terrarium/AWS
  du MNT (passthrough sans recompression) dans le MÊME fichier que le fond de carte,
  mais dans une table SÉPARÉE `terrain_tiles` (même structure `zoom_level`,
  `tile_column`, `tile_row`, `tile_data`, même index unique), avec toute la pyramide
  du niveau 0 au niveau 12. Aucun niveau de zoom n'est donc réservé : le fond garde
  tous les siens, y compris le 12, une même clé z/x/y pouvant exister dans les deux
  tables sans collision. Métadonnées écrites : `mnt_storage=terrain_tiles`,
  `mnt_minzoom=0`, `mnt_maxzoom=12`, `mnt_encoding=terrarium` — lues par CadoTour,
  qui en fait sa source `raster-dem` en vue 3D.
  L'ancien format (`mnt_zoom=12`, MNT rangé dans `tiles` à la place du fond) n'est
  plus écrit, mais reste lu par CadoTour ; il n'est délibérément plus annoncé pour
  qu'une version ancienne ne prenne pas une tuile de fond du niveau 12 pour une
  carte d'altitude.

**Spécifique** : gestion projection EPSG:3395 pour Yandex (correction nécessaire), gestion QuadKey pour Bing.

#### `seedManager.js` (~8.6 KB)

Encodage compact (base64, 11 caractères) d'une configuration de carroyage pour partage par URL.

**Layout 8 octets** :
| Bits | Champ | Plage |
|---|---|---|
| 0–20 | latInt | 21 bits, ~11 m de précision |
| 21–42 | lonInt | 22 bits |
| 43–52 | scale/10 | 10 bits, max 10 230 m |
| 53–55 | type de grille | 3 bits |
| 56–59 | flags | swap axes, double entrée, sens lettrage, point de réf |

#### `tileSource.js`

Abstraction unifiée pour les tuiles : MBTiles vs en ligne.

- `tileSourceLoad(file)` — parse MBTiles (sql.js), extrait métadonnées + niveaux de zoom
- `tileSourceReadTile(x, y, z)` — query SQL → blob URL
- `tileSourceIsActive()`, `tileSourceGetZooms()`, `tileSourceGetBestZoom(targetZoom)`

Cache la base SQLite en variable de module `_tsDB`. Met à jour `.mbtiles-status-badge` et masque le sélecteur de provider en ligne quand un MBTiles est actif.

### 5.5 Orchestrateurs et helpers

#### `zoneDownloader.js`

Orchestrateur Mode 2 + utilitaires de tuiles partagés.

- `handleZoneVectorExport()` — lit la zone, dispatche selon le choix de grille (UTM/MGRS/CFSI/DFCI/CADO) et le format (KML/KMZ/GeoJSON/GPX/MBTILES/DEM)
- `generateZonePNG()` — rasterisation PNG
- POI : `addPointMode()`, `removePoint()`, `getUserPOIs()`
- KML : `handleZoneKmlFile()`, parsing
- Icônes : `getIconsSync()`, cache `cachedIconLibrary`
- Projections Yandex : `_yMerc3395()`, `_inverseMerc3395()`, `_latLonToTile3395()`

#### `settingsManager.js`

Gestion bibliothèque d'icônes utilisateur (modal #settings-modal).

- `initSettingsManager()` — init modal + persistance `localStorage['userIcons']`
- `renderSettingsTable()`, `saveSettingsFromTable()`
- Import/export JSON + drag-drop

### 5.6 Couches cartographiques

#### `map-layers.js`

Catalogue statique. Voir §7 pour la structure détaillée.

**Pattern de clés privées** — il porte aussi bien une clé d'accès réservée (IGN) que l'adresse d'un service local sous licence (i-Boating) :
1. `config.private.js` (gitignored) déclare `var IGN_PRIVATE_API_KEY`, `var MAPY_API_KEY`, `var GOOGLE_MAPS_API_KEY`, `var IBOATING_WMTS_URL`, `var SHOM_API_KEY`
2. `map-layers.js` a des **fallbacks** `if (typeof X === 'undefined') var X = '';`
3. Les couches avec `"requiresKey": "VAR_NAME"` sont **filtrées** dans `createBaseLayers()` si la variable est vide

> **Pourquoi `var` et non `const`** : `var` autorise la redéclaration entre `config.private.js` et `map-layers.js`. Avec `const`, redéclaration = erreur fatale.

### 5.7 Bibliothèques d'icônes

#### `icons.js`

Bibliothèque par défaut compacte (`ICON_LIBRARY` : 7 entrées : start, end, danger, info, camp, camera, star).

#### `icons-catalog.js` (~213 KB, généré)

Catalogue professionnel (ADVERSAIRE, JUDICIAIRE, etc.) **généré automatiquement** par `build_library.py`. Ne pas éditer à la main.

Format :
```js
ICON_CATALOG = [{ id, label, path: [...], category, url, scale, order }, ...]
```

#### `build_library.py`

Script Python (Pillow). Workflow :
1. Parcourt `icons/sticker/` récursivement
2. Optimise les PNG → `icons/sticks/` (64×64, RGBA)
3. Index chaque icône avec métadonnées
4. Écrit `icons-catalog.js`

**Exécution** : `python build_library.py` après ajout/modification d'icônes.

### 5.8 PWA

#### `manifest.json`

```json
{
  "start_url": "./index.html",
  "display": "standalone",
  "theme_color": "#3b82f6",
  "icons": [192×192, 512×512]
}
```

#### `sw.js` — Service Worker

Voir §10 pour la stratégie complète.

---

## 6. Systèmes de carroyage

### 6.1 CADO (système maison)

- **Origine** : cellule A1 placée par l'utilisateur (mode "origine") ou autour d'un point central (mode "centre")
- **Taille de maille** : configurable (défaut 10 m)
- **Numérotation** : lettres en X (A, B, ..., Z, AA, AB, ...), nombres en Y. Sens et axes interchangeables
- **Indices négatifs** : possibles, on saute 0 (..., -B, -A, A, B, ...)
- **Rotation** : libre, en degrés
- **Sortie** : KML, KMZ, GeoJSON, GPX, CSV, PNG, MBTiles

### 6.2 UTM

- **Maille fixe** : 1 km
- **Zones** : 6° de longitude, gestion multi-zones (clipping aux limites)
- **Étiquettes** : easting/northing en kilomètres
- **Exceptions** : Norvège (32V), Svalbard (31X, 33X, 35X, 37X)

### 6.3 MGRS

- **Géométrie** : strictement identique à la grille UTM (mailles 1 km, mêmes lignes)
- **Désignation** : zone + bande de latitude + carré de 100 km (2 lettres) + easting/northing tronqués, ex. `31U DQ 48251 11942`
- **Étiquettes de lignes** : deux derniers chiffres du kilomètre (00 à 99) ; le carré de 100 km lève l'ambiguïté — sur la carte. En **bordure** d'un export image, l'inscription donne la référence MGRS complète du niveau kilométrique : `31T BN 80`, soit zone, bande, carré de 100 km et kilomètre dans ce carré (le `80` de `31T BN 80546 27571`). Le carré est lu au bout de la ligne, là où l'inscription se pose, car une ligne assez longue traverse deux carrés. Helper `mgrsSquareDesignatorAt(lat, lon)` ; en UTM la bordure emploie le champ `fullName` des lignes (`31T 280`). La marge blanche est élargie de 45 % en MGRS pour loger ces inscriptions
- **Carrés de 100 km** : leurs limites sont tracées plus épaisses, et leur désignateur est écrit **au centre du carré**, entre ces lignes de force. Si ce centre sort de l'emprise exportée, il se replie sur le centre de la portion visible — sinon un carré entrevu porterait des lignes de force sans nom
- **Conversion** : `WGS84_to_MGRS.toLatLon()` renvoie le **coin sud-ouest** du carré désigné, avec sa taille (`precision`) — une référence tronquée désigne un carré, pas un point
- **Limites** : hors zones polaires (84° N à 80° S) ; le système UPS n'est pas géré

### 6.4 CFSI

- **Maille** : 100 m, nichée dans des carrés 2 km, 20 km, 100 km
- **Projection** : Lambert II étendu (NTF Helmert)
- **Code** : ex. `KH18A2` (carré 100 km + 20 km + 2 km + 100 m)
- **Usage typique** : forces de l'ordre (libellé de l'interface). Ne pas le confondre avec le DFCI (§ 6.5) : mêmes mailles, mais pas les mêmes alphabets de 100 km

### 6.5 DFCI (sécurité civile)

- **Usage** : référentiel de localisation des SDIS / CODIS, notamment pour les feux de forêt
- **Projection** : Lambert II étendu (EPSG:27572), origine de la grille X = 0, Y = 1 500 000
- **Carré de 100 km** : deux lettres (X puis Y) dans `ABCDEFGHKLMN` — I **et** J exclus, ce qui le distingue du CFSI
- **Carré de 20 km** : deux chiffres pairs (0, 2, 4, 6, 8), X puis Y
- **Carré de 2 km** : une lettre X dans `ABCDEFGHKL` puis un chiffre Y, ex. `KD42F7`
- **Subdivision** : `.5` pour le carré central de 1 km × 1 km ; `.1` à `.4` pour le reste de chaque quart, en sens horaire depuis le nord-ouest (`.1` NO, `.2` NE, `.3` SE, `.4` SO). Un quart est donc un carré de 1 km amputé du coin de 500 m que lui prend le carré central : une pièce en L de 0,75 km², et non un carré de 1 km. La maille **nommée** reste celle de 2 km, que la subdivision découpe
- **Affichage** : subdivision si une maille de 2 km mesure au moins 14 fois la taille de police à l'écran, codes 2 km s'ils tiennent dans leur maille, sinon codes 20 km
- **KML/KMZ** : dossiers séparés (lignes 100 km / 20 km / 2 km / subdivisions, étiquettes) ; la subdivision est omise au-delà de 2 500 mailles de 2 km
- **Référence** : définition IGN reprise par ol-ext ; codes vérifiés sur 40 centroïdes du fichier officiel data.gouv.fr « Carroyage DFCI (2 km) »

---

## 7. Couches cartographiques (`map-layers.js`)

### 7.1 Structure

```js
{
  id: "google_hybrid",          // identifiant interne
  name: "Google Hybrid",        // libellé UI
  maxZoom: 21,
  requiresKey: "GOOGLE_MAPS_API_KEY",  // optionnel
  layers: [                     // empilement de couches
    { url: "...", type: "xyz" | "quadkey" | "yandex" | "wms" }
    // wms : + layers (obligatoire), styles, format, transparent, version
  ]
}
```

### 7.2 Couches disponibles

| ID | Nom | Source | maxZoom | Clé requise |
|---|---|---|---|---|
| `ign_ign_hybrid` | Ortho IGN + Routes IGN | data.geopf.fr (public) | 19 | non |
| `ign_google_hybrid` | Ortho IGN + Routes Google | IGN + Google | 19 | non |
| `yandex_hybrid` | Yandex Hybride (FR) | maps.yandex.net | 18 | non |
| `bing_hybrid` | Bing Maps Hybride | virtualearth.net | 19 | non |
| `google_hybrid` | Google Hybrid | mt0.google.com | 21 | non |
| `google_hybrid_NOPOI` | Google Hybrid sans POI | mt0.google.com (apistyle) | 21 | non |
| `ign_scan_composite` | IGN Cartes (privé) | data.geopf.fr/private | 18 | `IGN_PRIVATE_API_KEY` |
| `ign_public_hybrid` | Plan IGN | data.geopf.fr | 19 | non |
| `mapy_outdoor` | Mapy.CZ Outdoor | api.mapy.com | 19 | `MAPY_API_KEY` |
| `inland_waters` | Eaux intérieures (i-Boating privé, sinon libre) | WMTS i-Boating local, sinon Plan IGN + OpenSeaMap | 17 (réglable) ou 19 | `IBOATING_WMTS_URL` (facultative) |
| `shom_raster` | Cartes marines SHOM (privé) | services.data.shom.fr (abonnement) | 18 | `SHOM_API_KEY` |
| `shom_inspire` | SHOM INSPIRE (libre) | services.data.shom.fr/INSPIRE | 18 | `SHOM_INSPIRE_LAYER` |
| `emodnet_bathy` | Lignes de profondeur (EMODnet) | OSM + WMS EMODnet | 19 | non |
| `osm_standard` | OpenStreetMap | tile.openstreetmap.org | 19 | non |

### 7.3 Ajout d'une couche

1. Ajouter une entrée à `MAP_LAYERS` dans `map-layers.js`
2. Si privée : ajouter un fallback `if (typeof X === 'undefined') var X = '';` en haut du fichier, et `requiresKey: "X"` dans l'entrée
3. Documenter la clé dans `config.private.js` (template à demander au mainteneur)

### 7.4 HERE Maps (différé)

Tâche en attente : ajout des couches HERE Maps dès qu'une clé sera obtenue sur platform.here.com.

```js
// Ajout futur :
// var HERE_API_KEY = '';
// Carto : https://maps.hereapi.com/v3/base/mc/{z}/{x}/{y}/png8?style=explore.day&apiKey=${HERE_API_KEY}
// Hybrid : https://maps.hereapi.com/v3/base/mc/{z}/{x}/{y}/png8?style=explore.satellite.day&apiKey=${HERE_API_KEY}
```

### 7.5 Eaux intérieures : i-Boating (privé) ou flux libre

Couche `inland_waters`, **toujours proposée** dans le sélecteur : elle bascule d'elle-même selon que le poste dispose ou non d'une licence i-Boating.

| État du poste | Nom affiché | Source | Export |
|---|---|---|---|
| `IBOATING_WMTS_URL` renseignée | Eaux intérieures (i-Boating, privé) | WMTS i-Boating local | interne seulement |
| variable absente ou vide | Eaux intérieures (libre) | OpenStreetMap + amers OpenSeaMap | sans restriction |

#### Avec licence — WMTS i-Boating local

**Même motif que la clé IGN privée** (`IGN_PRIVATE_API_KEY`, couche `ign_scan_composite`) : un accès réservé au poste qui en dispose — clé pour l'IGN, licence de service local pour i-Boating —, déclaré dans `config.private.js` et jamais dans le dépôt.

Le WMTS i-Boating (Windows/macOS) tourne **sur le poste** : l'application i-Boating télécharge au préalable les cellules couvrant la zone utile, puis le service expose un point d'entrée WMTS en local. L'application n'embarque **aucune tuile ni donnée i-Boating** : elle interroge ce service comme elle interroge l'IGN ou Google.

```js
// config.private.js
var IBOATING_WMTS_URL = 'http://127.0.0.1:8080/wmts/.../{z}/{x}/{y}.png';
var IBOATING_WMTS_MAXZOOM = 17;   // facultatif, 17 par défaut
```

Le gabarit accepte les deux formes d'URL que sert un WMTS :

- **RESTful** : `.../{TileMatrix}/{TileCol}/{TileRow}.png` → `.../{z}/{x}/{y}.png`
- **KVP** (comme l'IGN) : `...&TileMatrix={z}&TileCol={x}&TileRow={y}`

Relever la forme exacte, le `TileMatrixSet` et la plage de zooms dans le `GetCapabilities` du service local. Si la carte sort inversée verticalement, le service numérote ses lignes en TMS : écrire `{-y}` au lieu de `{y}`, Leaflet le gère nativement.

#### Sans licence — flux libre de droits

Aucune configuration : la couche sert le **Plan IGN v2** surmonté des **amers OpenSeaMap** (écluses, balisage, ouvrages), empilement à deux couches comme `ign_ign_hybrid`. Le Plan IGN rend canaux, écluses et cours d'eau bien plus lisiblement que l'OSM standard, au prix d'une emprise limitée à la France : ailleurs, les tuiles reviennent vides. Les images et MBTiles qui en sortent sont rediffusables en conservant les mentions affichées — IGN et OpenSeaMap (CC-BY-SA). C'est aussi ce que voit un poste dont le service i-Boating est simplement arrêté au démarrage de l'application : la bascule se joue sur la présence de la variable, pas sur la santé du service.

**Limites connues**

| Point | Conséquence |
|---|---|
| CORS (i-Boating) | Les exports (PNG, MBTiles, GeoTIFF) lisent les tuiles en `crossOrigin="Anonymous"`. Si le service local ne renvoie pas `Access-Control-Allow-Origin`, le fond s'affiche mais le canvas devient *tainted* et l'export échoue. Aucun relais n'est ajouté dans `sw.js` (contrairement aux tuiles Yandex, cf. §10.3) : la licence i-Boating exclut la rediffusion par cache ou par proxy. |
| CORS (OpenSeaMap) | Même mécanisme : si le serveur d'amers ne répond pas en CORS, l'export échoue alors que l'affichage fonctionne. À vérifier au premier export ; le fond Plan IGN, lui, est déjà éprouvé par les couches `ign_public_hybrid` et `ign_ign_hybrid`. |
| Couverture | i-Boating : hors des cellules téléchargées, tuiles vides. Plan IGN : France seulement. OpenSeaMap : amers jusqu'à z18, agrandis au-delà. |
| Contenu mixte | `http://127.0.0.1` est traité comme origine sûre par les navigateurs : une page servie en HTTPS peut l'appeler. Le même service en `http://` sur une autre machine du réseau serait bloqué. |
| Service arrêté en cours de session | Tuiles i-Boating manquantes sans message d'erreur : la bascule ne se rejoue pas à chaud, il faut recharger la page. |

**Conditions d'emploi**

La licence du WMTS i-Boating couvre un **usage privé interne**, exclut les sites et applications publics, et exclut la rediffusion du contenu cartographique — y compris depuis un cache ou via un proxy. L'état « privé » de la couche est donc réservé aux postes disposant de leur propre licence, et les images ou MBTiles qui en sont tirés restent internes ; l'état « libre » n'a aucune de ces restrictions. Pour un emploi diffusé à partir de cartes officielles, les IENC des autorités fluviales — [EuRIS](https://www.eurisportal.eu/enc) pour treize pays européens, VNF pour la France, ELWIS pour l'Allemagne — se téléchargent librement et se convertissent en MBTiles, que `tileSource.js` lit directement.

### 7.6 Cartes marines SHOM

Deux services distincts, sur le même hôte `services.data.shom.fr`, en Web Mercator uniquement :

| Couche | Service | Accès | Contenu |
|---|---|---|---|
| `shom_raster` | `https://services.data.shom.fr/<clé>/wmts` | abonnement ou convention | cartes marines scannées (`RASTER_MARINE`) |
| `shom_inspire` | `https://services.data.shom.fr/INSPIRE/wmts` | libre, sans clé | couches thématiques INSPIRE — liste réelle à relever, cf. ci-dessous |

**Même motif que la clé IGN privée** : la clé vit dans `config.private.js`, jamais dans le dépôt, et la couche reste masquée sans elle. Pour un service de l'État, l'accès aux cartes scannées se demande au SHOM ; le service INSPIRE, lui, ne sert pas ces cartes — seulement les données thématiques.

> **Ne pas attendre d'isobathes du service libre.** Le contenu exact du flux INSPIRE se relève avec `tools/ogc_layers.py` et n'a rien d'acquis : les lignes de profondeur relèvent selon toute vraisemblance des produits sous abonnement. Pour des isobathes libres de droits, voir la couche EMODnet en §7.7.

```js
// config.private.js
var SHOM_API_KEY = 'xxx';                              // service sous abonnement
var SHOM_RASTER_LAYER = 'RASTER_MARINE_3857_WMTS';     // facultatif, valeur par défaut
var SHOM_INSPIRE_LAYER = 'TCHR_3857_WMTS';             // couche INSPIRE voulue
```

**Relever les identifiants de couches**

Ils ne se devinent pas et changent d'un service à l'autre. `tools/ogc_layers.py` les imprime depuis le `GetCapabilities`, avec leur `TileMatrixSet` et leur plage de zooms :

```bash
python3 tools/ogc_layers.py                      # service INSPIRE, libre
python3 tools/ogc_layers.py --cle MA_CLE         # service sous abonnement
python3 tools/ogc_layers.py --filtre raster      # ne garde que ces couches
python3 tools/ogc_layers.py --fichier capa.xml   # parse un GetCapabilities déjà téléchargé
```

C'est pourquoi `SHOM_INSPIRE_LAYER` est **vide par défaut** : une couche absente du sélecteur vaut mieux qu'une couche qui ne renverrait que des tuiles vides. `SHOM_RASTER_LAYER` porte, lui, une valeur par défaut à confirmer au premier branchement.

**Conditions d'emploi**

Les contenus diffusés par le SHOM sont protégés : la consultation par ces services est prévue, l'extraction massive et la rediffusion ne le sont pas. Un export MBTiles d'une zone entière relève de l'extraction — à cadrer avec le SHOM, comme pour i-Boating (§7.5). La mention « © SHOM » s'affiche sur la carte et part dans le cartouche des images exportées.

**Portée**

Le SHOM couvre la mer, les estuaires et les approches, pas les canaux ni les rivières intérieures : ces couches complètent le fond « Eaux intérieures » (§7.5), elles ne le remplacent pas.

### 7.7 Lignes de profondeur EMODnet, et le type `wms`

Couche `emodnet_bathy` : fond OpenStreetMap surmonté des **isobathes EMODnet**, l'infrastructure bathymétrique européenne. Ces isobathes sont espacées de 50 m : pour des isobathes métriques, voir l'outil hors ligne du §7.8. Services OGC libres d'accès, donc exportables et rediffusables — contrairement au SHOM et à i-Boating. Couverture : mers européennes.

Les isobathes ne sont pas servies en tuiles pré-calculées mais en **WMS**, d'où un quatrième type de couche.

```js
{ url: "https://ows.emodnet-bathymetry.eu/wms", type: "wms",
  layers: "emodnet:contours", transparent: true }
```

| Champ | Rôle |
|---|---|
| `layers` | identifiant de couche du service (obligatoire) |
| `transparent` | `true` par défaut — une surcouche ne doit pas masquer le fond |
| `format` | `image/png` par défaut |
| `styles` | vide par défaut |
| `version` | `1.3.0` par défaut ; les versions 1.1.x disent `SRS` là où 1.3.0 dit `CRS`, `wmsTileUrl()` s'en charge |

**Un WMS ne se substitue pas comme un gabarit XYZ** : chaque tuile réclame l'emprise qu'elle couvre. C'est `tileUrlFor(layer, z, x, y)` dans `map-layers.js` qui la calcule (`tileBBox3857`) et compose le `GetMap`. Cette fonction est le **point de passage unique** de l'affichage et des **trois** chemins d'export (image, zone, MBTiles), qui refaisaient chacun la substitution `{z}/{x}/{y}` de leur côté : une couche WMS y serait sortie avec ses accolades intactes, donc affichable mais pas exportable. Le cas Yandex reste à part, sa reprojection EPSG:3395 demandant 1 à 2 tuiles source par tuile rendue.

L'identifiant `emodnet:contours` est surchargeable par `EMODNET_CONTOURS_LAYER`, et le service par `EMODNET_WMS`. S'il ne convenait pas, la couche dégrade proprement : le fond OSM reste, seules les isobathes manquent. Relever les identifiants réels :

```bash
python3 tools/ogc_layers.py --url https://ows.emodnet-bathymetry.eu/wms --filtre contour
```


### 7.8 Bathymétrie fine hors ligne : `tools/bathy_mbtiles.py`

Les isobathes EMODnet (§7.7) sont espacées de 50 m : trop lâche pour une embarcation ou un plongeur. Aucune source unique ne donne des isobathes métriques partout ; elles existent par morceaux — Litto3D au mètre sur la bande côtière, HOMONIM au large, levés au sondeur dans les ports — chacune dans son format et sa référence verticale. `tools/bathy_mbtiles.py` les assemble en **une seule carte d'isobathes**, écrite en MBTiles : lisible par l'application (mode MBTiles), par les drones DJI et par QGIS.

**Principe**

1. **Préparation**, une fois par source et mise en cache : lecture quel que soit le format, conversion dans la référence verticale de la carte, maillage des sondes éparses, rangement dans un GeoTIFF tuilé avec aperçus.
2. **Composition** de chaque tuile en Web Mercator : la source la plus fine l'emporte là où elle a des données, les autres comblent autour.
3. **Tracé honnête** : une isobathe n'est tracée qu'au pas que sa source sait porter — pas d'isobathe métrique inventée dans une grille de 100 m.

**Sources et formats**

| Source | Couverture | Résolution | Format | Système | Référence verticale |
|---|---|---|---|---|---|
| Litto3D (SHOM/IGN, licence ouverte) | bande côtière terre-mer, jusqu'à -10 m au moins | 1 m et 5 m | ESRI ASCII, dalles de 1 km² | Lambert-93 en métropole, sans `.prj` | IGN69 en métropole |
| MNT HOMONIM (SHOM, licence ouverte) | façades maritimes | ~100 m, ~20 m sur certains secteurs | ESRI ASCII, BAG, grille Surfer | WGS84 | NM ou ZH, selon le fichier |
| EMODnet DTM | mers européennes | ~115 m | NetCDF, ESRI ASCII | WGS84 | à lire dans sa fiche de métadonnées |
| GEBCO | monde | ~450 m | NetCDF, GeoTIFF | WGS84 | niveau moyen |
| swissBATHY3D (swisstopo) | lacs suisses, dont le Léman | grille fine | GeoTIFF | LV95 (EPSG:2056) | altitude du fond |
| Levés de sondes | ports, chenaux, lacs | selon le levé | texte x y z | à déclarer | à déclarer |
| Cartes S-57 (ENC, IENC) | selon la carte | sondes et isobathes | `.000` | WGS84 | ZH (marine), niveau local (fluvial) |

Tous les rasters passent par GDAL, embarqué dans `rasterio` : ESRI ASCII, GeoTIFF, NetCDF (la variable `elevation` est choisie seule, `variable = "..."` sinon), BAG, grilles Surfer. Deux formats demandent davantage, et l'outil les prend en charge lui-même :

- **Semis de sondes** : lecture tolérante (séparateur `;`, tabulation, espaces ou virgule détecté par essai, virgule décimale admise, en-têtes ignorés), puis **maillage par triangulation** : l'interpolation est linéaire dans chaque triangle, et un triangle dont une arête dépasse `arete_max` est écarté — on n'invente rien entre deux levés distants.
- **Cartes S-57** : les sondes (`SOUNDG`) et les isobathes cartographiées (`DEPCNT`, cote `VALDCO`) entrent comme points dans la même triangulation, ce que font les hydrographes pour contraindre une surface entre des sondes éparses. Les ENC du SHOM sont chiffrées (S-63) : inutilisables ici.

**Eaux intérieures.** Pour les rivières et canaux français, il n'existe pas de bathymétrie publique comparable : VNF publie le mouillage — le tirant d'eau admis par section —, pas un relevé du fond. Restent les lacs (swissBATHY3D pour le Léman), les cartes fluviales IENC qui portent des sondes, et surtout les levés au sondeur des équipes elles-mêmes, que l'outil lit directement en XYZ. Pour un lac, la profondeur se compte depuis le plan d'eau : `surface = 372.0` retranche cette cote aux altitudes du fond.

**Référence verticale**

Chaque source a son zéro, la carte a le sien (`reference`, ZH par défaut — celui des cartes marines, où les profondeurs sont les plus faibles qu'on rencontrera). Chaque valeur est ramenée à la carte par :

```
altitude carte = altitude source (ou - profondeur) - surface (lacs) + decalage + correction
```

| Référence | Où la rencontrer |
|---|---|
| ZH, zéro hydrographique | cartes marines, ENC, MNT HOMONIM « ZH » |
| NM, niveau moyen | MNT HOMONIM « NM », GEBCO |
| IGN69 | Litto3D et altitudes terrestres en métropole |
| LN02 | swissBATHY3D |
| plan d'eau | lacs, par `surface` |

Entre IGN69 ou le niveau moyen et le ZH, l'écart atteint **plusieurs mètres en zone de marée** — bien plus que le pas des isobathes. La valeur de `decalage` se relève pour le port le plus proche dans les Références Altimétriques Maritimes (RAM) du SHOM ; quand l'écart varie trop sur la zone, `correction` pointe une grille de décalages, ajoutée pixel à pixel (là où elle manque, la valeur devient absente plutôt que fausse). L'outil **avertit** pour toute source dont la référence diffère de celle de la carte sans décalage ni grille, ou n'est pas déclarée.

**Pas des isobathes**

- **Par zoom** — `intervalle` au zoom de détail, puis de plus en plus large en dézoomant. Pour `intervalle = 1` et un détail à z16 : z10 100 m · z11 50 · z12 20 · z13 10 · z14 5 · z15 2 · z16 et au-delà 1 m.
- **Par source** — pas minimal d'environ un cinquième de la résolution, jamais moins d'un mètre : 1 m pour Litto3D, 20 m pour une grille de 100 m, 100 m pour GEBCO. Un niveau n'est tracé que là où la source qui couvre le pixel sait le porter ; `pas_min` force une autre valeur.
- **Maîtresses** — 5 m pour un pas de 1 m, 10 m pour 2 ou 2,5 m… : épaissies et cotées à la française (« 2,5 »), sur un halo qui interrompt le trait, espacées et jamais en débord de tuile. Le zéro de la carte a un trait sombre et pas de cote.
- **Généralisation** — sous le zoom de détail, une boucle fermée de moins de 16 px (un écueil de quelques mètres) n'est qu'un point illisible et disparaît ; au zoom de détail elle reste, car une tête de roche est ce qu'un bateau doit voir.
- **Précision du tracé** — une isobathe tombe à 1/8 de pixel de sa place, soit une dizaine de centimètres au sol à z17 en Bretagne. Deux défauts de Pillow y sont neutralisés : il tronque les coordonnées et décentre les traits de largeur paire.

**Configuration**

Fichier TOML (ou JSON). Exemple commenté complet : `tools/exemples/bathy.toml`.

```toml
sortie = "bathy_zone.mbtiles"
reference = "ZH"
intervalle = 1
emprise = [-4.80, 48.25, -4.30, 48.45]

[rendu]
fond = "plan-ign"            # « aucun » : tuiles transparentes (drone, QGIS)

[[source]]
nom = "Litto3D"
fichiers = "litto3d/**/*.asc"
crs = "EPSG:2154"
reference = "IGN69"
decalage = 0.0               # IGN69 -> ZH, a relever dans les RAM du SHOM

[[source]]
nom = "Leve du port"
fichiers = "leves/*.xyz"
type = "sondes"
crs = "EPSG:4326"
valeurs = "profondeur"
reference = "ZH"
```

| Clé | Rôle |
|---|---|
| `sortie`, `nom` | fichier produit, nom affiché |
| `reference` | zéro des profondeurs de la carte |
| `intervalle` | pas au zoom de détail : 0,5 · 1 · 2 · 2,5 · 5 · 10… |
| `zoom_min`, `zoom_max`, `zoom_detail` | zooms produits ; défauts déduits de la source la plus fine |
| `emprise` | `[lon_min, lat_min, lon_max, lat_max]` — conseillée dès qu'une source couvre une façade |
| `surzoom` | limite les sources grossières à N zooms au-delà de leur résolution ; par défaut chaque source va jusqu'au zoom maximal, sans trou au large |
| `processus`, `max_tuiles`, `travail` | parallélisme, garde-fou de volume, dossier de cache |
| `[rendu]` `fond` | `aucun`, `plan-ign`, `ortho-ign`, ou un gabarit `{z}/{x}/{y}` |
| `[rendu]` `teintes`, `etiquettes` | bandes teintées (m), cotes des maîtresses |
| `[[source]]` `fichiers` | motif, `**` récursif accepté |
| `type` | `grille` (défaut), `sondes`, `s57` |
| `crs` | système imposé aux fichiers qui ne le portent pas |
| `valeurs` | `altitude` (défaut) ou `profondeur` |
| `reference`, `decalage`, `correction`, `surface` | conversion verticale, cf. ci-dessus |
| `pas_min`, `priorite`, `attribution` | pas minimal, ordre de superposition, mention |
| `variable`, `nodata` | NetCDF à plusieurs variables, valeur absente non déclarée |
| `colonnes`, `separateur`, `resolution`, `arete_max` | semis de sondes et S-57 |

Une clé inconnue est une erreur, pour qu'une faute de frappe (`decallage`) ne passe pas en silence.

**Utilisation**

```bash
pip install -r tools/requirements-bathy.txt
python3 tools/bathy_mbtiles.py bathy.toml --inventaire   # sources, pas, zooms, volumes : rien n'est produit
python3 tools/bathy_mbtiles.py bathy.toml                # produit le MBTiles
python3 tools/bathy_mbtiles.py bathy.toml --zoom-max 16 --processus 4 --emprise -4.8,48.25,-4.3,48.45
```

La préparation est gardée dans `<sortie>.travail/` et réutilisée tant que ni les fichiers ni les options de la source ne changent : on peut retoucher le rendu sans relire les sources. Le recensement s'interrompt dès que `max_tuiles` est dépassé, sans énumérer les zooms suivants.

**Dans l'application**

Le MBTiles se charge comme tout MBTiles (Carroyage rapide, Export de zone) : les exports carroyés se font par-dessus. Ses métadonnées reprennent celles de `carroyageToMbtiles.js` — `type = baselayer`, `version = 1.0`, `scheme = tms` — car les drones DJI refusent le type `overlay`. Avec `fond = "aucun"` les tuiles sont transparentes et la terre reste vide dans l'application : pour une carte autonome, cuire `plan-ign` ou `ortho-ign` dessous. La référence, le pas et la liste des sources sont inscrits dans les métadonnées (`bathy_reference`, `bathy_intervalle`, `bathy_sources`).

**Limites connues**

- **Raccords entre sources** : pas de fondu. Si deux sources divergent au raccord — dates de levé, références mal ajustées —, les isobathes s'y resserrent en une marche.
- **S-57** : la lecture passe par GDAL ; faute de pouvoir écrire un vrai `.000` depuis Python, elle est testée sur une GeoPackage aux mêmes classes d'objets.
- **Réseau** : aucun, sauf pour cuire un fond.

**Tests** : `python3 tools/test_bathy_mbtiles.py` — jeux synthétiques fidèles aux formats réels (ESRI ASCII Lambert-93 sans `.prj`, NetCDF, semis à virgule décimale, S-57), sans réseau.

---

## 8. Pipelines d'export

Toutes les exports passent par le même `gridData` (lignes + étiquettes) calculé une seule fois, puis dispatché.

### 8.1 KML / KMZ

- KML : XML simple
- KMZ : zip d'un KML + dossier `images/` (icônes des étiquettes générées sur canvas, lettres en gros)
- Préserve les sources KML importées (re-embed via JSZip)

### 8.2 GeoJSON / GPX

- GeoJSON : `FeatureCollection` de `LineString` + `Point`
- GPX : `<rte>` + `<wpt>` (compatible randonnée, navigateurs GPS)

### 8.3 CSV (WKT)

Format compatible QGIS/Google Earth Pro : une colonne `WKT` + colonnes label/type/etc.

### 8.4 PNG haute résolution

- Récupère les tuiles dans le BBox cible (online ou MBTiles)
- Trace la grille par-dessus
- Ajoute légende (échelle, nord)
- Adapte la largeur de trait à la taille de l'image livrée (ci-dessous)

**Épaisseur des traits** (`gridLineWidthPx`, `utilities.js`) — les listes « Épaisseur du trait » (valeurs 1, 2, 3) désignent un niveau, pas un nombre de pixels :

| Niveau | Norme (ISO 128-2, groupe 0,5, feuille A3) | Part du grand côté | Image 4K (3 840 px) |
|---|---|---|---|
| Fine | 0,25 mm | 0,06 % | 2,25 px |
| Moyenne | 0,5 mm | 0,12 % | 4,5 px |
| Épaisse | 1 mm | 0,24 % | 9,25 px |

- `px = mm × grand côté de l'image livrée / 420` (A3), arrondi au quart de pixel
- Planchers : 1 px pour le trait fin (plus fin, un trait pâlit sans s'amincir), puis ×1,5 au moins d'un niveau au suivant — une petite image donne 1 / 1,5 / 2,25 px
- L'agrandissement final en 2160 px de haut (case « upscale ») est inclus via `exportScale` : l'épaisseur est calculée pour l'image livrée, puis divisée par ce facteur sur le canvas de dessin
- Réglage centralisé : `GRID_LINE_WIDTH_MM`, `GRID_LINE_SHEET_MM`, `GRID_LINE_MIN_PX`, `GRID_LINE_MIN_STEP`
- Non concernés : l'aperçu Leaflet (1 / 2 / 3 px écran), les MBTiles (épaisseurs fixes, tuiles vues à l'écran) et le KML (largeur en pixels écran)

### 8.5 MBTiles (drone DJI)

- SQLite 3 (sql.js) en mémoire
- Tuiles PNG 256×256 transparentes (overlay)
- Convention TMS (Y inversé)
- Plage de zoom typique : 17-19
- Limite canvas : 8192 px (alerte au-delà)

### 8.6 Seeds

- Encodage 8 octets → 11 caractères base64
- Partage par URL : `?seed=<11chars>`

---

## 9. Street View & DualMaps

Ajouté récemment dans `index.html`. Clic droit sur la carte → menu contextuel :
- **Voir le Street View ici** : modal 360° via Google Maps JS API (si `GOOGLE_MAPS_API_KEY` présente) ou fallback iframe `output=svembed`
- **Voir sur DualMaps** : iframe vers `data.mapchannels.com/dualmaps9/` (v9 depuis v23.5 — mêmes paramètres d'URL que v8, vérifié compatible)
- **Voir sur Look Around (Apple)** : nouvel onglet vers `lookmap.skzk.dev` (site tiers non officiel, pas d'embed iframe fiable)

### 9.1 Architecture

- **Backdrop** + **modal** en z-index 10001/10002 (inline `style="z-index:..."`, **pas** Tailwind `z-[...]` qui ne fonctionne pas en précompilé)
- **Boutons overlay** (✕ et 📷) : centrés en haut, déplacés dynamiquement dans `document.fullscreenElement` lors du `fullscreenchange` natif de Google
- **Mode JS API** : `StreetViewService.getPanorama()` + `StreetViewPanorama` + minimap Google liée (`map.setStreetView(panorama)` → flèche bleue tournant en live)
- **Mode iframe** : pas de minimap, capture impossible

### 9.2 Capture d'écran

`getDisplayMedia` + crop via `getBoundingClientRect()` sur canvas. Boutons overlay masqués pendant la capture (2 rAF avant snapshot).

### 9.3 Iframe DualMaps en mode sombre

Astuce : `color-scheme: light; background: white` sur l'iframe → force un fond blanc, contourne le rendu noir-sur-noir des liens.

---

## 10. Service Worker / PWA

### 10.1 Stratégie de cache

`sw.js` :
- **CACHE_NAME** : `cado-cache-v36` — **à incrémenter manuellement** à chaque release qui change la liste d'assets ou un fichier critique
- `ASSETS_TO_CACHE` : liste exhaustive des fichiers à pré-cacher à l'install
- Stratégie par défaut : **cache-first, falling back to network**

### 10.2 Exceptions de cache

Le SW **ignore** (laisse le réseau gérer) les requêtes vers :
- `google.com`, `geopf.fr`, `openstreetmap`, `virtualearth` (tuiles cartographiques — sinon explosion du cache)
- `data:`, `blob:`

### 10.3 Proxy CORS Yandex

Cas spécial : les tuiles Yandex sont relayées par le SW pour ajouter `Access-Control-Allow-Origin: *`. Sans ça, `canvas.drawImage()` les marque comme **tainted** et bloque les exports PNG/MBTiles.

```js
if (url.includes('maps.yandex.net')) {
  // fetch + ré-emballage avec headers CORS permissifs
}
```

### 10.4 Cycle de vie

- `install` : `skipWaiting()` + `cache.addAll(ASSETS_TO_CACHE)` (n'échoue pas si un fichier non critique manque)
- `activate` : supprime les anciens caches, `clients.claim()` → contrôle immédiat des onglets ouverts

### 10.5 Procédure de release

À chaque release modifiant le code :
1. Bumper `APP_VERSION` dans `version.js`
2. Bumper `CACHE_NAME` dans `sw.js` (`cado-cache-vXX` → `vXX+1`)
3. Ajouter d'éventuels nouveaux fichiers à `ASSETS_TO_CACHE`
4. Commit + push → CI déclenche le build Docker

> **Oublier le bump de cache** = utilisateurs bloqués sur l'ancienne version (PWA installée).

---

## 11. Configuration & secrets

### 11.1 `config.private.js` (gitignored)

Fichier **non commité** (cf. `.gitignore`). Template type :

```js
var IGN_PRIVATE_API_KEY = 'xxx';
var MAPY_API_KEY = 'xxx';
var GOOGLE_MAPS_API_KEY = 'xxx';

// Fond i-Boating : adresse du WMTS i-Boating lancé en local sur le poste.
// Couche masquée si absente. Usage privé interne — cf. §7.5.
var IBOATING_WMTS_URL = 'http://127.0.0.1:8080/wmts/.../{z}/{x}/{y}.png';
var IBOATING_WMTS_MAXZOOM = 17;

// Cartes marines SHOM : clé d'abonnement ou de convention, et identifiants de
// couches relevés avec tools/ogc_layers.py — cf. §7.6.
var SHOM_API_KEY = 'xxx';
var SHOM_RASTER_LAYER = 'RASTER_MARINE_3857_WMTS';
var SHOM_INSPIRE_LAYER = 'TCHR_3857_WMTS';

// Surcharges facultatives pour EMODnet (§7.7) : valeurs par defaut sinon.
var EMODNET_WMS = 'https://ows.emodnet-bathymetry.eu/wms';
var EMODNET_CONTOURS_LAYER = 'emodnet:contours';
```

### 11.2 Chargement gracieux

```html
<script src="config.private.js" onerror="console.warn('config.private.js absent')"></script>
```

Si le fichier est absent (ex: clone fraîche), l'app fonctionne en mode dégradé : les couches privées sont masquées, Street View bascule en iframe.

### 11.3 Important — historique purgé

Le fichier `config.private.example.js` a été **purgé de l'historique git** (filter-branch sur 733 commits, force-push sur GitHub et GitLab) car il contenait des clés réelles à un moment donné. Les clés concernées **ont été ou doivent être régénérées** :
- IGN privée : `SOqNaab...`
- Mapy : `68gdLOcv...`

> **Ne jamais commiter de clés**, même dans un fichier `.example`. Utiliser uniquement `config.private.js` (gitignored) en local.

---

## 12. Build & déploiement

### 12.1 Image Docker

```dockerfile
FROM nginx:alpine-slim
COPY . /usr/share/nginx/html
```

Image ultra-simple : nginx sert les fichiers statiques tels quels.

### 12.2 docker-compose.yml

```yaml
services:
  carroyage:
    image: registry.example.com/org/carroyage-jmt:<COMMIT_SHA>
    restart: always

  proxy:
    image: registry.example.com/infra/nginx-proxy:20260718.3
    restart: always
    ports: [443:443]
    environment:
      NGINX_SERVER_NAME: app.example.com
      NGINX_PROXY: http://carroyage:80
```

> Le tag d'image est mis à jour automatiquement par la CI à chaque build sur `main` (commit `[skip ci] Deploy image XXX`).

### 12.3 Lancer en local (développement)

Pas de build : ouvrir `index.html` derrière un serveur statique (le Service Worker exige HTTP, pas `file://`) :

```bash
# Option 1 : Python
python -m http.server 8080

# Option 2 : npx
npx serve .

# Option 3 : Docker local
docker build -t carroyage-local . && docker run -p 8080:80 carroyage-local
```

Puis ouvrir http://localhost:8080.

> En dev local, mettre les clés dans `config.private.js` à la racine (déjà gitignored).

---

## 13. CI/CD GitLab

### 13.1 Pipeline (`.gitlab-ci.yml`)

Deux stages, déclenchés **uniquement sur `main`** :

#### Stage `build` : `docker-build`
1. Build de l'image avec tag `<commit-short-sha>`
2. Push de l'image vers le registry GitLab (`registry.gitlab.com/...`)
3. Push aussi le tag `:latest`

#### Stage `deploy` : `docker-deploy`
1. Image alpine, installe `git`
2. Checkout du commit, hard-reset
3. **`sed`** : remplace dans `docker-compose.yml` l'ancien tag d'image par le nouveau `${CI_COMMIT_SHORT_SHA}`
4. Commit `[skip ci] Deploy image XXX` et push sur la branche d'origine

### 13.2 Conséquence pour les développeurs

Chaque push sur `main` génère **deux commits** dans l'historique GitLab :
- celui du dev
- celui de la CI (`[skip ci] Deploy image ...`)

Pour aligner GitHub et GitLab après une modif locale :
1. Push sur GitHub
2. Pull la branche depuis GitLab pour récupérer le commit `[skip ci]` de la CI
3. Re-push sur GitHub si besoin

Ou plus simple : **commits de dev sur GitHub, déploiement via push miroir sur GitLab**.

### 13.3 Branches

Depuis le nettoyage du 2026-05-05, **seule `main` existe sur GitLab**. Les anciennes branches obsolètes (`dev`, `test-GPT`, `merge-github-into-gitlab`, `CarroyageCADO_PWA`, `CarroyageCADO_PWA_Dev`) ont été supprimées.

`main` est protégée sur GitLab. Pour un force-push exceptionnel, il faut **déprotéger temporairement** la branche dans Settings → Repository → Protected Branches.

---

## 14. Conventions de code et patterns

### 14.1 Style JS

- ES2017+ vanilla, pas de transpilation
- IIFE pour les namespaces (`CFSI_UTILS`, `WGS84_to_UTM`)
- Globales `window.xxx` assumées (pas de modules ES)
- Commentaires en français

### 14.2 CSS

- **Tailwind précompilé** : les valeurs arbitraires `z-[10002]`, `bg-[#abc]` **ne fonctionnent pas** car le CSS est généré en build statique. Utiliser `style="z-index:10002"` inline
- `style.css` pour les overrides custom

### 14.3 Patterns récurrents

- **Debounce 400 ms** sur les changements de paramètres pour le preview Leaflet
- **Cache de calcul** : `gridData` mémoïsé tant que la config ne change pas
- **Canvas full-world** puis crop pour le rendu MBTiles (au lieu de calcul tuile par tuile)
- **`requiresKey`** : pattern de feature-flag pour les couches privées
- **TMS Y inversé** : convention systématique pour MBTiles

### 14.4 Convention de commit

Pas de Conventional Commits stricts, mais préfixes courants :
- `[skip ci] Deploy image XXX` — automatique CI
- `Update <fichier>` — modifs simples
- Messages descriptifs en français pour les features

---

## 15. Maintenance & évolutions

### 15.1 Tâches récurrentes

| Tâche | Fréquence | Procédure |
|---|---|---|
| Bump version + cache SW | À chaque release | §10.5 |
| Mise à jour libs tierces | Trimestriel | Remplacer les `.min.js` vendorés et tester |
| Régénération `icons-catalog.js` | Sur ajout d'icônes | `python build_library.py` |
| Audit des clés API | Semestriel | Vérifier quotas, régénérer si fuite |

### 15.2 Pour ajouter un mode

1. Créer un conteneur `<div id="newmode-mode-container">` caché dans `index.html`
2. Ajouter le bouton de mode avec `data-mode="newmode"`
3. Créer le module JS dédié (suivre l'archi `mbtilesCreator.js`)
4. Ajouter le script à `ASSETS_TO_CACHE` dans `sw.js` + bumper le cache

### 15.3 Pour ajouter un format d'export

1. Créer un fichier `carroyageToXxx.js` exposant `generateGridXxx(...)`
2. L'inscrire dans le dispatcher de `carroyageCado.js` (Mode 1) et/ou `zoneDownloader.js` (Mode 2)
3. Ajouter une option dans les radio buttons de l'UI (`zone-file-format` ou équivalent)
4. Cacher (`sw.js`) + bumper

### 15.4 Pour ajouter un système de carroyage

1. Créer `carroyageXxx.js` exposant les fonctions de calcul + rendu canvas
2. Ajouter les options UI (checkbox dans Mode 2)
3. Étendre les modules d'export (CSV, MBTiles, KML) pour le supporter

### 15.5 Évolutions souhaitables

- **Découper `index.html`** : actuellement monolithique. Une approche template (HTML imports natifs ou simple concat de fragments) faciliterait la maintenance
- **Tests** : seul l'outil bathymétrique en a (`tools/test_bathy_mbtiles.py`) ; l'application elle-même n'a pas de test automatisé. Un harnais Playwright sur les exports core (KML, MBTiles) renforcerait la régression
- **Migration Tailwind JIT** : permettrait les classes arbitraires (`z-[xxxx]`)
- **Modules ES natifs** : remplacer les globales `window.xxx` par `import/export` quand on quittera la compatibilité totale (PWA installée)

---

## 16. Troubleshooting

### 16.1 Le Service Worker ne met pas à jour

**Symptôme** : modifs invisibles après push, même après refresh.
**Cause** : `CACHE_NAME` non bumpé.
**Solution** : incrémenter `cado-cache-vXX` dans `sw.js`, redéployer. Côté utilisateur : DevTools → Application → Service Workers → Unregister + hard refresh.

### 16.2 Tuiles Yandex en noir

**Cause** : SW pas activé (HTTP local sans hot-reload du SW), donc pas de proxy CORS.
**Solution** : recharger après activation du SW, ou désactiver Yandex en dev local.

### 16.3 Couche privée invisible

**Cause** : `config.private.js` absent ou clé vide.
**Solution** : créer le fichier à la racine ou utiliser une autre couche.

### 16.4 Export MBTiles tronqué / message "canvas trop grand"

**Cause** : zone × zoom dépasse 8192 px de canvas.
**Solution** : réduire la zone, baisser le zoom max, ou (à terme) implémenter un rendu par sous-régions.

### 16.5 Force-push GitLab refusé

**Cause** : branche `main` protégée.
**Solution** : déprotéger temporairement (Settings → Repository → Protected Branches), force-push, reprotéger.

### 16.6 Conflit après push CI

**Cause** : la CI a pushé un `[skip ci] Deploy image XXX` entre votre dernier pull et votre push.
**Solution** : `git pull --rebase gitlab main` avant le push.

### 16.7 Aperçu Leaflet figé

**Cause** : exception silencieuse dans `calculateGridData()` (souvent une rotation extrême ou des coords invalides).
**Solution** : ouvrir DevTools, regarder la console. La fonction est wrappée mais des erreurs peuvent passer.

### 16.8 KMZ exporté sans icônes

**Cause** : étiquettes générées en canvas mais ressources non embarquées (`cadoKmlResources.images` vide).
**Solution** : vérifier que `generateKMZ()` appelle bien `JSZip.file('images/...')` pour chaque étiquette.

### 16.9 `Tailwind z-[10002]` n'a pas d'effet

**Cause** : Tailwind est précompilé statique, pas JIT.
**Solution** : utiliser `style="z-index:10002"` inline.

---

## Annexe A — Glossaire

| Terme | Définition |
|---|---|
| **Carroyage** | Quadrillage de référence superposé à une carte |
| **CADO** | Système de carroyage maison (cellules à origine A1) |
| **CFSI** | Carroyage Français de Sécurité Incendie |
| **DFCI** | Défense de la Forêt Contre l'Incendie — carroyage de la sécurité civile |
| **UTM** | Universal Transverse Mercator (projection cartographique) |
| **MGRS** | Military Grid Reference System (désignation alphanumérique de la grille UTM) |
| **MBTiles** | Format SQLite pour bases de tuiles cartographiques (spec MapBox) |
| **OPFS** | Origin Private File System (stockage navigateur, hors quota localStorage) |
| **TMS** | Tile Map Service (convention de tuilage avec Y inversé) |
| **Plus Code** | Open Location Code, encodage compact de coordonnées |
| **POI** | Point Of Interest (marqueur utilisateur sur carte) |
| **PWA** | Progressive Web App |
| **WKT** | Well-Known Text (format texte de géométries) |

## Annexe B — Liens utiles

- IGN Géoplateforme : https://geoservices.ign.fr/services-web-experts
- Spec MBTiles : https://github.com/mapbox/mbtiles-spec
- Service Worker MDN : https://developer.mozilla.org/fr/docs/Web/API/Service_Worker_API
- Open Location Code : https://github.com/google/open-location-code
- sql.js : https://github.com/sql-js/sql.js
- Leaflet : https://leafletjs.com/

---

*Documentation générée en collaboration avec Claude (Anthropic). Mise à jour : 2026-05-05.*
