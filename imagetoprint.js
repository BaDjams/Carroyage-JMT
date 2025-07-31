// imagetoprint.js

const TILE_PROVIDER_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_SIZE = 256;
const MAX_ZOOM = 19;

/**
 * Fonction principale qui orchestre la création de l'image.
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
        config.startCol = 'A'; config.endCol = 'Z';
        config.startRow = 1; config.endRow = 18;
        config.includeGrid = true; config.includePoints = false;
        
        const a1CornerCoords = getA1CornerCoordsForPrint(config);
        const boundingBox = getBoundingBoxForPrint(config, a1CornerCoords);
        const zoomLevel = calculateOptimalZoom(boundingBox);
        
        console.log(`Zoom optimal calculé : ${zoomLevel}`);

        loadingMessage.textContent = "Téléchargement des fonds de carte (0%)...";
        const { mapImage: workingCanvas, tileInfo } = await fetchAndAssembleTiles(boundingBox, zoomLevel, (progress) => {
            loadingMessage.textContent = `Téléchargement des fonds de carte (${progress.toFixed(0)}%)...`;
        });

        loadingMessage.textContent = "Dessin du carroyage...";
        const workingCtx = workingCanvas.getContext('2d');
        drawGridAndElements(workingCtx, tileInfo, zoomLevel, config, a1CornerCoords);

        loadingMessage.textContent = "Finalisation de l'image...";
        // --- CORRECTION DU BUG ---
        // On déstructure correctement l'objet retourné par la fonction
        const { finalCanvas, cropInfo } = cropFinalImage(workingCanvas, tileInfo, zoomLevel, config, a1CornerCoords);
        
        // Redessiner les éléments sur l'image rognée pour garantir leur présence
        const finalCtx = finalCanvas.getContext('2d');
        drawGridAndElements(finalCtx, cropInfo, zoomLevel, config, a1CornerCoords, true);
        
        const fileName = `${config.gridName}_Print_26x18.png`;
        finalCanvas.toBlob((blob) => { // Maintenant, finalCanvas est bien un élément <canvas>
            if (blob) {
                downloadFile(blob, fileName, 'image/png');
            } else { showError("Erreur lors de la création du fichier PNG."); }
        }, 'image/png');

    } catch (error) {
        console.error("Erreur lors de la génération de l'image :", error);
        showError(error.message);
    } finally {
        loadingIndicator.classList.add("hidden");
    }
}

/**
 * Calcule la position de l'origine A1 spécifiquement pour la grille d'impression.
 */
function getA1CornerCoordsForPrint(config) {
    const refLat = config.latitude;
    const refLon = config.longitude;
    const metersToLatDegrees = (meters) => meters / 111320;
    const metersToLonDegrees = (meters, lat) => meters / (111320 * Math.cos(toRad(lat)));

    if (config.referencePointChoice === 'origin') {
        return [refLon, refLat];
    } else { // 'center'
        const centerColOffset = getOffsetInCells(13) + 0.5;
        const centerRowOffset = getOffsetInCells(9) + 0.5;
        const xOffsetMeters = centerColOffset * config.scale;
        const yOffsetMeters = centerRowOffset * config.scale;
        const a1Lon = refLon - metersToLonDegrees(xOffsetMeters, refLat);
        const a1Lat = refLat - metersToLatDegrees(yOffsetMeters, refLat);
        return [a1Lon, a1Lat];
    }
}


/**
 * Calcule la Bounding Box pour inclure la grille 26x18 ET les marges pour les étiquettes.
 */
