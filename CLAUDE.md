# Notes de travail — Carroyage-JMT

## Code de recréation partagé avec CadoTour

**Le code de recréation est UN format commun à Carroyage-JMT et à CadoTour**
(github.com/BaDjams/CadoTour). Le même code, écrit par l'un, doit donner
exactement la même grille dans l'autre. Les fichiers concernés : `seedManager.js`
(codec, lecture des fichiers, `RC_MAX_SCALE`) et `roundDeviation` / `wrapDeviation`
de `utilities.js` ici ; `gridRecreation.js` et `roundDeviation` / `MAX_SCALE` de
`carroyage.js` dans CadoTour.

État commun (format v3, depuis Carroyage-JMT v23.32 et CadoTour 1.53.161) :
- déviation au dixième de degré, `(déviation + 180) × 10` sur 12 bits ; échelle
  en mètres sur 16 bits puis un bit de demi-mètre ; les versions 1 (déviation au
  degré, échelle sur 17 bits) et 2 (sans le bit du demi-mètre) restent lues ;
  le champ de version (2 bits) n'a plus de valeur libre : une version 4 devra
  d'abord réserver de la place ;
- arrondi de la déviation : `Math.round(x × 10) / 10` D'ABORD, repli dans
  [-180, 180] seulement pour un angle qui en sort ;
- échelle de **0,5 à 65 535 m** par case, arrondie au demi-mètre
  `Math.round(x × 2) / 2` (`roundGridScale` ici, `roundScale` dans CadoTour), dans
  les deux applications, avec un message qui l'explique dès la saisie ;
- grille « centre » complétée d'un seul côté (lignes ajoutées ou retirées dans
  CadoTour) : A1 et le centre de rotation sont FIGÉS, seule l'étendue des cases
  change ; l'écart du centre au milieu des bornes est retenu dans `centerShift`
  { cols, rows } (demi-cases), A1 = centre − `gridCenterOffsetCells` ici,
  `centerOffsetCells` dans CadoTour ; valeur 7 du champ grille du code (bornes
  libres + écart sur 2 × 8 bits), 31 caractères base32 au plus ;
- décodage : une saisie de casse mêlée (hors i, l, o) est du base64 seulement,
  jamais relue en base32 — une faute dans un code base64 y serait passée ;
- PNG : une espace suit le code dans le chunk `tEXt` ; à la lecture, un code
  invalide est retenté privé de 1 à 4 caractères finaux (octets du CRC).

**Toute évolution de l'un de ces points se fait dans les DEUX dépôts, dans la
même passe**, avec une PR de chaque côté citant l'autre. CadoTour tire ses
fixtures (`test/fixtures/recreation/`) de ce dépôt, en exécutant sous Node
`seedManager.js`, `utilities.js` et `carroyageCado.js` : c'est ici que le format
fait référence. Avant de pousser, un contrôle croisé charge les fichiers
définitifs des deux dépôts côte à côte : codes aléatoires écrits et relus dans les
deux sens, arrondis au millième, PNG écrits par l'un et lus par l'autre. Aucun
écart n'est acceptable.

Tests : `node tools/test_code_recreation.mjs` (et `node tools/test_isobathes.mjs`).
Les fichiers du dépôt sont en fins de ligne CRLF.

## Encodeurs d'image par bandes partagés avec CadoTour

`imageStream.js` (PNG et JPEG écrits au fil de l'eau, pour l'export de zone par
bandes) est une COPIE CONFORME de `imageStream.js` de CadoTour : même corps, octet
pour octet, seul l'emballage diffère (script classique ici, module ES là-bas). Il
se régénère depuis la version de CadoTour, jamais à la main ; toute évolution se
fait dans les deux dépôts, dans la même passe. `node tools/test_image_stream.mjs`
compare les deux corps quand CadoTour est voisin (../VirtualTour). Même règle de
découpage (`zoneExportBands` ↔ `exportBands`) et même format d'impression
conseillé (`printSuggestion`) des deux côtés.

Tests de l'export par bandes : `node tools/test_image_stream.mjs`,
`node tools/test_geotiff_stream.mjs` (relecture par libtiff si Python et Pillow
sont installés), `node tools/test_zone_bands.mjs`.
