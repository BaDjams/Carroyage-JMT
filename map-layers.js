// map-layers.js
const IGN_API_KEY = "ign_scan_ws";

const MAP_LAYERS = [
    {
        "id": "ign_google_hybrid",
        "name": "Ortho IGN + Routes Google",
        "maxZoom": 20, // On se limite au zoom max de la couche IGN
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
        "id": "google_hybrid",
        "name": "Google Hybrid",
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
        "maxZoom": 21,
        "layers": [
            {
                "url": "https://mt0.google.com/vt/lyrs=y&hl=fr&x={x}&y={y}&z={z}&apistyle=s.t%3a2|s.e%3al|p.v%3aoff",
                "type": "xyz"
            }
        ]
    },
    {
        "id": "esri_hybrid",
        "name": "Satellite Esri + Routes Google",
        "maxZoom": 21, // Correspond au zoom élevé des deux sources
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
    },
	{
        "id": "ign_public_hybrid",
        "name": "Plan IGN",
        "maxZoom": 20,
        "layers": [
            {
                "url": "https://data.geopf.fr/wmts?Layer=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&Style=normal&TileMatrixSet=PM&SERVICE=WMTS&REQUEST=GetTile&Version=1.0.0&FORMAT=image/png&TileMatrix={z}&TileCol={x}&TileRow={y}",
                "type": "xyz"
            }
        ]
    },
	{
        "id": "osm_FR",
        "name": "OSM Français",
        "maxZoom": 19,
        "layers": [
            {
                "url": "https://a.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png",
                "type": "xyz"
            }
        ]
    }/*,
	{
        id: "ign_scan25",
        name: "IGN Scan 25",
        maxZoom: 18,
        type: 'wms', // Le type qui déclenchera la logique du plugin
        url: 'https://data.geopf.fr/wms-r/wms',
        wmsParams: {
            apikey: IGN_API_KEY,
            layers: 'SCAN25TOUR_PYR-JPEG_WLD_WM', // Notez 'layers' au lieu de 'LAYERS' pour le plugin
            format: 'image/jpeg',
            transparent: false,
            version: '1.3.0',
            crs: 'EPSG:4326'
        }
    }*/
];
