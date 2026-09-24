# Notes de travail — Carroyage-JMT

## Code de recréation partagé avec CadoTour

**Le code de recréation est UN format commun à Carroyage-JMT et à CadoTour**
(github.com/BaDjams/CadoTour). Le même code, écrit par l'un, doit donner
exactement la même grille dans l'autre. Les fichiers concernés : `seedManager.js`
(codec, lecture des fichiers, `RC_MAX_SCALE`) et `roundDeviation` / `wrapDeviation`
de `utilities.js` ici ; `gridRecreation.js` et `roundDeviation` / `MAX_SCALE` de
`carroyage.js` dans CadoTour.

État commun (format v3, depuis Carroyage-JMT v23.31 et CadoTour 1.53.158) :
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
