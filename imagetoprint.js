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
        const { finalCanvas, canvasInfo } = await createFinalCanvas(boundingBox, zoomLevel, (progress) => {
            loadingMessage.textContent = `Téléchargement des fonds de carte (${progress.toFixed(0)}%)...`;
        });

        loadingMessage.textContent = "Dessin du carroyage...";
        const finalCtx = finalCanvas.getContext('2d');
        drawGridAndElements(finalCtx, canvasInfo, zoomLevel, config, a1CornerCoords);
        
        const fileName = `${config.gridName}_Print_26x18.png`;
        finalCanvas.toBlob((blob) => {
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
 * Calcule la position de l'origine A1.
 */
function getA1CornerCoordsForPrint(config) {
    const refLat = config.latitude;
    const refLon = config.longitude;
    const metersToLatDegrees = (meters) => meters / 111320;
    const metersToLonDegrees = (meters, lat) => meters / (111320 * Math.cos(toRad(lat)));

    if (config.referencePointChoice === 'origin') {
        return [refLon, refLat];
    } else { // 'center'
        const centerColOffset = getOffsetInCells(14);
        const centerRowOffset = getOffsetInCells(10);
        const xOffsetMeters = centerColOffset * config.scale;
        const yOffsetMeters = centerRowOffset * config.scale;
        const a1Lon = refLon - metersToLonDegrees(xOffsetMeters, refLat);
        const a1Lat = refLat - metersToLatDegrees(yOffsetMeters, refLat);
        return [a1Lon, a1Lat];
    }
}

/**
 * Calcule la Bounding Box pour la zone à afficher (grille + marges).
 */
function getBoundingBoxForPrint(config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    const corners = [
        { col: -1.5, row: -1.5 }, { col: 27.5, row: -1.5 },
        { col: -1.5, row: 19.5 }, { col: 27.5, row: 19.5 }
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
    const targetWidthInPixels = 3500;
    const zoomApproximation = Math.log2(360 * targetWidthInPixels / (lonDiff * TILE_SIZE));
    return Math.min(Math.floor(zoomApproximation), MAX_ZOOM);
}

// --- Fonctions utilitaires de projection ---
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

/**
 * Crée le canevas final et y assemble les tuiles.
 */
async function createFinalCanvas(boundingBox, zoom, onProgress) {
    const nwTile = latLonToTileNumbers(boundingBox.north, boundingBox.west, zoom);
    const seTile = latLonToTileNumbers(boundingBox.south, boundingBox.east, zoom);

    // Calculer les dimensions exactes en pixels de la Bounding Box
    const nwPixel = latLonToWorldPixels(boundingBox.north, boundingBox.west, zoom);
    const sePixel = latLonToWorldPixels(boundingBox.south, boundingBox.east, zoom);
    const canvasWidth = sePixel.x - nwPixel.x;
    const canvasHeight = sePixel.y - nwPixel.y;
    
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = canvasWidth;
    finalCanvas.height = canvasHeight;
    const ctx = finalCanvas.getContext('2d');

    const totalTiles = (seTile.x - nwTile.x + 1) * (seTile.y - nwTile.y + 1);
    if (totalTiles <= 0 || totalTiles > 1000) {
        throw new Error(`Nombre de tuiles à télécharger invalide ou trop élevé (${totalTiles}).`);
    }

    let downloadedCount = 0;
    const tilePromises = [];

    for (let x = nwTile.x; x <= seTile.x; x++) {
        for (let y = nwTile.y; y <= seTile.y; y++) {
            const tileUrl = TILE_PROVIDER_URL.replace('{z}', zoom).replace('{x}', x).replace('{y}', y);
            const promise = new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = "Anonymous";
                img.onload = () => {
                    const canvasX = (x * TILE_SIZE) - nwPixel.x;
                    const canvasY = (y * TILE_SIZE) - nwPixel.y;
                    ctx.drawImage(img, canvasX, canvasY);
                    downloadedCount++;
                    onProgress((downloadedCount / totalTiles) * 100);
                    resolve();
                };
                img.onerror = () => reject(new Error(`Impossible de charger la tuile: ${tileUrl}`));
                img.src = tileUrl;
            });
            tilePromises.push(promise);
        }
    }

    await Promise.all(tilePromises);
    
    // canvasInfo contient les coordonnées géo du coin supérieur gauche du canevas final
    const canvasInfo = { north: boundingBox.north, west: boundingBox.west };
    return { finalCanvas, canvasInfo };
}

/**
 * Dessine la grille et tous les éléments sur le canevas final.
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
    drawSubdivisionKey(ctx, latLonToPixels, config, a1CornerCoords);
}

/**
 * Dessine le cartouche d'information.
 */
function drawCartouche(ctx, latLonToPixels, config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    
    const topLeft = latLonToPixels(calculateAndRotatePoint(1.1, 18.9, config, a1Lat, a1Lon)[1], calculateAndRotatePoint(1.1, 18.9, config, a1Lat, a1Lon)[0]);
    const bottomRight = latLonToPixels(calculateAndRotatePoint(4.1, 17.9, config, a1Lat, a1Lon)[1], calculateAndRotatePoint(4.1, 17.9, config, a1Lat, a1Lon)[0]);
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

/**
 * Dessine la clé de subdivision en 4 couleurs.
 */
function drawSubdivisionKey(ctx, latLonToPixels, config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;

    const topLeft = latLonToPixels(calculateAndRotatePoint(0, 1, config, a1Lat, a1Lon)[1], calculateAndRotatePoint(0, 1, config, a1Lat, a1Lon)[0]);
    const topRight = latLonToPixels(calculateAndRotatePoint(1, 1, config, a1Lat, a1Lon)[1], calculateAndRotatePoint(1, 1, config, a1Lat, a1Lon)[0]);
    const bottomLeft = latLonToPixels(calculateAndRotatePoint(0, 0, config, a1Lat, a1Lon)[1], calculateAndRotatePoint(0, 0, config, a1Lat, a1Lon)[0]);

    const midX = (topLeft.x + topRight.x) / 2;
    const midY = (topLeft.y + bottomLeft.y) / 2;

    const halfWidth = (topRight.x - topLeft.x) / 2;
    const halfHeight = (bottomLeft.y - topLeft.y) / 2;

    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.strokeRect(topLeft.x, topLeft.y, halfWidth * 2, halfHeight * 2);

    ctx.fillStyle = '#FFFF00'; // Jaune
    ctx.fillRect(topLeft.x, topLeft.y, halfWidth, halfHeight);

    ctx.fillStyle = '#0000FF'; // Bleu
    ctx.fillRect(midX, topLeft.y, halfWidth, halfHeight);

    ctx.fillStyle = '#008000'; // Vert
    ctx.fillRect(topLeft.x, midY, halfWidth, halfHeight);

    ctx.fillStyle = '#FF0000'; // Rouge
    ctx.fillRect(midX, midY, halfWidth, halfHeight);
}