function getBoundingBoxForPrint(config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    const corners = [
        { col: 0, row: 0 }, { col: 27, row: 0 },
        { col: 0, row: 19 }, { col: 27, row: 19 }
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
 * Calcule le niveau de zoom OSM optimal.
 */
function calculateOptimalZoom(boundingBox) {
    const lonDiff = Math.abs(boundingBox.east - boundingBox.west);
    if (lonDiff === 0) return MAX_ZOOM;
    const targetWidthInPixels = 1500;
    const zoomApproximation = Math.log2(360 * targetWidthInPixels / (lonDiff * TILE_SIZE));
    return Math.min(Math.floor(zoomApproximation), MAX_ZOOM);
}

function latLonToWorldPixels(lat, lon, zoom) {
    const siny = Math.sin(toRad(lat));
    const yClamped = Math.max(Math.min(siny, 0.9999), -0.9999);
    const y = 0.5 - Math.log((1 + yClamped) / (1 - yClamped)) / (4 * Math.PI);
    const x = (lon + 180) / 360;
    const mapSize = TILE_SIZE * Math.pow(2, zoom);
    return { x: x * mapSize, y: y * mapSize };
}

function latLonToTileNumbers(lat, lon, zoom) {
    const worldPixels = latLonToWorldPixels(lat, lon, zoom);
    return {
        x: Math.floor(worldPixels.x / TILE_SIZE),
        y: Math.floor(worldPixels.y / TILE_SIZE)
    };
}

function tileNumbersToLatLon(x, y, zoom) {
    const n = Math.pow(2, zoom);
    const lon = x / n * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
    const lat = toDeg(latRad);
    return { lat, lon };
}

async function fetchAndAssembleTiles(boundingBox, zoom, onProgress) {
    const nwTile = latLonToTileNumbers(boundingBox.north, boundingBox.west, zoom);
    const seTile = latLonToTileNumbers(boundingBox.south, boundingBox.east, zoom);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = (seTile.x - nwTile.x + 1) * TILE_SIZE;
    canvas.height = (seTile.y - nwTile.y + 1) * TILE_SIZE;
    const tilePromises = [];
    const totalTiles = (seTile.x - nwTile.x + 1) * (seTile.y - nwTile.y + 1);
    if (totalTiles <= 0 || totalTiles > 400) {
        throw new Error(`Nombre de tuiles à télécharger invalide ou trop élevé (${totalTiles}). Vérifiez l'échelle ou les coordonnées.`);
    }
    let downloadedCount = 0;
    for (let x = nwTile.x; x <= seTile.x; x++) {
        for (let y = nwTile.y; y <= seTile.y; y++) {
            const tileUrl = TILE_PROVIDER_URL.replace('{z}', zoom).replace('{x}', x).replace('{y}', y);
            const promise = new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = "Anonymous";
                img.onload = () => {
                    const canvasX = (x - nwTile.x) * TILE_SIZE;
                    const canvasY = (y - nwTile.y) * TILE_SIZE;
                    ctx.drawImage(img, canvasX, canvasY);
                    downloadedCount++;
                    onProgress((downloadedCount / totalTiles) * 100);
                    resolve();
                };
                img.onerror = () => { reject(new Error(`Impossible de charger la tuile: ${tileUrl}`)); };
                img.src = tileUrl;
            });
            tilePromises.push(promise);
        }
    }
    await Promise.all(tilePromises);
    const tileInfo = { minX: nwTile.x, minY: nwTile.y };
    return { mapImage: canvas, tileInfo: tileInfo };
}

/**
 * Rogne le canevas de travail pour ne garder que la zone d'intérêt.
 */
