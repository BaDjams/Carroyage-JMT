// map-layers.js
// Les clés privées sont définies dans config.private.js (chargé avant ce fichier).
// Si config.private.js est absent ou vide, les variables sont vides ici par défaut
// et les couches privées sont simplement masquées (voir mapLayerAvailable plus bas).
const IGN_API_KEY = "ign_scan_ws";
if (typeof IGN_PRIVATE_API_KEY === 'undefined') var IGN_PRIVATE_API_KEY = '';
if (typeof MAPY_API_KEY === 'undefined') var MAPY_API_KEY = '';
if (typeof GOOGLE_MAPS_API_KEY === 'undefined') var GOOGLE_MAPS_API_KEY = '';
// Export .dem (ASTER GDEM V3) : clé gratuite sur portal.opentopography.org.
if (typeof OPENTOPOGRAPHY_API_KEY === 'undefined') var OPENTOPOGRAPHY_API_KEY = '';

// Fond i-Boating (eaux intérieures, lacs, rivières) — même motif que IGN_PRIVATE_API_KEY :
// un accès réservé au poste qui en dispose, déclaré dans config.private.js, jamais ici.
// Adresse du WMTS i-Boating
// exécuté EN LOCAL sur le poste (http://127.0.0.1:…). Aucune tuile, aucune donnée
// i-Boating n'est embarquée ici — seul le gabarit d'URL, laissé à config.private.js,
// active la couche, qui reste donc invisible pour un poste sans service local sous
// licence. Cette licence couvre un usage privé interne et exclut la rediffusion du
// contenu, y compris depuis un cache ou via un proxy : c'est pourquoi aucun relais
// CORS n'est prévu côté service worker pour cette couche. Cf. DOCUMENTATION.md §7.5.
if (typeof IBOATING_WMTS_URL === 'undefined') var IBOATING_WMTS_URL = '';
if (typeof IBOATING_WMTS_MAXZOOM === 'undefined') var IBOATING_WMTS_MAXZOOM = 17;

// Eaux intérieures : le fond i-Boating local quand le poste en dispose, sinon le
// Plan IGN sous les amers OpenSeaMap, libres de droits (FONDS_LEGACY_BASES,
// fonds.js). Cf. DOCUMENTATION.md §7.5.
const INLAND_LICENSED = !!IBOATING_WMTS_URL;

// Cartes marines SHOM — même motif que IGN_PRIVATE_API_KEY : les cartes scannées
// (RASTER_MARINE) sont sous abonnement ou convention, la clé vit dans
// config.private.js. Le WMTS libre du SHOM ne sert que les couches thématiques
// INSPIRE (bathymétrie, trait de côte…) : leur identifiant se relève sur le
// GetCapabilities du service (tools/ogc_layers.py), d'où une variable plutôt
// qu'un identifiant figé qui donnerait des tuiles vides. Cf. DOCUMENTATION.md §7.6.
if (typeof SHOM_API_KEY === 'undefined') var SHOM_API_KEY = '';
if (typeof SHOM_RASTER_LAYER === 'undefined') var SHOM_RASTER_LAYER = 'RASTER_MARINE_3857_WMTS';
if (typeof SHOM_INSPIRE_LAYER === 'undefined') var SHOM_INSPIRE_LAYER = '';

