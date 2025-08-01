// imagetoprint.js

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
        
        const tileProviderUrl = document.getElementById('map-tile-provider').value;

        const config = getGridConfiguration(
            parseFloat(coordsStr.split(',')[0]),
            parseFloat(coordsStr.split(',')[1])
        );
        config.includeGrid = true;
        config.includePoints = false;
        
        const a1CornerCoords = getA1CornerCoordsForPrint(config);
        const boundingBox = getBoundingBoxForPrint(config, a1CornerCoords);
        const zoomLevel = calculateOptimalZoom(boundingBox);
        
        console.log(`Zoom optimal calculé pour grille ${config.endCol}${config.endRow}: ${zoomLevel}`);

        loadingMessage.textContent = "Téléchargement des fonds de carte (0%)...";
        const { finalCanvas, canvasInfo } = await createFinalCanvasWithTiles(boundingBox, zoomLevel, tileProviderUrl, (progress) => {
            loadingMessage.textContent = `Téléchargement des fonds de carte (${progress.toFixed(0)}%)...`;
        });

        loadingMessage.textContent = "Dessin du carroyage...";
        const finalCtx = finalCanvas.getContext('2d');
        drawGridAndElements(finalCtx, canvasInfo, zoomLevel, config, a1CornerCoords);
        
        const fileName = `${config.gridName}_Print.png`;
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
 * Calcule la position de l'origine A1 de manière dynamique.
 */
function getA1CornerCoordsForPrint(config) {
    const refLat = config.latitude;
    const refLon = config.longitude;
    const metersToLatDegrees = (meters) => meters / 111320;
    const metersToLonDegrees = (meters, lat) => meters / (111320 * Math.cos(toRad(lat)));

    if (config.referencePointChoice === 'origin') {
        return [refLon, refLat];
    } else { // 'center'
        const numCols = letterToNumber(config.endCol) - letterToNumber(config.startCol) + 1;
        const numRows = config.endRow - config.startRow + 1;
        
        const centerColOffset = (numCols / 2);
        const centerRowOffset = (numRows / 2);

        const xOffsetMeters = centerColOffset * config.scale;
        const yOffsetMeters = centerRowOffset * config.scale;
        
        const a1Lon = refLon - metersToLonDegrees(xOffsetMeters, refLat);
        const a1Lat = refLat - metersToLatDegrees(yOffsetMeters, refLat);
        return [a1Lon, a1Lat];
    }
}

/**
 * Calcule la Bounding Box de manière dynamique pour la zone à afficher.
 */
