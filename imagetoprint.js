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
        
        // 1. Configuration de la grille (26x18 pour les données)
        const config = getGridConfiguration(
            parseFloat(coordsStr.split(',')[0]),
            parseFloat(coordsStr.split(',')[1])
        );
        config.startCol = 'A'; config.endCol = 'Z';
        config.startRow = 1; config.endRow = 18;
        config.includeGrid = true; config.includePoints = false;
        
        // 2. Calcul des positions clés
        const a1CornerCoords = getA1CornerCoordsForPrint(config);
        const boundingBox = getBoundingBoxForPrint(config, a1CornerCoords);
        const zoomLevel = calculateOptimalZoom(boundingBox);
        
        console.log(`Zoom optimal calculé : ${zoomLevel}`);

        // 3. Téléchargement et assemblage du fond de carte sur un canevas de travail
        loadingMessage.textContent = "Téléchargement des fonds de carte (0%)...";
        const { mapImage: workingCanvas, tileInfo } = await fetchAndAssembleTiles(boundingBox, zoomLevel, (progress) => {
            loadingMessage.textContent = `Téléchargement des fonds de carte (${progress.toFixed(0)}%)...`;
        });

        // 4. Dessin de la grille et des éléments (cartouche, boussole) sur le canevas de travail
        loadingMessage.textContent = "Dessin du carroyage...";
        const workingCtx = workingCanvas.getContext('2d');
        drawGridOnCanvasForPrint(workingCtx, tileInfo, zoomLevel, config, a1CornerCoords);

        // 5. Rognage de l'image finale
        loadingMessage.textContent = "Finalisation de l'image...";
        const finalCanvas = cropFinalImage(workingCanvas, tileInfo, zoomLevel, config, a1CornerCoords);
        
        // 6. Exportation en PNG
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
    const targetWidthInPixels = 1500; // Viser une image d'environ 1500px de large
    if (lonDiff === 0) return MAX_ZOOM;
    const zoomApproximation = Math.log2(360 * targetWidthInPixels / (lonDiff * TILE_SIZE));
    return Math.min(Math.floor(zoomApproximation), MAX_ZOOM);
}

// ... (Les fonctions de conversion géographiques standards restent les mêmes)
function latLonToWorldPixels(lat, lon, zoom) { /* ... */ }
function latLonToTileNumbers(lat, lon, zoom) { /* ... */ }
function tileNumbersToLatLon(x, y, zoom) { /* ... */ }

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
 * Dessine la grille et les éléments additionnels (cartouche, boussole) sur le canevas.
 */
function drawGridOnCanvasForPrint(ctx, tileInfo, zoom, config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    const originWorldPixels = { x: tileInfo.minX * TILE_SIZE, y: tileInfo.minY * TILE_SIZE };

    const latLonToPixels = (lat, lon) => {
        const worldPixels = latLonToWorldPixels(lat, lon, zoom);
        return {
            x: worldPixels.x - originWorldPixels.x,
            y: worldPixels.y - originWorldPixels.y
        };
    };

    // Style de la grille
    ctx.strokeStyle = config.gridColor;
    ctx.lineWidth = 2;
    ctx.fillStyle = config.gridColor;
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Lignes verticales (de A=1 à Z+1=27)
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
    
    // Lignes horizontales (de 1 à 18+1=19)
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

    // Étiquettes Lettres (de A=1 à Z=26)
    for (let i = 1; i <= 26; i++) {
        const labelPoint = calculateAndRotatePoint(i + 0.5, 0.5, config, a1Lat, a1Lon);
        const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
        ctx.fillText(numberToLetter(i), labelPixels.x, labelPixels.y);
    }
    
    // Étiquettes Chiffres (de 1 à 18)
    for (let i = 1; i <= 18; i++) {
        const labelPoint = calculateAndRotatePoint(0.5, i + 0.5, config, a1Lat, a1Lon);
        const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
        ctx.fillText(i.toString(), labelPixels.x, labelPixels.y);
    }
    
    // NOUVEAU : Dessiner les éléments additionnels
    drawCartouche(ctx, latLonToPixels, config, a1CornerCoords);
    drawCompass(ctx, latLonToPixels, config, a1CornerCoords);
}