// Gabarit KVP commun aux deux services SHOM (Web Mercator uniquement).
const SHOM_WMTS = (base, layer) => `${base}?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile`
    + `&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=3857&FORMAT=image/png`
    + `&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;

// Bathymétrie EMODnet : infrastructure européenne, services OGC libres d'accès.
// Les isobathes sont servies en WMS, pas en tuiles pré-calculées, d'où le type
// « wms » ci-dessous. L'identifiant de couche se relève sur le GetCapabilities
// (tools/ogc_layers.py) : il est donc surchargeable sans toucher au code.
if (typeof EMODNET_WMS === 'undefined') var EMODNET_WMS = 'https://ows.emodnet-bathymetry.eu/wms';
if (typeof EMODNET_CONTOURS_LAYER === 'undefined') var EMODNET_CONTOURS_LAYER = 'emodnet:contours';

// Demi-circonférence terrestre en EPSG:3857, borne du monde tuilé.
const WEB_MERCATOR_R = 20037508.342789244;

// Emprise d'une tuile XYZ en EPSG:3857, dans l'ordre attendu par un BBOX WMS.
function tileBBox3857(z, x, y) {
    const cote = 2 * WEB_MERCATOR_R / Math.pow(2, z);
    const ouest = -WEB_MERCATOR_R + x * cote;
    const nord = WEB_MERCATOR_R - y * cote;
    return [ouest, nord - cote, ouest + cote, nord];
}

// URL GetMap d'une tuile pour une couche WMS. La tuile vaut 256×256 px, comme
// partout ailleurs dans l'application, et son emprise se calcule en 3857.
function wmsTileUrl(layer, z, x, y) {
    const version = layer.version || '1.3.0';
    const p = new URLSearchParams({
        SERVICE: 'WMS',
        REQUEST: 'GetMap',
        VERSION: version,
        LAYERS: layer.layers,
        STYLES: layer.styles || '',
        FORMAT: layer.format || 'image/png',
        TRANSPARENT: layer.transparent === false ? 'FALSE' : 'TRUE',
        WIDTH: 256,
        HEIGHT: 256,
        BBOX: tileBBox3857(z, x, y).join(','),
    });
    // WMS 1.3.0 dit CRS, les versions 1.1.x disent SRS.
    p.set(version.startsWith('1.3') ? 'CRS' : 'SRS', 'EPSG:3857');
    return layer.url + (layer.url.includes('?') ? '&' : '?') + p.toString();
}

// URL de la tuile (z, x, y) pour une couche du catalogue. Une seule définition
// partagée par l'affichage Leaflet et par les TROIS chemins d'export (image,
// zone, MBTiles), qui refaisaient chacun la même substitution de leur côté :
// une couche WMS y serait sortie avec ses {z}/{x}/{y} non substitués, donc
// affichable mais pas exportable. « yandex » n'est pas traité ici : sa
// reprojection EPSG:3395 demande 1 à 2 tuiles source par tuile rendue, pas une
// URL unique (cf. _yandexBands dans mbtilesCreator.js).
function tileUrlFor(layer, z, x, y) {
    if (layer.type === 'quadkey') {
        let quadKey = '';
        for (let i = z; i > 0; i--) {
            const mask = 1 << (i - 1);
            let digit = 0;
            if ((y & mask) !== 0) digit += 2;
            if ((x & mask) !== 0) digit += 1;
            quadKey += digit.toString();
        }
        return layer.url.replace('{q}', quadKey).replace('{s}', (x + y) % 4);
    }
    if (layer.type === 'wms') return wmsTileUrl(layer, z, x, y);
    // « arcgis-cache » n'a pas d'URL par tuile XYZ : chaque tuile se compose de
    // plusieurs tuiles du cache, reprojetées (cf. arcgisCache.js).
    if (layer.type === 'arcgis-cache') throw new Error('arcgis-cache : passer par agcDrawTile (arcgisCache.js)');
    return layer.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

// FONDS ET SURCOUCHES, comme dans CadoTour (github.com/BaDjams/CadoTour,
// map-layers.js et fondsModel.js) : un FOND est UNE image, satellite ou plan ; les
// routes et les noms qu'on posait autrefois dessus (« Ortho IGN + Routes Google »,
// « Google Hybrid »…) sont des SURCOUCHES (MAP_OVERLAYS, plus bas), cumulables sur
// n'importe quel fond. Empilement, du bas vers le haut : le fond, puis les
// surcouches, dans l'ordre du catalogue. Un .mbtiles chargé remplace l'un et les
// autres, à l'écran comme à l'export (tileSource.js). Choix et menu : fonds.js.
//
// « kind » : 'sat' (image aérienne) ou 'carto' (plan) — les deux familles du menu.
// « shortName » : nom court pour le cartouche des images exportees, ou la place
// manque (« 1 carre = 10m, OSM z16 ») ; fond et surcouches s'y suivent
// (« Ortho IGN + Google »). Le « name » complet reste celui du menu.
// « attribution » : mention affichee sur la carte (Leaflet accepte du HTML). La
// politique d'usage des tuiles OSM impose « © les contributeurs OpenStreetMap »
// visible sur la carte ; son absence est un motif de blocage manuel. Les guillemets
// internes sont SIMPLES : la valeur est elle-meme une chaine JS entre guillemets doubles.
// « requiresKey » : nom de la variable globale (config.private.js) sans laquelle
// l'entree n'est pas proposee.
const IGN_ATTRIBUTION = "&copy; <a href='https://www.ign.fr/' target='_blank' rel='noopener'>IGN</a>";
const OSM_ATTRIBUTION = "&copy; les <a href='https://www.openstreetmap.org/copyright' target='_blank' rel='noopener'>contributeurs OpenStreetMap</a>";
const GEOPF_WMTS = (layer, format) => `https://data.geopf.fr/wmts?Layer=${layer}&Style=normal&TileMatrixSet=PM`
    + `&SERVICE=WMTS&REQUEST=GetTile&Version=1.0.0&FORMAT=${format}&TileMatrix={z}&TileCol={x}&TileRow={y}`;
