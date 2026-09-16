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
