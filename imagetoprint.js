// imagetoprint.js

const TILE_PROVIDER_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_SIZE = 256;
const EARTH_RADIUS = 6378137;

/**
 * Fonction principale appelée par le bouton "Générer l'image (PNG)".
 */
async function generateImageToPrint() {
    const loadingIndicator = document.getElementById("loading-indicator");
    const loadingMessage = document.getElementById("loading-message");
    
    loadingMessage.textContent = "Préparation de l'image pour impression...";
    loadingIndicator.classList.remove("hidden");
    hideError();

    try {
        const coordsStr = document.getElementById("decimal-coords").value;
        if (!coordsStr) throw new Error("Veuillez d'abord définir des coordonnées de référence.");
        
        const config = getGridConfiguration(
            parseFloat(coordsStr.split(',')[0]),
            parseFloat(coordsStr.split(',')[1])
        );
        config.startCol = 'A';
        config.endCol = 'AA';
        config.startRow = 1;
        config.endRow = 19;
        config.includeGrid = true;
        config.includePoints = false;
        
        const a1CornerCoords = getA1CornerCoords(config);
        const boundingBox = getBoundingBoxForPrint(config, a1CornerCoords);
        const zoomLevel = calculateOptimalZoom(boundingBox, config.scale);
        
        console.log(`Zone géographique (Bounding Box): N:${boundingBox.north}, S:${boundingBox.south}, E:${boundingBox.east}, W:${boundingBox.west}`);
        console.log(`Zoom optimal calculé : ${zoomLevel}`);

        loadingMessage.textContent = "Téléchargement des fonds de carte (0%)...";
        const { mapImage, tileInfo } = await fetchAndAssembleTiles(boundingBox, zoomLevel, (progress) => {
            loadingMessage.textContent = `Téléchargement des fonds de carte (${progress.toFixed(0)}%)...`;
        });

        loadingMessage.textContent = "Assemblage de l'image finale...";
        const finalCanvas = document.createElement('canvas');
        const ctx = finalCanvas.getContext('2d');
        finalCanvas.width = mapImage.width;
        finalCanvas.height = mapImage.height;
        ctx.drawImage(mapImage, 0, 0);

        drawGridOnCanvas(ctx, tileInfo, zoomLevel, config, a1CornerCoords);
        
        const fileName = `${config.gridName}_Print_27x19.png`;
        finalCanvas.toBlob((blob) => {
            if (blob) {
                downloadFile(blob, fileName, 'image/png');
            } else {
                showError("Erreur lors de la création du fichier PNG.");
            }
        }, 'image/png');

    } catch (error) {
        console.error("Erreur lors de la génération de l'image :", error);
        showError(error.message);
    } finally {
        loadingIndicator.classList.add("hidden");
    }
}

/**
 * Calcule la position de l'origine A1.
 */
function getA1CornerCoords(config) {
    const refLat = config.latitude;
    const refLon = config.longitude;
    const metersToLatDegrees = (meters) => meters / 111320;
    const metersToLonDegrees = (meters, lat) => meters / (111320 * Math.cos(toRad(lat)));

    if (config.referencePointChoice === 'origin') {
        return [refLon, refLat];
    } else { // 'center'
        const centerColOffset = getOffsetInCells(14) + 0.5; // 13.5
        const centerRowOffset = getOffsetInCells(10) + 0.5; // 9.5
        const xOffsetMeters = centerColOffset * config.scale;
        const yOffsetMeters = centerRowOffset * config.scale;
        const a1Lon = refLon - metersToLonDegrees(xOffsetMeters, refLat);
        const a1Lat = refLat - metersToLatDegrees(yOffsetMeters, refLat);
        return [a1Lon, a1Lat];
    }
}


/**
 * Calcule les coordonnées géographiques des 4 coins de la grille 27x19.
 */
function getBoundingBoxForPrint(config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    const corners = [
        { col: 1, row: 1 }, { col: 28, row: 1 },
        { col: 1, row: 20 }, { col: 28, row: 20 }
    ];
    const geoCorners = corners.map(corner => {
        const point = calculateAndRotatePoint(corner.col, corner.row, config, a1Lat, a1Lon);
        return { lon: point[0], lat: point[1] };
    });
    const north = Math.max(...geoCorners.map(c => c.lat));
    const south = Math.min(...geoCorners.map(c => c.lat));
    const east = Math.max(...geoCorners.map(c => c.lon));
    const west = Math.min(...geoCorners.map(c => c.lon));
    return { north, south, east, west };
}


/**
 * Calcule le niveau de zoom OSM qui correspond le mieux à l'échelle demandée.
 * BUG 5 CORRIGÉ : Utilisation de la formule standard de la résolution Mercator.
 */
function calculateOptimalZoom(boundingBox, scaleInMeters) {
    // Largeur de la zone en mètres
    const gridWidthInMeters = 27 * scaleInMeters;

    for (let zoom = 20; zoom >= 1; zoom--) {
        // Calcule combien de pixels la largeur de la grille occuperait à ce niveau de zoom
        const nw = latLonToWorldPixels(boundingBox.north, boundingBox.west, zoom);
        const ne = latLonToWorldPixels(boundingBox.north, boundingBox.east, zoom);
        const widthInPixels = ne.x - nw.x;

        // Calcule la résolution en mètres/pixel pour ce zoom
        const currentResolution = gridWidthInMeters / widthInPixels;
        
        // On cherche le zoom qui donne une résolution juste suffisante
        // On garde une marge, on veut que la résolution de la carte soit meilleure (plus petite) que celle demandée
        if (currentResolution > (scaleInMeters / TILE_SIZE)) {
             return zoom;
        }
    }
    return 1;
}

