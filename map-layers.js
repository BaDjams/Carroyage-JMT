// map-layers.js
// Les clés privées sont définies dans config.private.js (chargé avant ce fichier).
// Si config.private.js est absent ou vide, les variables sont vides ici par défaut
// et les layers privés sont simplement masqués (voir createBaseLayers dans index.html).
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

// Bascule du fond « Eaux intérieures » : le WMTS i-Boating local quand le poste en
// dispose, sinon un flux libre de droits (OpenStreetMap + amers OpenSeaMap). La
// couche est ainsi toujours proposée, licence ou pas. Cf. DOCUMENTATION.md §7.5.
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
    return layer.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

// « shortName » : nom court pour le cartouche des images exportees, ou la place
// manque (« 1 carre = 10m, OSM z16 »). Le « name » complet reste celui du selecteur.
// « attribution » : mention affichee sur la carte (Leaflet accepte du HTML). La
// politique d'usage des tuiles OSM impose « © les contributeurs OpenStreetMap »
// visible sur la carte ; son absence est un motif de blocage manuel. Les guillemets
// internes sont SIMPLES : la valeur est elle-meme une chaine JS entre guillemets doubles.
const MAP_LAYERS = [
    {
        "id": "ign_ign_hybrid",
        "name": "Ortho IGN + Routes IGN",
        "shortName": "Ortho IGN + IGN",
        "attribution": "&copy; <a href='https://www.ign.fr/' target='_blank' rel='noopener'>IGN</a>",
        "maxZoom": 19,
        "layers": [
            {
                "url": "https://data.geopf.fr/wmts?Layer=ORTHOIMAGERY.ORTHOPHOTOS&Style=normal&TileMatrixSet=PM&SERVICE=WMTS&REQUEST=GetTile&Version=1.0.0&FORMAT=image/jpeg&TileMatrix={z}&TileCol={x}&TileRow={y}",
                "type": "xyz"
            },
            {
                "url": "https://data.geopf.fr/wmts?Layer=TRANSPORTNETWORKS.ROADS&Style=normal&TileMatrixSet=PM&SERVICE=WMTS&REQUEST=GetTile&Version=1.0.0&FORMAT=image/png&TileMatrix={z}&TileCol={x}&TileRow={y}",
                "type": "xyz"
            },
            {
                "url": "https://data.geopf.fr/wmts?Layer=GEOGRAPHICALNAMES.NAMES&Style=normal&TileMatrixSet=PM&SERVICE=WMTS&REQUEST=GetTile&Version=1.0.0&FORMAT=image/png&TileMatrix={z}&TileCol={x}&TileRow={y}",
                "type": "xyz"
            }
        ]
    },
    {
        "id": "ign_google_hybrid",
        "name": "Ortho IGN + Routes Google",
        "shortName": "Ortho IGN + Google",
        "attribution": "&copy; <a href='https://www.ign.fr/' target='_blank' rel='noopener'>IGN</a> &mdash; &copy; Google",
        "maxZoom": 19, // CORRECTION : Limité à 19 pour correspondre au service WMTS IGN
        "layers": [
            // Couche 1: Le fond de carte Ortho-imagerie de l'IGN (souvent en JPEG)
            {
                "url" : "https://data.geopf.fr/wmts?Layer=ORTHOIMAGERY.ORTHOPHOTOS&Style=normal&Timestamp=&TileMatrixSet=PM&SERVICE=WMTS&REQUEST=GetTile&Version=1.0.0&FORMAT=image/jpeg&TileMatrix={z}&TileCol={x}&TileRow={y}",
                "type": "xyz"
            },
            // Couche 2: La surcouche de routes/étiquettes Google (fond transparent)
            {
                "url": "https://mt0.google.com/vt/lyrs=h&hl=fr&x={x}&y={y}&z={z}&apistyle=s.t%3a2|s.e%3al|p.v%3aoff",
                "type": "xyz"
            }
        ]
    },
    {
        // Hybride Yandex 100% : sat + routes/labels Yandex en français.
        // Pas de décalage de projection car les deux couches viennent du même serveur.
        "id": "yandex_hybrid",
        "name": "Yandex Hybride (FR)",
        "shortName": "Yandex",
        "attribution": "&copy; Yandex",
        "maxZoom": 18,
        "layers": [
            {
                "url": "https://core-sat.maps.yandex.net/tiles?l=sat&x={x}&y={y}&z={z}&scale=1&lang=fr_FR",
                "type": "yandex"
            },
            {
                "url": "https://core-renderer-tiles.maps.yandex.net/tiles?l=skl&x={x}&y={y}&z={z}&scale=1&lang=fr_FR",
                "type": "yandex"
            }
        ]
    },
    {
        "id": "bing_hybrid",
        "name": "Bing Maps Hybride",
        "shortName": "Bing",
        "attribution": "&copy; Microsoft",
        "maxZoom": 19,
        "layers": [
            {
                // Notez le 'h' devant {q} pour Hybrid et mkt=fr-FR pour le français
                "url": "https://ecn.t{s}.tiles.virtualearth.net/tiles/h{q}.jpeg?g=12933&mkt=fr-FR",
                "type": "quadkey"
            }
        ]
    },
    {
        "id": "google_hybrid",
        "name": "Google Hybrid",
        "shortName": "Google",
        "attribution": "&copy; Google",
        "maxZoom": 21,
        "layers": [
            {
                "url": "https://mt0.google.com/vt/lyrs=y&hl=fr&x={x}&y={y}&z={z}",
                "type": "xyz"
            }
        ]
    },
    {
        "id": "google_hybrid_NOPOI",
        "name": "Google Hybrid sans POI",
        "shortName": "Google sans POI",
        "attribution": "&copy; Google",
        "maxZoom": 21,
        "layers": [
            {
                "url": "https://mt0.google.com/vt/lyrs=y&hl=fr&x={x}&y={y}&z={z}&apistyle=s.t%3a2|s.e%3al|p.v%3aoff",
                "type": "xyz"
            }
        ]
    },
    /*{
        "id": "esri_hybrid",
        "name": "Satellite Esri + Routes Google",
        "shortName": "Esri + Google",
        "attribution": "&copy; Esri &mdash; &copy; Google",
        "maxZoom": 21,
        "layers": [
            // Couche 1: Le fond de carte satellite Esri (fiable)
            {
                "url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
                "type": "xyz"
            },
            // Couche 2: La surcouche de routes/étiquettes OSM sur fond transparent (par CARTO)
            {
                "url": "https://mt0.google.com/vt/lyrs=h&hl=fr&x={x}&y={y}&z={z}&apistyle=s.t%3a2|s.e%3al|p.v%3aoff",
                "type": "xyz"
            }
        ]
    },*/
    {
        // Pyramide composite IGN privée z6-17, puis Plan IGN public z18-19.
        "id": "ign_scan_composite",
        "name": "IGN Cartes (privé - multi-échelles)",
        "shortName": "IGN Cartes",
        "attribution": "&copy; <a href='https://www.ign.fr/' target='_blank' rel='noopener'>IGN</a>",
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
        "id": "ign_public_hybrid",
        "name": "Plan IGN",
        "shortName": "Plan IGN",
        "attribution": "&copy; <a href='https://www.ign.fr/' target='_blank' rel='noopener'>IGN</a>",
        "maxZoom": 19,
        "layers": [
            {
                "url": "https://data.geopf.fr/wmts?Layer=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&Style=normal&TileMatrixSet=PM&SERVICE=WMTS&REQUEST=GetTile&Version=1.0.0&FORMAT=image/png&TileMatrix={z}&TileCol={x}&TileRow={y}",
                "type": "xyz"
            }
        ]
    },
    {
        "id": "mapy_outdoor",
        "name": "Mapy.CZ Outdoor",
        "shortName": "Mapy.CZ",
        "attribution": "&copy; <a href='https://mapy.cz/' target='_blank' rel='noopener'>Seznam.cz</a>",
        "requiresKey": "MAPY_API_KEY",
        "maxZoom": 19,
        "layers": [
            {
                "url": `https://api.mapy.com/v1/maptiles/outdoor/256/{z}/{x}/{y}?apikey=${MAPY_API_KEY}&lang=fr`,
                "type": "xyz"
            }
        ]
    },
    {
        // Fond des eaux intérieures, en deux états selon le poste :
        //  - avec licence : le WMTS i-Boating lancé en local (cartes marines, lacs,
        //    rivières). Leaflet substitue {z}, {x} et {y} dans le gabarit de
        //    config.private.js, ce qui couvre une URL RESTful (…/{z}/{x}/{y}.png)
        //    comme une URL KVP (…&TileMatrix={z}&TileCol={x}&TileRow={y}) ;
        //  - sans licence : OpenStreetMap surmonté des amers OpenSeaMap, libres de
        //    droits, donc exportables et rediffusables sans restriction.
        // Service local à l'arrêt ou cellules non téléchargées = tuiles vides.
        "id": "inland_waters",
        "name": INLAND_LICENSED ? "Eaux intérieures (i-Boating, privé)" : "Eaux intérieures (libre)",
        "shortName": INLAND_LICENSED ? "i-Boating" : "Plan IGN + OpenSeaMap",
        "attribution": INLAND_LICENSED
            ? "&copy; i-Boating &mdash; usage privé interne"
            : "&copy; <a href='https://www.ign.fr/' target='_blank' rel='noopener'>IGN</a> &mdash; amers <a href='https://www.openseamap.org/' target='_blank' rel='noopener'>OpenSeaMap</a> (CC-BY-SA)",
        "maxZoom": INLAND_LICENSED ? IBOATING_WMTS_MAXZOOM : 19,
        "layers": INLAND_LICENSED
            ? [
                {
                    "url": IBOATING_WMTS_URL,
                    "type": "xyz"
                }
            ]
            : [
                {
                    // Plan IGN v2 : canaux, écluses et cours d'eau bien mieux rendus
                    // que l'OSM standard — mais emprise France, tuiles vides ailleurs.
                    "url": "https://data.geopf.fr/wmts?Layer=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&Style=normal&TileMatrixSet=PM&SERVICE=WMTS&REQUEST=GetTile&Version=1.0.0&FORMAT=image/png&TileMatrix={z}&TileCol={x}&TileRow={y}",
                    "type": "xyz",
                    "maxZoom": 19
                },
                {
                    // Amers, écluses et balisage ; fond transparent, tuiles jusqu'à z18.
                    "url": "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",
                    "type": "xyz",
                    "maxZoom": 18
                }
            ]
    },
    {
        // Cartes marines scannées du SHOM. Sous abonnement ou convention : la couche
        // reste masquée tant que SHOM_API_KEY est absente de config.private.js.
        // L'identifiant de couche est à confirmer sur le GetCapabilities du service
        // (tools/ogc_layers.py) ; SHOM_RASTER_LAYER permet de le corriger sans
        // toucher au code.
        "id": "shom_raster",
        "name": "Cartes marines SHOM (privé)",
        "shortName": "SHOM",
        "attribution": "&copy; <a href='https://data.shom.fr/' target='_blank' rel='noopener'>SHOM</a>",
        "requiresKey": "SHOM_API_KEY",
        "maxZoom": 18,
        "layers": [
            {
                "url": SHOM_WMTS(`https://services.data.shom.fr/${SHOM_API_KEY}/wmts`, SHOM_RASTER_LAYER),
                "type": "xyz"
            }
        ]
    },
    {
        // Couches thématiques INSPIRE du SHOM : libres d'accès, sans clé. Leur
        // identifiant varie selon la donnée voulue (bathymétrie, trait de côte…),
        // d'où SHOM_INSPIRE_LAYER, vide par défaut : mieux vaut une couche absente
        // qu'une couche qui ne renverrait que des tuiles vides.
        "id": "shom_inspire",
        "name": "SHOM INSPIRE (libre)",
        "shortName": "SHOM INSPIRE",
        "attribution": "&copy; <a href='https://data.shom.fr/' target='_blank' rel='noopener'>SHOM</a>",
        "requiresKey": "SHOM_INSPIRE_LAYER",
        "maxZoom": 18,
        "layers": [
            {
                "url": SHOM_WMTS('https://services.data.shom.fr/INSPIRE/wmts', SHOM_INSPIRE_LAYER),
                "type": "xyz"
            }
        ]
    },
    {
        // Lignes de profondeur EMODnet sur fond OpenStreetMap. Les isobathes
        // arrivent en WMS transparent : si l'identifiant de couche ne convient
        // pas au service, il reste le fond OSM plutôt qu'une carte blanche.
        // Couverture : mers européennes.
        "id": "emodnet_bathy",
        "name": "Lignes de profondeur (EMODnet)",
        "shortName": "EMODnet",
        "attribution": "&copy; les <a href='https://www.openstreetmap.org/copyright' target='_blank' rel='noopener'>contributeurs OpenStreetMap</a> &mdash; bathym&eacute;trie <a href='https://emodnet.ec.europa.eu/en/bathymetry' target='_blank' rel='noopener'>EMODnet</a>",
        "maxZoom": 19,
        "layers": [
            {
                "url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                "type": "xyz",
                "maxZoom": 19
            },
            {
                "url": EMODNET_WMS,
                "type": "wms",
                "layers": EMODNET_CONTOURS_LAYER,
                "transparent": true
            }
        ]
    },
    {
        "id": "osm_standard",
        "name": "OpenStreetMap",
        "shortName": "OSM",
        "attribution": "&copy; les <a href='https://www.openstreetmap.org/copyright' target='_blank' rel='noopener'>contributeurs OpenStreetMap</a>",
        "maxZoom": 19,
        "layers": [
            {
                "url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                "type": "xyz"
            }
        ]
    }
];

// Les modules d'export (imagetoprint.js, zoneDownloader.js, mbtilesCreator.js)
// sont des scripts classiques : ils consomment ces helpers en global.
Object.assign(window, { tileUrlFor, wmsTileUrl, tileBBox3857 });
