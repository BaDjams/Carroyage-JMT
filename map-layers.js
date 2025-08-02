// map-layers.js

const MAP_LAYERS = [
    {
        "id": "bing_hybrid",
        "name": "Bing Hybrid",
        "layers": [
            {
                "url": "http://ecn.t{s}.tiles.virtualearth.net/tiles/h{q}.jpeg?g=14927",
                "type": "quadkey"
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
                "type": "xyz_y_inverted" // Note: Esri utilise un ordre {y}/{x}
            }
        ]
    },
    {
        "id": "ign_hybrid",
        "name": "IGN Satellite + Routes (Exemple)",
        "layers": [
            // Couche 1: Les images satellites (dessinées en premier)
            {
                "url": "https://wxs.ign.fr/geoportail/wmts?layer=ORTHOIMAGERY.ORTHOPHOTOS&style=normal&tilematrixset=PM&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image/jpeg&TileMatrix={z}&TileCol={x}&TileRow={y}",
                "type": "xyz",
                "attribution": "IGN-F/Geoportail"
            },
            // Couche 2: Les routes et étiquettes (dessinées par-dessus)
            {
                "url": "https://wxs.ign.fr/geoportail/wmts?layer=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&style=normal&tilematrixset=PM&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image/png&TileMatrix={z}&TileCol={x}&TileRow={y}",
                "type": "xyz",
                "attribution": "IGN-F/Geoportail"
            }
        ]
    }
];
