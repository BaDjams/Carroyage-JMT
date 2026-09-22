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
// GetCapabilities du service (tools/shom_layers.py), d'où une variable plutôt
// qu'un identifiant figé qui donnerait des tuiles vides. Cf. DOCUMENTATION.md §7.6.
if (typeof SHOM_API_KEY === 'undefined') var SHOM_API_KEY = '';
if (typeof SHOM_RASTER_LAYER === 'undefined') var SHOM_RASTER_LAYER = 'RASTER_MARINE_3857_WMTS';
if (typeof SHOM_INSPIRE_LAYER === 'undefined') var SHOM_INSPIRE_LAYER = '';

// Gabarit KVP commun aux deux services SHOM (Web Mercator uniquement).
const SHOM_WMTS = (base, layer) => `${base}?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile`
    + `&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=3857&FORMAT=image/png`
    + `&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;

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
        // (tools/shom_layers.py) ; SHOM_RASTER_LAYER permet de le corriger sans
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