function cropFinalImage(workingCanvas, tileInfo, zoom, config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    const originWorldPixels = { x: tileInfo.minX * TILE_SIZE, y: tileInfo.minY * TILE_SIZE };
    const latLonToPixels = (lat, lon) => {
        const worldPixels = latLonToWorldPixels(lat, lon, zoom);
        return {
            x: worldPixels.x - originWorldPixels.x,
            y: worldPixels.y - originWorldPixels.y
        };
    };

    const cropStartPoint = calculateAndRotatePoint(0.5, 0.5, config, a1Lat, a1Lon);
    const cropEndPoint = calculateAndRotatePoint(27.5, 19.5, config, a1Lat, a1Lon);

    const startPixels = latLonToPixels(cropStartPoint[1], cropStartPoint[0]);
    const endPixels = latLonToPixels(cropEndPoint[1], cropEndPoint[0]);
    
    const cropX = Math.min(startPixels.x, endPixels.x);
    const cropY = Math.min(startPixels.y, endPixels.y);
    const cropWidth = Math.abs(endPixels.x - startPixels.x);
    const cropHeight = Math.abs(endPixels.y - startPixels.y);

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = cropWidth;
    finalCanvas.height = cropHeight;
    const finalCtx = finalCanvas.getContext('2d');
    
    finalCtx.drawImage(workingCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    
    // Le cropInfo contient les coordonnées géographiques du nouveau point (0,0) du canevas rogné
    const cropInfo = { north: Math.max(cropStartPoint[1], cropEndPoint[1]), west: Math.min(cropStartPoint[0], cropEndPoint[0]) };

    return { finalCanvas, cropInfo };
}

/**
 * Dessine la grille et tous les éléments sur un canevas donné.
 */
function drawGridAndElements(ctx, canvasInfo, zoom, config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    const originWorldPixels = latLonToWorldPixels(canvasInfo.north, canvasInfo.west, zoom);

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

    // Lignes verticales
    for (let i = 1; i <= 27; i++) {
        const startPoint = calculateAndRotatePoint(i, 1, config, a1Lat, a1Lon);
        const endPoint = calculateAndRotatePoint(i, 19, config, a1Lat, a1Lon);
        const startPixels = latLonToPixels(startPoint[1], startPoint[0]);
        const endPixels = latLonToPixels(endPoint[1], endPoint[0]);
        ctx.beginPath();
        ctx.moveTo(startPixels.x, startPixels.y);
        ctx.lineTo(endPixels.x, endPixels.y);
        ctx.stroke();
    }
    
    // Lignes horizontales
    for (let i = 1; i <= 19; i++) {
        const startPoint = calculateAndRotatePoint(1, i, config, a1Lat, a1Lon);
        const endPoint = calculateAndRotatePoint(27, i, config, a1Lat, a1Lon);
        const startPixels = latLonToPixels(startPoint[1], startPoint[0]);
        const endPixels = latLonToPixels(endPoint[1], endPoint[0]);
        ctx.beginPath();
        ctx.moveTo(startPixels.x, startPixels.y);
        ctx.lineTo(endPixels.x, endPixels.y);
        ctx.stroke();
    }

    // Étiquettes Lettres
    for (let i = 1; i <= 26; i++) {
        const labelPoint = calculateAndRotatePoint(i + 0.5, 0.5, config, a1Lat, a1Lon);
        const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
        ctx.fillText(numberToLetter(i), labelPixels.x, labelPixels.y);
    }
    
    // Étiquettes Chiffres
    for (let i = 1; i <= 18; i++) {
        const labelPoint = calculateAndRotatePoint(0.5, i + 0.5, config, a1Lat, a1Lon);
        const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
        ctx.fillText(i.toString(), labelPixels.x, labelPixels.y);
    }
    
    drawCartouche(ctx, latLonToPixels, config, a1CornerCoords);
    drawCompass(ctx, latLonToPixels, config, a1CornerCoords);
}

/**
 * Dessine le cartouche d'information.
 */
function drawCartouche(ctx, latLonToPixels, config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    
    const topLeft = latLonToPixels(calculateAndRotatePoint(1.1, 18.9, config, a1Lat, a1Lon)[1], calculateAndRotatePoint(1.1, 18.9, config, a1Lat, a1Lon)[0]);
    const bottomRight = latLonToPixels(calculateAndRotatePoint(4.5, 17.5, config, a1Lat, a1Lon)[1], calculateAndRotatePoint(4.5, 17.5, config, a1Lat, a1Lon)[0]);
    const width = bottomRight.x - topLeft.x;
    const height = bottomRight.y - topLeft.y;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillRect(topLeft.x, topLeft.y, width, height);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.strokeRect(topLeft.x, topLeft.y, width, height);

    ctx.fillStyle = 'black';
    ctx.font = '16px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    
    let textY = topLeft.y + 5;
    const lineSpacing = 20;

    if (config.referencePointChoice === 'center') {
        const refText = `Pt. Réf: ${config.latitude.toFixed(5)}, ${config.longitude.toFixed(5)}`;
        ctx.fillText(refText, topLeft.x + 5, textY);
        textY += lineSpacing;
    }

    const originText = `Origine A1: ${a1Lat.toFixed(5)}, ${a1Lon.toFixed(5)}`;
    ctx.fillText(originText, topLeft.x + 5, textY);
    textY += lineSpacing;
    
    const scaleText = `Échelle: 1 case = ${config.scale}m`;
    ctx.fillText(scaleText, topLeft.x + 5, textY);
}

/**
 * Dessine la boussole.
 */
function drawCompass(ctx, latLonToPixels, config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;

    const centerPoint = calculateAndRotatePoint(26.5, 18.5, config, a1Lat, a1Lon);
    const center = latLonToPixels(centerPoint[1], centerPoint[0]);
    
    const arrowLengthInMeters = config.scale * 0.4;
    const northGeoPoint = { lat: centerPoint[1] + (arrowLengthInMeters / 111320), lon: centerPoint[0] };
    const northPixel = latLonToPixels(northGeoPoint.lat, northGeoPoint.lon);

    const arrowLengthInPixels = Math.abs(center.y - northPixel.y);
    const N_point = { x: center.x, y: center.y - arrowLengthInPixels };

    ctx.beginPath();
    ctx.moveTo(center.x, center.y + (arrowLengthInPixels * 0.2));
    ctx.lineTo(N_point.x, N_point.y);
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(N_point.x, N_point.y);
    ctx.lineTo(N_point.x - 5, N_point.y + 10);
    ctx.lineTo(N_point.x + 5, N_point.y + 10);
    ctx.closePath();
    ctx.fillStyle = 'red';
    ctx.fill();

    ctx.fillStyle = 'black';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('N', N_point.x, N_point.y - 2);
}
