// version.js

// Source unique de vérité pour la version de l'application.
const APP_VERSION = '23.27';

const CHANGELOG = [
  {
    version: '23.27',
    date: '2026-09-24',
    changes: [
      'Nouvelle case « Ajouter les lignes de profondeur aquatiques » dans les trois modes — Carroyage rapide et Export de zone pour l\'image, Créer MBTiles pour les tuiles. L\'application va chercher elle-même, pour la zone voulue, les altitudes du RGE ALTI de l\'IGN, qui intègre le lidar bathymétrique Litto3D le long des côtes, et trace des isobathes au mètre : une ligne sur cinq épaissie et cotée, le zéro en trait fort. L\'équidistance s\'élargit d\'elle-même aux petites échelles pour rester lisible',
      'Référence : sans autre indication, les profondeurs sont comptées sous le zéro NGF, proche du niveau moyen de la mer, et non sous le zéro des cartes marines, plusieurs mètres plus bas en Manche et en Atlantique. Un champ facultatif reçoit l\'écart local du zéro hydrographique (Références Altimétriques Maritimes du SHOM) pour s\'y ramener. Le cartouche des images et les métadonnées du MBTiles disent toujours quel zéro a servi',
      'Couverture : la bande côtière levée au lidar, en métropole et outre-mer, en général jusqu\'à 10 à 20 m de fond. Au large, sur les lacs, dont le relief ne porte que la surface de l\'eau, et hors de France, aucune ligne n\'est tracée et le bilan de l\'export le dit. Connexion requise au moment de l\'export ; l\'outil hors ligne tools/bathy_mbtiles.py reste là pour les autres sources (levés au sondeur, HOMONIM, cartes S-57)',
      'Correction : depuis la version 23.26, le numéro de version et la liste des nouveautés ne s\'affichaient plus. Une apostrophe mal écrite dans cette liste empêchait son chargement ; le reste de l\'application n\'était pas touché',
    ],
  },
  {
    version: '23.26',
    date: '2026-09-24',
    changes: [
      'Carroyage rapide : nouvelle option « Niveau de zoom de la carte » dans les options avancées du carroyage. En « Automatique », rien ne change ; un zoom choisi est appliqué tel quel, ce qui permet de refaire une image identique à une précédente en reprenant le zoom inscrit dans son cartouche. Un rappel s\'affiche sous le bouton « Générer l\'image » tant qu\'un zoom est forcé',
      'Un zoom forcé que le fond ne fournit pas, absent du MBTiles chargé ou trop élevé pour la taille du carroyage est refusé avec un message qui dit quoi choisir, plutôt que remplacé en silence par un autre',
    ],
  },
  {
    version: '23.25',
    date: '2026-09-23',
    changes: [
      'Images plus nettes, en carroyage rapide comme en export de zone : les tuiles sont désormais collées pixel pour pixel, comme le fait MOBAC. Jusqu\'ici, chaque tuile était légèrement étirée ou décalée d\'une fraction de pixel au montage, ce qui recalculait tous les pixels et donnait un léger flou, en PNG comme en JPEG',
      'Avec « upscale » coché, l\'image n\'est plus agrandie qu\'une fois au lieu de deux, et la grille et ses étiquettes sont tracées directement à la taille finale au lieu d\'être agrandies après coup',
      'Carroyage rapide sur un MBTiles qui ne contient pas le niveau de zoom demandé : la carte, la grille et le géoréférencement GeoTIFF sont maintenant calés sur le zoom réellement utilisé',
    ],
  },
  {
    version: '23.24',
    date: '2026-09-22',
    changes: [
      'Nouveau fond « Lignes de profondeur (EMODnet) » : les isobathes de l\'infrastructure bathymétrique européenne, posées sur OpenStreetMap. Libres de droits, donc exportables et rediffusables, là où les cartes du SHOM et d\'i-Boating restent internes. Couverture : mers européennes',
      'L\'application sait désormais consommer un service WMS, et plus seulement des tuiles pré-calculées. Un WMS réclame l\'emprise de chaque tuile plutôt qu\'un simple numéro : le calcul est fait en un seul endroit, partagé par l\'affichage et par les trois chemins d\'export, qui refaisaient chacun le leur. Sans cela, la couche se serait affichée sans jamais s\'exporter',
      'Correction d\'une annonce erronée de la version précédente : le flux libre du SHOM n\'a jamais promis de lignes de profondeur — celles-ci relèvent des produits sous abonnement. L\'outil de relevé des couches, désormais tools/ogc_layers.py, interroge aussi bien un WMTS qu\'un WMS et dit ce qu\'un service offre réellement',
    ],
  },
  {
    version: '23.23',
    date: '2026-09-21',
    changes: [
      'Le fond « Eaux intérieures (libre) » s\'appuie désormais sur le Plan IGN plutôt que sur OpenStreetMap : canaux, écluses et cours d\'eau y sont nettement mieux dessinés, les amers OpenSeaMap restant par-dessus. Contrepartie assumée : le Plan IGN couvre la France, hors de quoi le fond revient vide',
      'Deux nouvelles couches pour les cartes marines du SHOM : « Cartes marines SHOM (privé) », qui demande une clé d\'abonnement ou de convention, et « SHOM INSPIRE (libre) », sans clé, pour les données thématiques que le SHOM ouvre — bathymétrie, trait de côte. Comme pour l\'IGN, la clé vit dans config.private.js et la couche reste masquée sans elle',
      'Les identifiants de couches du SHOM ne se devinent pas : tools/shom_layers.py les relève sur le service et donne la ligne à coller dans config.private.js. Le SHOM couvre la mer et les estuaires, pas les canaux : ces couches complètent le fond des eaux intérieures, elles ne le remplacent pas',
    ],
  },
  {
    version: '23.22',
    date: '2026-09-21',
    changes: [
      'Le fond « Eaux intérieures » est désormais proposé à tout le monde : sur un poste sans licence i-Boating, il bascule tout seul sur un flux libre de droits — OpenStreetMap surmonté des amers OpenSeaMap, qui portent les écluses, le balisage et les ouvrages. Jusqu\'ici, la couche disparaissait purement et simplement du sélecteur',
      'Le nom affiché dit lequel des deux on regarde, « Eaux intérieures (i-Boating, privé) » ou « Eaux intérieures (libre) », et le cartouche des images exportées reprend la source correspondante. Les images tirées du flux libre sont rediffusables, celles tirées d\'i-Boating restent internes',
      'La bascule se joue au chargement de la page, sur la présence de l\'adresse du service local dans config.private.js : un service i-Boating arrêté en cours de session donne des tuiles vides, il faut recharger pour repasser au flux libre',
    ],
  },
  {
    version: '23.21',
    date: '2026-09-21',
    changes: [
      'Grille MGRS : les inscriptions en bordure donnent enfin la référence du système, « 31T BN 80 » — zone, bande, carré de 100 km, puis le kilomètre dans ce carré, comme dans une référence complète « 31T BN 80546 27571 ». La version précédente y avait mis la coordonnée UTM, « 31T 280 », qui n\'est pas la notation du MGRS. Les lignes tracées sur la carte gardent, elles, les deux chiffres de la notation MGRS',
      'Le carré de 100 km est lu au bout de chaque ligne, là où l\'inscription se pose : une ligne assez longue traverse deux carrés, qui ne portent pas les mêmes lettres. La marge blanche s\'élargit en MGRS pour loger ces inscriptions plus longues',
      'Le rappel du nom de carré, « 31T BN » écrit sur la carte, se place désormais au centre du carré délimité par les lignes de force, et non au centre de sa seule portion visible. Quand ce centre sort de l\'image, il revient au centre de la portion visible, faute de quoi la carte porterait des lignes de force sans nom',
    ],
  },
  {
    version: '23.20',
    date: '2026-09-21',
    changes: [
      'Nouveau fond de carte « i-Boating Eaux intérieures », réservé à un usage privé : il affiche les cartes fluviales et lacustres servies par le WMTS i-Boating lancé sur le poste, pour les zones dont les cellules ont été téléchargées au préalable dans l\'application i-Boating. La couche n\'apparaît dans le sélecteur que si son adresse locale figure dans config.private.js — sans ce fichier, rien ne change',
      'Aucune tuile ni donnée i-Boating n\'est embarquée dans l\'application : elle interroge le service local du poste, comme elle interroge l\'IGN ou Google. La licence de ce service couvre un usage privé interne et exclut la rediffusion du contenu, cache et proxy compris : les images et MBTiles tirés de ce fond restent donc internes',
      'Si le service local ne renvoie pas les en-têtes CORS, le fond s\'affiche mais les exports image, MBTiles et GeoTIFF échouent. Aucun relais n\'a été ajouté pour contourner ce point, la rediffusion par proxy étant exclue par cette même licence. Les cartes officielles des eaux intérieures (IENC : EuRIS, VNF, ELWIS) restent l\'option sans restriction, converties en MBTiles',
    ],
  },
  {
    version: '23.19',
    date: '2026-09-18',
    changes: [
      'Cartouche du carroyage DFCI : en zoom rapproché, il annonçait « Carroyage DFCI 1 km » alors que le CFSI annonçait 2 km pour un carré portant le même genre de code. C\'était trompeur — un code comme « EG60H9 » désigne bien un carré de 2 km dans les deux systèmes. Le cartouche indique désormais « Carroyage DFCI 2 km + quarts »',
      'Le « 1 km » ne valait que pour le sous-carré central « .5 », seul vrai carré de 1 km sur 1 km. Les quarts « .1 » à « .4 » ne sont pas des carrés de 1 km : chacun est un quart amputé du coin de 500 m que lui prend ce carré central, soit une pièce en L de 0,75 km²',
      'Grille MGRS : les inscriptions en bordure de l\'image reprennent maintenant la coordonnée complète, « 31U 451 » comme en UTM, au lieu des deux derniers chiffres. Ces deux chiffres ne se lisent qu\'avec le désignateur de carré de 100 km, écrit sur la carte : en bordure, loin de lui, ils étaient inutilisables. Les lignes tracées sur la carte gardent la notation MGRS habituelle',
    ],
  },
  {
    version: '23.18',
    date: '2026-09-18',
    changes: [
      'Les coordonnées écrites en bordure de la grille UTM et MGRS suivent maintenant, elles aussi, la couleur adaptative : elles étaient restées en noir, seules étiquettes du carroyage à ne pas tenir compte de la couleur choisie. Posées sur la marge blanche, elles prennent le ton sombre de la paire — noir avec la pastille adaptative, violet avec la teintée, ce qui les accorde aux traits',
      'Avec une couleur fixe, ces coordonnées restent en noir : les faire suivre la couleur choisie donnait des coordonnées blanches, donc invisibles, sur la marge blanche d\'une grille blanche',
    ],
  },
  {
    version: '23.17',
    date: '2026-09-18',
    changes: [
      'Douzième couleur de carroyage, « adaptative teintée » : même principe que la couleur adaptative, mais en jaune sur les zones sombres et violet sur les zones claires, deux teintes étrangères aux verts et aux bruns d\'une vue aérienne. Le carroyage se distingue ainsi du paysage au lieu de s\'y fondre',
      'Le contraste y plafonne à 3,0 contre 4,4 pour la version en noir et blanc, dans le cas le plus défavorable : à choisir selon que l\'on cherche la lisibilité maximale ou un carroyage bien identifiable',
      'Sans fond à lire (KML, MBTiles, aperçu sur la carte), cette pastille utilise du jaune, là où la version en noir et blanc utilise du blanc',
    ],
  },
  {
    version: '23.16',
    date: '2026-09-18',
    changes: [
      'Nouvelle couleur de carroyage « adaptative », en plus des dix couleurs existantes : le trait et les étiquettes lisent le fond de l\'image et prennent la couleur qui s\'en détache le mieux — clairs sur un bois sombre, sombres sur une place en pierre claire. Une même image reste lisible d\'un bout à l\'autre',
      'Le passage d\'une couleur à l\'autre se fait en dégradé le long du trait, pour éviter les ruptures nettes. La bascule suit le calcul de contraste de la norme WCAG, et la lecture du fond est moyennée par zones (environ 1 % de la largeur de l\'image) pour qu\'un toit isolé ne fasse pas changer tout un trait',
      'Disponible en « Carroyage rapide » et en « Export de zone », pour les cinq carroyages (CADO, UTM, MGRS, CFSI, DFCI) et tous les formats image. Le KML, les MBTiles et l\'aperçu sur la carte n\'ont pas de fond à lire : ils utilisent du blanc',
    ],
  },
  {
    version: '23.15',
    date: '2026-09-17',
    changes: [
      'Carroyage CFSI : les cases colorées ne recouvrent plus les traits de la grille, et ne débordent plus les unes sur les autres — elles suivent désormais l\'inclinaison de la grille Lambert au lieu d\'être des rectangles droits',
      'CFSI et DFCI : les lettres et chiffres prennent la couleur choisie pour les traits, avec un liseré noir ou blanc selon celui qui contraste le mieux. Une grille claire choisie pour ressortir sur un fond sombre donne des étiquettes claires, lisibles elles aussi',
      'Export de zone en CFSI : l\'ancien cartouche propre au CFSI, resté dessous le cartouche commun et qui indiquait à tort « L93 », est supprimé',
      'Le cartouche annonce désormais la maille réellement écrite sur l\'image : « Carroyage CFSI 100 m » ou « Carroyage CFSI 2 km », et « Carroyage DFCI 1 km », « 2 km » ou « 20 km » selon la taille de la zone exportée',
    ],
  },
  {
    version: '23.14',
    date: '2026-09-17',
    changes: [
      'Épaisseur du trait adaptative : « Fine », « Moyenne » et « Épaisse » ne sont plus 1, 2 et 3 pixels fixes, mais une proportion de la taille de l\'image livrée. Le trait paraît aussi fin (ou aussi épais) sur une petite image que sur une image de 16 000 pixels',
      'Référence : norme ISO 128 (0,25 mm, 0,5 mm et 1 mm) sur une image imprimée en A3. Sur une image 4K, cela donne environ 2, 4,5 et 9 px ; un trait ne descend jamais sous 1 px, et chaque niveau reste visiblement plus épais que le précédent',
      'L\'agrandissement final en 2160 px de haut est désormais compté : il épaississait les traits après coup. Concerne le carroyage rapide et l\'export de zone en image (CADO, UTM, MGRS, CFSI, DFCI)',
    ],
  },
  {
    version: '23.13',
    date: '2026-09-17',
    changes: [
      'Export de zone : nouveau carroyage DFCI, le référentiel de la sécurité civile et des CODIS, à côté du CFSI, de l\'UTM, du MGRS et du CADO. Mailles de 100 km, 20 km et 2 km (codes du type « KD42F7 »), conformes au carroyage officiel publié sur data.gouv.fr',
      'Quand la zone est assez grande à l\'écran, chaque carré de 2 km montre aussi sa subdivision .1 à .5 : quatre quarts numérotés dans le sens horaire depuis le nord-ouest, et le carré central de 1 km en .5. Sur une grande zone, seuls les codes de 20 km restent affichés, pour rester lisibles',
      'Le DFCI est disponible pour tous les formats de l\'export de zone : image (PNG, JPEG, GeoTIFF), KML/KMZ (lignes et étiquettes rangées par dossier) et MBTiles. Le cartouche et le nom du fichier indiquent « DFCI »',
    ],
  },
  {
    version: '23.12',
    date: '2026-09-16',
    changes: [
      'Cartouche identique en « Carroyage rapide » et en « Export de zone » : nom de la carte, échelle avec fond et niveau de zoom, point d\'origine, et point de référence s\'il diffère de l\'origine. L\'export de zone en CFSI ou sans carroyage en reçoit un, lui qui n\'en avait aucun',
      'Une adresse recherchée devient le nom de la carte, repris dans le cartouche et dans le nom du fichier ; un nom saisi à la main n\'est jamais écrasé',
      'Noms de fichiers alignés sur ceux du carroyage rapide, et caractères interdits (« / » et « : » de la date) désormais remplacés',
    ],
  },
  {
    version: '23.11',
    date: '2026-09-16',
    changes: [
      'Correction du chargement bloqué : Leaflet et ses greffons (leaflet.wms, leaflet.draw) étaient téléchargés depuis unpkg.com et cdnjs.cloudflare.com à chaque ouverture. Ces scripts bloquent l\'affichage : dès que ces domaines étaient filtrés par un proxy, ou simplement lents, la page restait BLANCHE et l\'onglet tournait sans fin. Les bibliothèques sont désormais servies par l\'application elle-même (dossier vendor/), copies conformes de celles du CDN',
      'Conséquence : l\'application démarre enfin réellement hors-ligne. Ces fichiers échappaient au pré-cache du Service Worker, qui se disait « hors-ligne » sans pouvoir se lancer sans réseau',
      'Correction du conflit de version : le nouveau Service Worker prenait la main pendant le chargement de la page et effaçait l\'ancien cache au passage. L\'application affichait alors encore le numéro précédent, et il fallait recharger une deuxième fois pour obtenir la nouvelle version. Une page est maintenant servie d\'un bout à l\'autre par une seule version',
      'La notification de mise à jour fonctionne enfin : elle s\'appuyait sur la bibliothèque flowbite, dont seule la feuille de style était chargée — elle ne s\'affichait donc jamais. Elle propose désormais « Recharger » quand une version est prête, puis « Voir les nouveautés » une fois celle-ci installée',
    ],
  },
  {
    version: '23.10',
    date: '2026-09-16',
    changes: [
      'Export de zone : l\'outil « Définir une zone autour d\'un point » et son champ de rayon, jusqu\'ici réservés au créateur MBTiles, sont maintenant disponibles ici aussi — un clic pose un carré centré sur la position, redimensionnable à la volée sans repointer',
      'La zone porte ses cotes sur les quatre arêtes, chacune avec sa longueur réelle, et elles suivent le rectangle en direct : pendant le tracé comme pendant le déplacement ou le redimensionnement, sans attendre le clic sur « Save »',
    ],
  },
  {
    version: '23.9',
    date: '2026-09-16',
    changes: [
      'Conformité OpenStreetMap : l\'attribution des fonds de carte est de nouveau affichée sur les cartes, et l\'en-tête Referer n\'est plus supprimé — son absence faisait bloquer les tuiles OSM par le serveur (erreur « Access blocked ») sur les déploiements derrière un proxy durci',
    ],
  },
  {
    version: '23.8',
    date: '2026-09-15',
    changes: [
      'Actualisation des limites OPFS : le plafond de 8 000 tuiles du créateur MBTiles ne concerne plus Firefox, qui gère l\'OPFS depuis sa version 111. L\'avertissement nomme désormais la technologie manquante et renvoie vers un navigateur qui la gère',
    ],
  },
  {
    version: '23.7',
    date: '2026-09-15',
    changes: [
      'MBTiles Creator : nouvel outil « Définir une zone autour d\'un point » dans la barre de dessin — un clic sur la carte remplace le pointage par un carré centré sur la position, en plus du tracé de rectangle habituel',
      'Le champ « Rayon autour du point » (10 000 m par défaut, soit un carré de 20 × 20 km) redimensionne la zone à la volée sans avoir à repointer ; l\'emprise est calculée sur la sphère terrestre, donc un rayon de 10 km reste 10 km quelle que soit la latitude',
      'La zone sélectionnée porte désormais ses cotes directement sur les arêtes du rectangle, comme les mesures de forme de CadoTour : une étiquette par côté, posée au milieu de l\'arête et tournée dans son sens. Chaque côté porte sa longueur réelle, les arêtes nord et sud d\'une même zone ne mesurant pas tout à fait la même chose',
      'Les cotes suivent le rectangle EN DIRECT : pendant le tracé à la souris, et pendant le déplacement ou le redimensionnement en mode retouche — il n\'est plus nécessaire de cliquer sur « Save » pour connaître les dimensions. Les coordonnées NO/SE et le nombre de tuiles se recalculent en même temps',
      'L\'affichage texte « Dimensions : … » sous la carte disparaît, remplacé par ces cotes',
    ],
  },
  {
    version: '23.6',
    date: '2026-09-07',
    changes: [
      'Coordonnées : nouveau champ « Coordonnées MGRS » (options avancées) — conversion dans les deux sens avec tous les autres formats, précision de 1 m à 100 km selon le nombre de chiffres saisis (formats « 31U DQ 48251 11942 » et « 31UDQ4825111942 » acceptés)',
      'Export de zone : nouveau carroyage « Grille MGRS (1km) » — même quadrillage que la grille UTM mais désigné à la militaire (lignes numérotées sur 2 chiffres, désignateur du carré de 100 km au centre), disponible en image, KML/KMZ et MBTiles',
      'Correction UTM : la bande de latitude N (0° à 8° N) était traitée comme l\'hémisphère sud lors de la conversion UTM → WGS84, ce qui décalait de 10 000 km les conversions et les grilles proches de l\'équateur',
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
