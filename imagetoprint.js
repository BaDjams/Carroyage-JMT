// imagetoprint.js

const TILE_PROVIDER_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_SIZE = 256;

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
        // Centre d'une grille 27x19 : 14ème colonne (N), 10ème ligne (10)
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
    
    // Le coin NW est le coin supérieur gauche de la case A19.
    // Le coin SE est le coin inférieur droit de la case AA1.
    const nwGridPoint = config.letteringDirection === 'ascending' ? { col: 1, row: 20 } : { col: 1, row: 1 };
    const seGridPoint = config.letteringDirection === 'ascending' ? { col: 28, row: 1 } : { col: 28, row: 20 };

    const nwPoint = calculateAndRotatePoint(nwGridPoint.col, nwGridPoint.row, config, a1Lat, a1Lon);
    const sePoint = calculateAndRotatePoint(seGridPoint.col, seGridPoint.row, config, a1Lat, a1Lon);

    return {
        north: Math.max(nwPoint[1], sePoint[1]),
        west: Math.min(nwPoint[0], sePoint[0]),
        south: Math.min(nwPoint[1], sePoint[1]),
        east: Math.max(nwPoint[0], sePoint[0]),
    };
}


/**
 * Calcule le niveau de zoom OSM qui correspond le mieux à l'échelle demandée.
 * CORRIGÉ : Utilisation de la formule correcte pour la résolution Mercator.
 */
function calculateOptimalZoom(boundingBox, scaleInMeters) {
    const requiredResolution = scaleInMeters / TILE_SIZE;

    for (let zoom = 20; zoom >= 1; zoom--) {
        const metersPerPixel = (Math.cos(toRad(boundingBox.north)) * 2 * Math.PI * 6378137) / (TILE_SIZE * Math.pow(2, zoom));
        if (metersPerPixel <= requiredResolution) {
            return zoom;
        }
    }
    return 1;
}


/**
 * Convertit les coordonnées géographiques en numéros de tuile.
 */
function latLonToTileNumbers(lat, lon, zoom) {
    const n = Math.pow(2, zoom);
    const xtile = Math.floor(n * ((lon + 180) / 360));
    const ytile = Math.floor(n * (1 - (Math.log(Math.tan(toRad(lat)) + 1 / Math.cos(toRad(lat))) / Math.PI)) / 2);
    return { x: xtile, y: ytile };
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
            
            const promise = fetch(tileUrl, { mode: 'cors' }) // Ajout de cors
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

    const mapOrigin = tileNumbersToLatLon(tileInfo.minX, tileInfo.minY, zoom);

    // CORRIGÉ : Logique de conversion pixel simplifiée et correcte
    const latLonToPixels = (lat, lon) => {
        const worldCoords = latLonToTileNumbers(lat, lon, zoom);
        const originCoords = latLonToTileNumbers(mapOrigin.lat, mapOrigin.lon, zoom);
        
        const x = (worldCoords.x - originCoords.x) * TILE_SIZE;
        const y = (worldCoords.y - originCoords.y) * TILE_SIZE;

        return {x, y};
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
        const endPoint = calculateAndRotatePoint(i, 20, config, a1Lat, a1Lon); // 20 = bord bas de la 19ème
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
        const endPoint = calculateAndRotatePoint(28, i, config, a1Lat, a1Lon); // 28 = bord droit de la 27ème
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