/**
 * NOUVEAU : Dessine le cartouche d'information.
 */
function drawCartouche(ctx, latLonToPixels, config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    
    // Position et dimensions du cartouche (sur la zone A18-C18)
    const topLeft = latLonToPixels(calculateAndRotatePoint(1.1, 18.9, config, a1Lat, a1Lon)[1], calculateAndRotatePoint(1.1, 18.9, config, a1Lat, a1Lon)[0]);
    const bottomRight = latLonToPixels(calculateAndRotatePoint(4.5, 17.5, config, a1Lat, a1Lon)[1], calculateAndRotatePoint(4.5, 17.5, config, a1Lat, a1Lon)[0]);
    const width = bottomRight.x - topLeft.x;
    const height = bottomRight.y - topLeft.y;

    // Dessin du fond blanc semi-transparent
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillRect(topLeft.x, topLeft.y, width, height);
    // Dessin de la bordure
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.strokeRect(topLeft.x, topLeft.y, width, height);

    // Préparation du texte
    ctx.fillStyle = 'black';
    ctx.font = '16px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    
    let textY = topLeft.y + 5;
    const lineSpacing = 20;

    // Afficher le point de référence s'il est différent de l'origine
    if (config.referencePointChoice === 'center') {
        const refText = `Pt. Référence: ${config.latitude.toFixed(5)}, ${config.longitude.toFixed(5)}`;
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
 * NOUVEAU : Dessine la boussole.
 */
function drawCompass(ctx, latLonToPixels, config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;

    // Centre de la case Z18 (26ème colonne, 18ème ligne)
    const centerPoint = calculateAndRotatePoint(26.5, 18.5, config, a1Lat, a1Lon);
    const center = latLonToPixels(centerPoint[1], centerPoint[0]);
    
    const arrowLength = config.scale * 0.3; // Longueur de la flèche en fonction de l'échelle
    const arrowLengthInPixels = latLonToPixels(centerPoint[1] + (arrowLength / 111320), centerPoint[0]).y - center.y;

    const N_point = { x: center.x, y: center.y - Math.abs(arrowLengthInPixels) };

    // Ligne de la flèche
    ctx.beginPath();
    ctx.moveTo(center.x, center.y + Math.abs(arrowLengthInPixels));
    ctx.lineTo(N_point.x, N_point.y);
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Tête de flèche
    ctx.beginPath();
    ctx.moveTo(N_point.x, N_point.y);
    ctx.lineTo(N_point.x - 5, N_point.y + 10);
    ctx.lineTo(N_point.x + 5, N_point.y + 10);
    ctx.closePath();
    ctx.fillStyle = 'red';
    ctx.fill();

    // Texte "N"
    ctx.fillStyle = 'black';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('N', N_point.x, N_point.y - 2);
}

/**
 * NOUVEAU : Rogne le canevas de travail pour ne garder que la zone d'intérêt.
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

    // Définir la zone de rognage avec une marge d'une demi-case
    const cropStartPoint = calculateAndRotatePoint(0.5, 0.5, config, a1Lat, a1Lon);
    const cropEndPoint = calculateAndRotatePoint(27.5, 19.5, config, a1Lat, a1Lon);

    const startPixels = latLonToPixels(cropStartPoint[1], cropStartPoint[0]);
    const endPixels = latLonToPixels(cropEndPoint[1], cropEndPoint[0]);
    
    const cropX = startPixels.x;
    const cropY = endPixels.y; // En Mercator, le Y est inversé
    const cropWidth = endPixels.x - startPixels.x;
    const cropHeight = startPixels.y - endPixels.y;

    // Créer le canevas final aux dimensions rognées
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = cropWidth;
    finalCanvas.height = cropHeight;
    const finalCtx = finalCanvas.getContext('2d');
    
    // Copier la portion désirée depuis le grand canevas
    finalCtx.drawImage(workingCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    
    return finalCanvas;
}