function getBoundingBoxForPrint(config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;

    const margeHaute = 0.5;
    const margeBasse = 0.5;
    const margeGauche = 0.5;
    const margeDroite = 0.5;

    const contentBounds = {
        minCol: 0.5,
        maxCol: letterToNumber(config.endCol) + 1,
        minRow: 0.5,
        maxRow: config.endRow + 1
    };

    const contentCorners = [
        calculateAndRotatePoint(contentBounds.minCol, contentBounds.minRow, config, a1Lat, a1Lon),
        calculateAndRotatePoint(contentBounds.maxCol, contentBounds.minRow, config, a1Lat, a1Lon),
        calculateAndRotatePoint(contentBounds.minCol, contentBounds.maxRow, config, a1Lat, a1Lon),
        calculateAndRotatePoint(contentBounds.maxCol, contentBounds.maxRow, config, a1Lat, a1Lon)
    ].map(p => ({ lon: p[0], lat: p[1] }));

    let minLat = Math.min(...contentCorners.map(c => c.lat));
    let maxLat = Math.max(...contentCorners.map(c => c.lat));
    let minLon = Math.min(...contentCorners.map(c => c.lon));
    let maxLon = Math.max(...contentCorners.map(c => c.lon));

    const metersToLat = (meters) => meters / 111320;
    const metersToLon = (meters, lat) => meters / (111320 * Math.cos(toRad(lat)));
    const avgLat = (minLat + maxLat) / 2;

    minLat -= metersToLat(margeBasse * config.scale);
    maxLat += metersToLat(margeHaute * config.scale);
    minLon -= metersToLon(margeGauche * config.scale, avgLat);
    maxLon += metersToLon(margeDroite * config.scale, avgLat);

    return { north: maxLat, south: minLat, east: maxLon, west: minLon };
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
async function createFinalCanvasWithTiles(boundingBox, zoom, tileProviderUrl, onProgress) {
    const nwPixel = latLonToWorldPixels(boundingBox.north, boundingBox.west, zoom);
    const sePixel = latLonToWorldPixels(boundingBox.south, boundingBox.east, zoom);
    const canvasWidth = Math.abs(sePixel.x - nwPixel.x);
    const canvasHeight = Math.abs(sePixel.y - nwPixel.y);
    
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = canvasWidth;
    finalCanvas.height = canvasHeight;
    const ctx = finalCanvas.getContext('2d');

    const nwTile = latLonToTileNumbers(boundingBox.north, boundingBox.west, zoom);
    const seTile = latLonToTileNumbers(boundingBox.south, boundingBox.east, zoom);

    const totalTiles = (seTile.x - nwTile.x + 1) * (seTile.y - nwTile.y + 1);
    if (totalTiles <= 0 || totalTiles > 1000) {
        throw new Error(`Nombre de tuiles à télécharger invalide ou trop élevé (${totalTiles}).`);
    }

    let downloadedCount = 0;
    const tilePromises = [];

    for (let x = nwTile.x; x <= seTile.x; x++) {
        for (let y = nwTile.y; y <= seTile.y; y++) {
            let tileUrl = tileProviderUrl.replace('{z}', zoom);
            if (tileUrl.includes('{y}/{x}')) {
                tileUrl = tileUrl.replace('{y}', y).replace('{x}', x);
            } else {
                tileUrl = tileUrl.replace('{x}', x).replace('{y}', y);
            }

            const promise = new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = "Anonymous";
                img.onload = () => {
                    const tileX = (x * TILE_SIZE) - nwPixel.x;
                    const tileY = (y * TILE_SIZE) - nwPixel.y;
                    ctx.drawImage(img, tileX, tileY);
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
    ctx.font = 'bold 30px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const startColNum = letterToNumber(config.startCol);
    const endColNum = letterToNumber(config.endCol);
    const startRowNum = config.startRow;
    const endRowNum = config.endRow;

    // Lignes verticales
    for (let i = startColNum; i <= endColNum + 1; i++) {
        const startPoint = calculateAndRotatePoint(i, startRowNum, config, a1Lat, a1Lon);
        const endPoint = calculateAndRotatePoint(i, endRowNum + 1, config, a1Lat, a1Lon);
        const startPixels = latLonToPixels(startPoint[1], startPoint[0]);
        const endPixels = latLonToPixels(endPoint[1], endPoint[0]);
        ctx.beginPath(); ctx.moveTo(startPixels.x, startPixels.y); ctx.lineTo(endPixels.x, endPixels.y); ctx.stroke();
    }
    
    // Lignes horizontales
    for (let i = startRowNum; i <= endRowNum + 1; i++) {
        const startPoint = calculateAndRotatePoint(startColNum, i, config, a1Lat, a1Lon);
        const endPoint = calculateAndRotatePoint(endColNum + 1, i, config, a1Lat, a1Lon);
        const startPixels = latLonToPixels(startPoint[1], startPoint[0]);
        const endPixels = latLonToPixels(endPoint[1], endPoint[0]);
        ctx.beginPath(); ctx.moveTo(startPixels.x, startPixels.y); ctx.lineTo(endPixels.x, endPixels.y); ctx.stroke();
    }

    // Étiquettes Lettres
    for (let i = startColNum; i <= endColNum; i++) {
        const labelPoint = calculateAndRotatePoint(i + 0.5, startRowNum - 0.5, config, a1Lat, a1Lon);
        const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
        ctx.fillText(numberToLetter(i), labelPixels.x, labelPixels.y);
    }
    
    // Étiquettes Chiffres
    for (let i = startRowNum; i <= endRowNum; i++) {
        const labelPoint = calculateAndRotatePoint(startColNum - 0.5, i + 0.5, config, a1Lat, a1Lon);
        const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
        ctx.fillText(i.toString(), labelPixels.x, labelPixels.y);
    }
    
    drawCartouche(ctx, latLonToPixels, config, a1CornerCoords);
    drawCompass(ctx, latLonToPixels, config, a1CornerCoords);
    drawSubdivisionKey(ctx, latLonToPixels, config, a1CornerCoords);
    drawReferenceCross(ctx, latLonToPixels, config);
}

/**
 * Dessine le cartouche d'information avec une police de taille dynamique.
 */
function drawCartouche(ctx, latLonToPixels, config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    
    // CORRECTION 1: Positionnement dynamique en haut à gauche de la grille visible.
    const startColNum = letterToNumber(config.startCol);
    const endRowNum = config.endRow;
    const geo_tl = calculateAndRotatePoint(startColNum + 0.1, endRowNum + 0.9, config, a1Lat, a1Lon);
    const geo_br = calculateAndRotatePoint(startColNum + 3.5, endRowNum - 0.5, config, a1Lat, a1Lon);
    
    const topLeft = latLonToPixels(geo_tl[1], geo_tl[0]);
    const bottomRight = latLonToPixels(geo_br[1], geo_br[0]);
    const width = bottomRight.x - topLeft.x;
    const height = bottomRight.y - topLeft.y;

    const FONT_SIZE_RATIO = 0.18; 
    let fontSize = Math.floor(height * FONT_SIZE_RATIO);
    fontSize = Math.max(12, Math.min(fontSize, 30));

    ctx.font = `${fontSize}px Arial`;
    const lineSpacing = fontSize * 1.3;
    const padding = fontSize * 0.4;

    ctx.fillStyle = 'white';
    ctx.fillRect(topLeft.x, topLeft.y, width, height);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.strokeRect(topLeft.x, topLeft.y, width, height);

    ctx.fillStyle = 'black';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    
    let textY = topLeft.y + padding;

    if (config.referencePointChoice === 'center') {
        const refText = `Pt. Réf: ${config.latitude.toFixed(5)}, ${config.longitude.toFixed(5)}`;
        ctx.fillText(refText, topLeft.x + padding, textY);
        textY += lineSpacing;
    }

    const originText = `Origine A1: ${a1Lat.toFixed(5)}, ${a1Lon.toFixed(5)}`;
    ctx.fillText(originText, topLeft.x + padding, textY);
    textY += lineSpacing;
    
    const scaleText = `Échelle: 1 case = ${config.scale}m`;
    ctx.fillText(scaleText, topLeft.x + padding, textY);
}

/**
 * Dessine la boussole de manière dynamique.
 */
function drawCompass(ctx, latLonToPixels, config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    
    // CORRECTION 1: Positionnement dynamique en haut à droite.
    const endColNum = letterToNumber(config.endCol);
    const endRowNum = config.endRow;
    const centerPoint = calculateAndRotatePoint(endColNum + 0.5, endRowNum + 0.5, config, a1Lat, a1Lon);
    const center = latLonToPixels(centerPoint[1], centerPoint[0]);
    
    // CORRECTION 3: La flèche est plus petite pour rester dans le cercle.
    const arrowLengthInMeters = config.scale * 0.35; 
    const northGeoPoint = { lat: centerPoint[1] + (arrowLengthInMeters / 111320), lon: centerPoint[0] };
    const northPixel = latLonToPixels(northGeoPoint.lat, northGeoPoint.lon);

    const arrowLengthInPixels = Math.abs(center.y - northPixel.y);
    const radius = arrowLengthInPixels * 1.2;

    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = 'rgba(200, 200, 200, 0.7)';
    ctx.fill();
    
    const N_point = { x: center.x, y: center.y - arrowLengthInPixels };

    ctx.beginPath();
    ctx.moveTo(center.x, center.y + (arrowLengthInPixels * 0.3)); // Point de départ plus bas
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
    // CORRECTION 3: Texte "N" légèrement abaissé.
    ctx.fillText('N', N_point.x, N_point.y + 2); 
}

/**
 * Dessine la clé de subdivision en 4 couleurs.
 */
function drawSubdivisionKey(ctx, latLonToPixels, config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;

    // CORRECTION 1: Positionnement dynamique sur la case en bas à gauche.
    const startColNum = letterToNumber(config.startCol);
    const startRowNum = config.startRow;

    const geo_bl = calculateAndRotatePoint(startColNum, startRowNum, config, a1Lat, a1Lon);
    const geo_br = calculateAndRotatePoint(startColNum + 1, startRowNum, config, a1Lat, a1Lon);
    const geo_tl = calculateAndRotatePoint(startColNum, startRowNum + 1, config, a1Lat, a1Lon);
    const geo_tr = calculateAndRotatePoint(startColNum + 1, startRowNum + 1, config, a1Lat, a1Lon);
    const geo_center = calculateAndRotatePoint(startColNum + 0.5, startRowNum + 0.5, config, a1Lat, a1Lon);

    const px_tl = latLonToPixels(geo_tl[1], geo_tl[0]);
    const px_tr = latLonToPixels(geo_tr[1], geo_tr[0]);
    const px_bl = latLonToPixels(geo_bl[1], geo_bl[0]);
    const px_br = latLonToPixels(geo_br[1], geo_br[0]);
    const px_center = latLonToPixels(geo_center[1], geo_center[0]);
    
    const opacity = '0.7';
    
    ctx.fillStyle = `rgba(255, 255, 0, ${opacity})`; // Jaune
    ctx.beginPath(); ctx.moveTo(px_tl.x, px_tl.y); ctx.lineTo(px_center.x, px_tl.y); ctx.lineTo(px_center.x, px_center.y); ctx.lineTo(px_tl.x, px_center.y); ctx.closePath(); ctx.fill();
    
    ctx.fillStyle = `rgba(0, 0, 255, ${opacity})`; // Bleu
    ctx.beginPath(); ctx.moveTo(px_center.x, px_tr.y); ctx.lineTo(px_tr.x, px_tr.y); ctx.lineTo(px_tr.x, px_center.y); ctx.lineTo(px_center.x, px_center.y); ctx.closePath(); ctx.fill();
    
    ctx.fillStyle = `rgba(0, 128, 0, ${opacity})`; // Vert
    ctx.beginPath(); ctx.moveTo(px_bl.x, px_center.y); ctx.lineTo(px_center.x, px_center.y); ctx.lineTo(px_center.x, px_bl.y); ctx.lineTo(px_bl.x, px_bl.y); ctx.closePath(); ctx.fill();
    
    ctx.fillStyle = `rgba(255, 0, 0, ${opacity})`; // Rouge
    ctx.beginPath(); ctx.moveTo(px_center.x, px_center.y); ctx.lineTo(px_br.x, px_center.y); ctx.lineTo(px_br.x, px_br.y); ctx.lineTo(px_center.x, px_br.y); ctx.closePath(); ctx.fill();

    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px_tl.x, px_tl.y); ctx.lineTo(px_tr.x, px_tr.y); ctx.lineTo(px_br.x, px_br.y); ctx.lineTo(px_bl.x, px_bl.y); ctx.closePath();
    ctx.stroke();
}

/**
 * Dessine la croix du point de référence de l'utilisateur.
 */
function drawReferenceCross(ctx, latLonToPixels, config) {
    const refPointCoords = { lat: config.latitude, lon: config.longitude };
    const center = latLonToPixels(refPointCoords.lat, refPointCoords.lon);
    
    const crossSize = 15;
    
    ctx.strokeStyle = '#FF0000';
    ctx.lineWidth = 3;
    
    ctx.beginPath();
    ctx.moveTo(center.x, center.y - crossSize);
    ctx.lineTo(center.x, center.y + crossSize);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(center.x - crossSize, center.y);
    ctx.lineTo(center.x + crossSize, center.y);
    ctx.stroke();
}
