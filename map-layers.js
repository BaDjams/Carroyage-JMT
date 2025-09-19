// map-layers.js

const MAP_LAYERS = [
    {
        "id": "ign_public_hybrid",
        "name": "Plan IGN",
        "layers": [
            {
                "url": "https://data.geopf.fr/wmts?Layer=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&Style=normal&TileMatrixSet=PM&SERVICE=WMTS&REQUEST=GetTile&Version=1.0.0&FORMAT=image/png&TileMatrix={z}&TileCol={x}&TileRow={y}",
                "type": "xyz",
                "attribution": "IGN-F/Geoportail",
            }
        ]
    },
    {
        "id": "google_hybrid",
        "name": "Google Hybrid",
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
        "layers": [
            {
                "url": "https://mt0.google.com/vt/lyrs=y&hl=fr&x={x}&y={y}&z={z}&apistyle=s.t%3a2|s.e%3al|p.v%3aoff",
                "type": "xyz"
            }
        ]
    },
    {
        "id": "osm_standard",
        "name": "OSM Standard",
        "layers": [
            {
                "url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                "type": "xyz"
            }
        ]
    },
    {
        "id": "esri_satellite",
        "name": "Satellite (Esri)",
        "layers": [
            {
                "url": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
                "type": "xyz"
            }
        ]
    }
];