const GOOGLE_NOPOI = '&apistyle=s.t%3a2|s.e%3al|p.v%3aoff';

const MAP_LAYERS = [
    // ---- Satellite ----
    {
        // L'orthophoto seule : routes et noms de l'IGN ou de Google se posent
        // dessus en surcouche. L'ancien fond par défaut, « Ortho IGN + Routes
        // Google », est ce fond sous la surcouche « Routes Google ».
        "id": "ign_ortho",
        "kind": "sat",
        "name": "Ortho IGN",
        "shortName": "Ortho IGN",
        "attribution": IGN_ATTRIBUTION,
        "maxZoom": 19, // plafond du service WMTS IGN
        "layers": [
            { "url": GEOPF_WMTS('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), "type": "xyz" }
        ]
    },
    {
        // Les images seules (lyrs=s) : l'ancien « Google Hybrid » est ce fond sous
        // la surcouche « Routes Google + POI ».
        "id": "google_satellite",
        "kind": "sat",
        "name": "Google Satellite",
        "shortName": "Google Sat",
        "attribution": "&copy; Google",
        "maxZoom": 21,
        "layers": [
            { "url": "https://mt0.google.com/vt/lyrs=s&hl=fr&x={x}&y={y}&z={z}", "type": "xyz" }
        ]
    },
    {
        // Images Yandex ; ses routes et noms en français sont la surcouche « Routes
        // Yandex » (même serveur, même projection : aucun décalage).
        "id": "yandex_satellite",
        "kind": "sat",
        "name": "Yandex Satellite",
        "shortName": "Yandex",
        "attribution": "&copy; Yandex",
        "maxZoom": 18,
        "layers": [
            { "url": "https://core-sat.maps.yandex.net/tiles?l=sat&x={x}&y={y}&z={z}&scale=1&lang=fr_FR", "type": "yandex" }
        ]
    },
    {
        // Routes et noms incrustés dans l'image : Bing ne sert pas de surcouche
        // transparente. Gardé tel quel, comme fond satellite.
        "id": "bing_hybrid",
        "kind": "sat",
        "name": "Bing Maps Hybride",
        "shortName": "Bing",
        "attribution": "&copy; Microsoft",
        "maxZoom": 19,
        "layers": [
            // 'h' devant {q} pour Hybrid, mkt=fr-FR pour le français
            { "url": "https://ecn.t{s}.tiles.virtualearth.net/tiles/h{q}.jpeg?g=12933&mkt=fr-FR", "type": "quadkey" }
        ]
    },
    // ---- Cartes ----
    {
        "id": "ign_public_hybrid",
        "kind": "carto",
        "name": "Plan IGN",
        "shortName": "Plan IGN",
        "attribution": IGN_ATTRIBUTION,
        "maxZoom": 19,
        "layers": [
            { "url": GEOPF_WMTS('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'), "type": "xyz" }
        ]
    },
    {
        // Pyramide composite IGN privée z6-17, puis Plan IGN public z18-19.
        "id": "ign_scan_composite",
        "kind": "carto",
        "name": "IGN Cartes (privé - multi-échelles)",
        "shortName": "IGN Cartes",
        "attribution": IGN_ATTRIBUTION,
        "requiresKey": "IGN_PRIVATE_API_KEY",
        "maxZoom": 18,
        "layers": [
            {
                "url": `https://data.geopf.fr/private/wmts?Layer=GEOGRAPHICALGRIDSYSTEMS.MAPS&Style=normal&TileMatrixSet=PM&SERVICE=WMTS&REQUEST=GetTile&Version=1.0.0&FORMAT=image/jpeg&TileMatrix={z}&TileCol={x}&TileRow={y}&apikey=${IGN_PRIVATE_API_KEY}`,
                "type": "xyz"
            }
        ]
    },
    {
        // Plan routier Google Maps classique (lyrs=m), sans imagerie.
        "id": "google_roadmap",
        "kind": "carto",
        "name": "Google Maps",
        "shortName": "Google Plan",
        "attribution": "&copy; Google",
        "maxZoom": 21,
        "layers": [
            { "url": "https://mt0.google.com/vt/lyrs=m&hl=fr&x={x}&y={y}&z={z}", "type": "xyz" }
        ]
    },
    {
        "id": "osm_standard",
        "kind": "carto",
        "name": "OpenStreetMap",
        "shortName": "OSM",
        "attribution": OSM_ATTRIBUTION,
        "maxZoom": 19,
        "layers": [
            { "url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png", "type": "xyz" }
        ]
    },
    {
        "id": "mapy_outdoor",
        "kind": "carto",
        "name": "Mapy.CZ Outdoor",
        "shortName": "Mapy.CZ",
        "attribution": "&copy; <a href='https://mapy.cz/' target='_blank' rel='noopener'>Seznam.cz</a>",
        "requiresKey": "MAPY_API_KEY",
        "maxZoom": 19,
        "layers": [
            { "url": `https://api.mapy.com/v1/maptiles/outdoor/256/{z}/{x}/{y}?apikey=${MAPY_API_KEY}&lang=fr`, "type": "xyz" }
        ]
    },
    {
        // Eaux intérieures sous licence : le WMTS i-Boating lancé en local (cartes
        // marines, lacs, rivières). Leaflet substitue {z}, {x} et {y} dans le gabarit
        // de config.private.js, ce qui couvre une URL RESTful (…/{z}/{x}/{y}.png)
        // comme une URL KVP (…&TileMatrix={z}&TileCol={x}&TileRow={y}). Service local
        // à l'arrêt ou cellules non téléchargées = tuiles vides. Sans licence, le
        // même usage passe par « Plan IGN » sous la surcouche « Amers OpenSeaMap »,
        // libres de droits (cf. FONDS_LEGACY_BASES, fonds.js).
        "id": "inland_waters",
        "kind": "carto",
        "name": "Eaux intérieures (i-Boating, privé)",
        "shortName": "i-Boating",
        "attribution": "&copy; i-Boating &mdash; usage privé interne",
        "requiresKey": "IBOATING_WMTS_URL",
        "maxZoom": IBOATING_WMTS_MAXZOOM,
        "layers": [
            { "url": IBOATING_WMTS_URL, "type": "xyz" }
        ]
    },
    {
        // Cartes marines scannées du SHOM. Sous abonnement ou convention : la couche
        // reste masquée tant que SHOM_API_KEY est absente de config.private.js.
        // L'identifiant de couche est à confirmer sur le GetCapabilities du service
        // (tools/ogc_layers.py) ; SHOM_RASTER_LAYER permet de le corriger sans
        // toucher au code.
        "id": "shom_raster",
        "kind": "carto",
        "name": "Cartes marines SHOM (privé)",
        "shortName": "SHOM",
        "attribution": "&copy; <a href='https://data.shom.fr/' target='_blank' rel='noopener'>SHOM</a>",
        "requiresKey": "SHOM_API_KEY",
        "maxZoom": 18,
        "layers": [
            { "url": SHOM_WMTS(`https://services.data.shom.fr/${SHOM_API_KEY}/wmts`, SHOM_RASTER_LAYER), "type": "xyz" }
        ]
    },
    {
        // Couches thématiques INSPIRE du SHOM : libres d'accès, sans clé. Leur
        // identifiant varie selon la donnée voulue (bathymétrie, trait de côte…),
        // d'où SHOM_INSPIRE_LAYER, vide par défaut : mieux vaut une couche absente
        // qu'une couche qui ne renverrait que des tuiles vides.
        "id": "shom_inspire",
        "kind": "carto",
        "name": "SHOM INSPIRE (libre)",
        "shortName": "SHOM INSPIRE",
        "attribution": "&copy; <a href='https://data.shom.fr/' target='_blank' rel='noopener'>SHOM</a>",
        "requiresKey": "SHOM_INSPIRE_LAYER",
        "maxZoom": 18,
        "layers": [
            { "url": SHOM_WMTS('https://services.data.shom.fr/INSPIRE/wmts', SHOM_INSPIRE_LAYER), "type": "xyz" }
        ]
    }
];

// Surcouches : sur fond TRANSPARENT, posées au-dessus du fond. Même structure que
// MAP_LAYERS. Deux surcouches d'un même `group` s'excluent (fondsToggleOverlay,
// fonds.js) : ce sont deux variantes du même dessin, qui se superposeraient en double.
const MAP_OVERLAYS = [
    {
        "id": "ign_routes",
        "name": "Routes IGN",
        "shortName": "IGN",
        "attribution": IGN_ATTRIBUTION,
        "maxZoom": 19,
        "layers": [
            { "url": GEOPF_WMTS('TRANSPORTNETWORKS.ROADS', 'image/png'), "type": "xyz" },
            { "url": GEOPF_WMTS('GEOGRAPHICALNAMES.NAMES', 'image/png'), "type": "xyz" }
        ]
    },
    {
        // Routes et étiquettes Google (lyrs=h), sans les points d'intérêt.
        "id": "google_routes",
        "group": "google_routes",
        "name": "Routes Google",
        "shortName": "Google",
        "attribution": "&copy; Google",
        "maxZoom": 21,
        "layers": [
            { "url": "https://mt0.google.com/vt/lyrs=h&hl=fr&x={x}&y={y}&z={z}" + GOOGLE_NOPOI, "type": "xyz" }
        ]
    },
    {
        // La même, avec commerces, restaurants et autres points d'intérêt.
        "id": "google_routes_poi",
        "group": "google_routes",
        "name": "Routes Google + POI",
        "shortName": "Google POI",
        "attribution": "&copy; Google",
        "maxZoom": 21,
        "layers": [
            { "url": "https://mt0.google.com/vt/lyrs=h&hl=fr&x={x}&y={y}&z={z}", "type": "xyz" }
        ]
    },
    {
        "id": "yandex_routes",
        "name": "Routes Yandex",
        "shortName": "Yandex",
        "attribution": "&copy; Yandex",
        "maxZoom": 18,
        "layers": [
            { "url": "https://core-renderer-tiles.maps.yandex.net/tiles?l=skl&x={x}&y={y}&z={z}&scale=1&lang=fr_FR", "type": "yandex" }
        ]
    },
    {
        // Amers, écluses et balisage, libres de droits (CC-BY-SA) ; tuiles jusqu'à z18.
        "id": "openseamap",
        "name": "Amers OpenSeaMap",
        "shortName": "OpenSeaMap",
        "attribution": "amers <a href='https://www.openseamap.org/' target='_blank' rel='noopener'>OpenSeaMap</a> (CC-BY-SA)",
        "maxZoom": 18,
        "layers": [
            { "url": "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", "type": "xyz" }
        ]
    },
    {
        // Lignes de profondeur EMODnet. Les isobathes arrivent en WMS transparent :
        // si l'identifiant de couche ne convient pas au service, le fond reste
        // visible plutôt qu'une carte blanche. Couverture : mers européennes.
        "id": "emodnet_contours",
        "name": "Lignes de profondeur (EMODnet)",
        "shortName": "EMODnet",
        "attribution": "bathym&eacute;trie <a href='https://emodnet.ec.europa.eu/en/bathymetry' target='_blank' rel='noopener'>EMODnet</a>",
        "maxZoom": 19,
        "layers": [
            { "url": EMODNET_WMS, "type": "wms", "layers": EMODNET_CONTOURS_LAYER, "transparent": true }
        ]
    },
    {
        // Atlas des anciennes carrières de l'Inspection générale des carrières
        // (Ville de Paris) : les planches au 1/1000, déjà assemblées et
        // géoréférencées par l'IGC, servies par le MapServer public de la Ville.
        // Son cache est en Lambert 93 : reprojeté dans le navigateur
        // (arcgisCache.js). Hors des zones de carrières, l'atlas est transparent
        // et le fond reste. Couverture : Paris et communes limitrophes sous-minées.
        "id": "igc_atlas",
        "name": "Carrières souterraines de Paris (atlas IGC)",
        "shortName": "Atlas IGC",
        "attribution": "carri&egrave;res <a href='https://www.paris.fr/pages/tout-savoir-sur-les-sous-sols-2317' target='_blank' rel='noopener'>Ville de Paris &ndash; IGC</a>",
        "maxZoom": 19,
        "layers": [
            {
                // Schéma du cache, relevé sur …/MapServer?f=json (tileInfo et
                // fullExtent) : origine, résolution du niveau 0, 13 niveaux (de
                // 306 m à 7,5 cm), emprise en Lambert 93.
                "url": "https://capgeo2.paris.fr/public/rest/services/IGC/IGC_Atlas/MapServer",
                "type": "arcgis-cache",
                "crs": 2154,
                "origin": [-35597500, 48953100],
                "resolution0": 305.7480111760223,
                "levels": 13,
                "extent": [637827, 6849420, 670591, 6874798]
            }
        ]
    }
];

// Entrée proposée : sans `requiresKey`, ou avec sa variable globale renseignée.
function mapLayerAvailable(cfg) {
    if (!cfg || !cfg.requiresKey) return !!cfg;
    const value = (typeof window[cfg.requiresKey] !== 'undefined') ? window[cfg.requiresKey] : '';
    return !!value;
}

// ---------------------------------------------------------------------------
// Couches Leaflet. Une seule construction pour toutes les cartes de
// l'application (carroyage rapide, export de zone, Créer MBTiles, Générer depuis
// un fichier), qui en tenaient chacune une copie.
// ---------------------------------------------------------------------------

// Correction de projection Yandex : EPSG:3395 (Mercator ellipsoïdal WGS84) vs
// EPSG:3857 (Pseudo-Mercator sphérique) utilisé par Leaflet. Chaque tuile Leaflet
// est un <canvas> sur lequel on REPROJETTE les 1-2 tuiles Yandex couvrant
// exactement sa plage de latitudes. Deux tuiles Leaflet voisines se partagent
// mathématiquement la même frontière 3395 → aucun jour possible entre les rangées.
const _YANDEX_E = 0.0818191908426215;
function _fondsYMerc3395(latRad) {
    const sinLat = Math.sin(latRad);
    return Math.log(Math.tan(Math.PI / 4 + latRad / 2) *
        Math.pow((1 - _YANDEX_E * sinLat) / (1 + _YANDEX_E * sinLat), _YANDEX_E / 2));
}
function _fondsLat3857(yTile, n) {
    return Math.atan(Math.sinh(Math.PI * (1 - 2 * yTile / n)));
}

// Classes créées à la première couche : `L` n'est pas encore là quand ce script
// est lu.
let _FondsYandexLayer = null;
let _FondsQuadKeyLayer = null;
function _fondsLayerClasses() {
    if (_FondsYandexLayer) return;
    _FondsYandexLayer = L.GridLayer.extend({
        initialize: function (url, options) {
            this._url = url;
            L.GridLayer.prototype.initialize.call(this, options);
        },
        createTile: function (coords, done) {
            const ts = this.getTileSize().y; // généralement 256
            const tile = document.createElement('canvas');
            tile.width = ts; tile.height = ts;

            const z = coords.z, n = Math.pow(2, z);
            // Plage de pixels VERTICAUX du monde EPSG:3395 (à ce zoom) couverte par
            // la tuile EPSG:3857 demandée. Les X sont identiques dans les deux
            // projections (même découpage en longitude).
            const py = (yTile) => n * ts / 2 * (1 - _fondsYMerc3395(_fondsLat3857(yTile, n)) / Math.PI);
            const pyN = py(coords.y), pyS = py(coords.y + 1);
            const H = pyS - pyN; // hauteur 3395 correspondante (≈ ts, pas exactement)

            // Tuiles sources 3395 couvrant [pyN, pyS) — 1 ou 2 en pratique.
            const ty0 = Math.max(0, Math.floor(pyN / ts));
            const ty1 = Math.min(n - 1, Math.floor((pyS - 1e-9) / ts));
            const srcs = [];
            for (let ty = ty0; ty <= ty1; ty++)
                srcs.push({ ty, url: L.Util.template(this._url, L.extend({}, this.options, { x: coords.x, y: ty, z })) });

            // Chargement en CORS d'abord (Yandex sert les en-têtes quand on les
            // demande) : le canvas reste « propre » et réutilisable (export,
            // capture…). Repli sans crossOrigin si le CORS échoue.
            const load = (url) => new Promise(resolve => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => resolve(img);
                img.onerror = () => {
                    const raw = new Image();
                    raw.onload = () => resolve(raw);
                    raw.onerror = () => resolve(null);
                    raw.src = url;
                };
                img.src = url;
            });

            Promise.all(srcs.map(s => load(s.url))).then(imgs => {
                const ctx = tile.getContext('2d');
                let drawn = 0;
                for (let i = 0; i < srcs.length; i++) {
                    const img = imgs[i];
                    if (!img) continue;
                    const ty = srcs[i].ty;
                    // Bande de la tuile source comprise dans [pyN, pyS], remappée
                    // linéairement sur la hauteur du canvas (la non-linéarité
                    // 3857↔3395 sur 256 px est très en dessous du pixel).
                    const srcTop = Math.max(pyN, ty * ts);
                    const srcBot = Math.min(pyS, (ty + 1) * ts);
                    const sy = srcTop - ty * ts, sh = srcBot - srcTop;
                    const dy = (srcTop - pyN) * ts / H, dh = sh * ts / H;
                    // +1 px de recouvrement (sauf dernière bande) : la bande
                    // suivante, opaque, repeint par-dessus — supprime le liseré
                    // d'anticrénelage aux frontières fractionnaires.
                    const over = (i < srcs.length - 1) ? 1 : 0;
                    ctx.drawImage(img, 0, sy, img.width, sh, 0, dy, ts, dh + over);
                    drawn++;
                }
                done(drawn ? null : new Error('tuiles Yandex indisponibles'), tile);
            });
            return tile;
        }
    });
    _FondsQuadKeyLayer = L.TileLayer.extend({
        getTileUrl: function (coords) {
            const x = coords.x, y = coords.y, z = coords.z;
            let quadKey = '';
            for (let i = z; i > 0; i--) {
                let digit = 0;
                const mask = 1 << (i - 1);
                if ((y & mask) !== 0) { digit += 2; }
                if ((x & mask) !== 0) { digit += 1; }
                quadKey += digit.toString();
            }
            return L.Util.template(this._url, { s: (x + y) % 4, q: quadKey, z: z });
        }
    });
}

// Couche Leaflet d'une entrée du catalogue (fond ou surcouche), ou null si elle
// n'est pas proposée sur ce poste. `zIndex` : rang dans le panneau des tuiles
// (fond sous les surcouches, cf. FONDS_STACK_Z dans fonds.js).
function createMapLayer(cfg, { zIndex } = {}) {
    if (!mapLayerAvailable(cfg)) return null;
    _fondsLayerClasses();
    // `attribution` : la mention legale du fournisseur ; le nom part dans
    // `layerName`, option a nous.
    const base = { attribution: cfg.attribution || cfg.name, layerName: cfg.name,
                   maxNativeZoom: cfg.maxZoom || 19, maxZoom: 22, keepBuffer: 0, updateWhenZooming: false };
    if (zIndex !== undefined) base.zIndex = zIndex;
    const make = (layerData) => {
        const opts = { ...base };
        if (layerData.minZoom !== undefined) opts.minZoom = layerData.minZoom;
        if (layerData.maxZoom !== undefined) opts.maxNativeZoom = layerData.maxZoom;
        if (layerData.type === 'quadkey') return new _FondsQuadKeyLayer(layerData.url, opts);
        if (layerData.type === 'yandex') return new _FondsYandexLayer(layerData.url, opts);
        // WMS : Leaflet compose lui-meme le GetMap a partir du CRS de la carte.
        // L'export, lui, passe par tileUrlFor() — meme emprise.
        if (layerData.type === 'wms') return L.tileLayer.wms(layerData.url, { ...opts,
            layers: layerData.layers, styles: layerData.styles || '',
            format: layerData.format || 'image/png',
            transparent: layerData.transparent !== false,
            version: layerData.version || '1.3.0' });
        // Cache ArcGIS hors Web Mercator : reprojete tuile par tuile (arcgisCache.js).
        if (layerData.type === 'arcgis-cache') return agcLeafletLayer(layerData, opts);
        return L.tileLayer(layerData.url, opts);
    };
    return cfg.layers.length > 1 ? L.layerGroup(cfg.layers.map(make)) : make(cfg.layers[0]);
}

// Les modules d'export (imagetoprint.js, zoneDownloader.js, mbtilesCreator.js)
// sont des scripts classiques : ils consomment ces helpers en global.
Object.assign(window, { tileUrlFor, wmsTileUrl, tileBBox3857, mapLayerAvailable, createMapLayer });