/**
 * Convertit Lat/Lon en coordonnées "monde" en pixels à un zoom donné.
 */
function latLonToWorldPixels(lat, lon, zoom) {
    const siny = Math.sin(toRad(lat));
    const y = 0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI);
    const x = (lon + 180) / 360;
    const mapSize = TILE_SIZE * Math.pow(2, zoom);
    return {
        x: x * mapSize,
        y: y * mapSize
    };
}


/**
 * Convertit les coordonnées géographiques en numéros de tuile.
 */
function latLonToTileNumbers(lat, lon, zoom) {
    const worldPixels = latLonToWorldPixels(lat, lon, zoom);
    return {
        x: Math.floor(worldPixels.x / TILE_SIZE),
        y: Math.floor(worldPixels.y / TILE_SIZE)
    };
}

/**
 * Convertit les numéros de tuile en coordonnées du coin Nord-Ouest de la tuile.
 */
function tileNumbersToLatLon(x, y, zoom) {
    const n = Math.pow(2, zoom);
    const lon = x / n * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
    const lat = toDeg(latRad);
    return { lat: lat, lon: lon };
}


/**
 * Télécharge et assemble les tuiles.
 */
async function fetchAndAssembleTiles(boundingBox, zoom, onProgress) {
    const nwTile = latLonToTileNumbers(boundingBox.north, boundingBox.west, zoom);
    const seTile = latLonToTileNumbers(boundingBox.south, boundingBox.east, zoom);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = (seTile.x - nwTile.x + 1) * TILE_SIZE;
    canvas.height = (seTile.y - nwTile.y + 1) * TILE_SIZE;

    const tilePromises = [];
    const totalTiles = (seTile.x - nwTile.x + 1) * (seTile.y - nwTile.y + 1);
    let downloadedCount = 0;

    for (let x = nwTile.x; x <= seTile.x; x++) {
        for (let y = nwTile.y; y <= seTile.y; y++) {
            const tileUrl = TILE_PROVIDER_URL.replace('{z}', zoom).replace('{x}', x).replace('{y}', y);
            const promise = fetch(tileUrl)
                .then(response => {
                    if (!response.ok) throw new Error(`Impossible de charger la tuile: ${response.statusText}`);
                    return response.blob();
                })
                .then(blob => createImageBitmap(blob))
                .then(imageBitmap => {
                    const canvasX = (x - nwTile.x) * TILE_SIZE;
                    const canvasY = (y - nwTile.y) * TILE_SIZE;
                    ctx.drawImage(imageBitmap, canvasX, canvasY);
                    downloadedCount++;
                    onProgress((downloadedCount / totalTiles) * 100);
                });
            tilePromises.push(promise);
        }
    }
    await Promise.all(tilePromises);
    const tileInfo = { minX: nwTile.x, minY: nwTile.y };
    return { mapImage: canvas, tileInfo: tileInfo };
}


/**
 * Dessine la grille sur le canevas.
 */
function drawGridOnCanvas(ctx, tileInfo, zoom, config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;

    // Coordonnées en pixels "monde" du coin de la première tuile
    const originWorldPixels = {
        x: tileInfo.minX * TILE_SIZE,
        y: tileInfo.minY * TILE_SIZE,
    };
    
    // BUG 5 CORRIGÉ : Fonction de conversion fiable
    const latLonToPixels = (lat, lon) => {
        const worldPixels = latLonToWorldPixels(lat, lon, zoom);
        return {
            x: worldPixels.x - originWorldPixels.x,
            y: worldPixels.y - originWorldPixels.y
        };
    };

    ctx.strokeStyle = config.gridColor;
    ctx.lineWidth = 2;
    ctx.fillStyle = config.gridColor;
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Lignes verticales (de A=1 à AA+1=28)
    for (let i = 1; i <= 28; i++) {
        const startPoint = calculateAndRotatePoint(i, 1, config, a1Lat, a1Lon);
        const endPoint = calculateAndRotatePoint(i, 20, config, a1Lat, a1Lon);
        const startPixels = latLonToPixels(startPoint[1], startPoint[0]);
        const endPixels = latLonToPixels(endPoint[1], endPoint[0]);
        ctx.beginPath();
        ctx.moveTo(startPixels.x, startPixels.y);
        ctx.lineTo(endPixels.x, endPixels.y);
        ctx.stroke();
    }
    
    // Lignes horizontales (de 1 à 19+1=20)
    for (let i = 1; i <= 20; i++) {
        const startPoint = calculateAndRotatePoint(1, i, config, a1Lat, a1Lon);
        const endPoint = calculateAndRotatePoint(28, i, config, a1Lat, a1Lon);
        const startPixels = latLonToPixels(startPoint[1], startPoint[0]);
        const endPixels = latLonToPixels(endPoint[1], endPoint[0]);
        ctx.beginPath();
        ctx.moveTo(startPixels.x, startPixels.y);
        ctx.lineTo(endPixels.x, endPixels.y);
        ctx.stroke();
    }

    // Étiquettes
    // Lettres (de A=1 à AA=27)
    for (let i = 1; i <= 27; i++) {
        const labelPoint = calculateAndRotatePoint(i + 0.5, 0.5, config, a1Lat, a1Lon);
        const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
        ctx.fillText(numberToLetter(i), labelPixels.x, labelPixels.y);
    }
    
    // Chiffres (de 1 à 19)
    for (let i = 1; i <= 19; i++) {
        const labelPoint = calculateAndRotatePoint(0.5, i + 0.5, config, a1Lat, a1Lon);
        const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
        ctx.fillText(i.toString(), labelPixels.x, labelPixels.y);
    }
}
