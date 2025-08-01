// imagetoprint.js

const TILE_PROVIDER_URL_DUMMY = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'; // N'est plus utilisé directement
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
        config.startCol = 'A'; config.endCol = 'Z';
        config.startRow = 1; config.endRow = 18;
        config.includeGrid = true; config.includePoints = false;
        
        const a1CornerCoords = getA1CornerCoordsForPrint(config);
        const boundingBox = getBoundingBoxForPrint(config, a1CornerCoords);
        const zoomLevel = calculateOptimalZoom(boundingBox);
        
        console.log(`Zoom optimal calculé : ${zoomLevel}`);

        loadingMessage.textContent = "Téléchargement des fonds de carte (0%)...";
        const { finalCanvas, canvasInfo } = await createFinalCanvasWithTiles(boundingBox, zoomLevel, tileProviderUrl, (progress) => {
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
    
    // CORRECTION 1: Ajustement correct des marges.
    // Les 'row' CADO augmentent du Sud vers le Nord.
    // - Marge HAUT : row = -1.5 (au nord des étiquettes à row=0.5) -> INCHANGÉ
    // - Marge BAS : row = 19.5 (au sud de la ligne de grille à row=19) -> Réduit à 19.0 pour moins de marge en bas.
    // - Marge GAUCHE : col = -1.5 (à gauche des étiquettes à col=0.5) -> Réduit à -1.0 pour moins de marge à gauche.
    // - Marge DROITE : col = 27.5 (à droite de la dernière ligne de grille à col=27) -> INCHANGÉ
    const corners = [
        { col: -1.0, row: -1.5 }, { col: 27.5, row: -1.5 },
        { col: -1.0, row: 19.0 }, { col: 27.5, row: 19.0 }
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

function tileNumbersToLatLon(x, y, zoom) {
    const n = Math.pow(2, zoom);
    const lon = x / n * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
    const lat = toDeg(latRad);
    return { lat, lon };
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
    
    // Positionne le cartouche dans le coin supérieur gauche de la grille
    const geo_tl = calculateAndRotatePoint(1.1, 18.9, config, a1Lat, a1Lon);
    const geo_br = calculateAndRotatePoint(4.5, 17.5, config, a1Lat, a1Lon);
    
    const topLeft = latLonToPixels(geo_tl[1], geo_tl[0]);
    const bottomRight = latLonToPixels(geo_br[1], geo_br[0]);
    const width = bottomRight.x - topLeft.x;
    const height = bottomRight.y - topLeft.y;

    // CORRECTION 3: Fond blanc opaque
    ctx.fillStyle = 'white';
    ctx.fillRect(topLeft.x, topLeft.y, width, height);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.strokeRect(topLeft.x, topLeft.y, width, height);

    ctx.fillStyle = 'black';
    // CORRECTION 3: Police agrandie
    ctx.font = '22px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    
    let textY = topLeft.y + 8;
    // CORRECTION 3: Espacement des lignes augmenté
    const lineSpacing = 28;

    if (config.referencePointChoice === 'center') {
        const refText = `Pt. Réf: ${config.latitude.toFixed(5)}, ${config.longitude.toFixed(5)}`;
        ctx.fillText(refText, topLeft.x + 8, textY);
        textY += lineSpacing;
    }

    const originText = `Origine A1: ${a1Lat.toFixed(5)}, ${a1Lon.toFixed(5)}`;
    ctx.fillText(originText, topLeft.x + 8, textY);
    textY += lineSpacing;
    
    const scaleText = `Échelle: 1 case = ${config.scale}m`;
    ctx.fillText(scaleText, topLeft.x + 8, textY);
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
// CORRECTION 2: La clé est maintenant dessinée dans la cellule A1.
function drawSubdivisionKey(ctx, latLonToPixels, config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;

    // Définir les 4 coins géographiques de la cellule A1.
    // Une cellule (ex: A1) va de col=1 à col=2, et de row=1 à row=2.
    const geo_bl = calculateAndRotatePoint(1, 1, config, a1Lat, a1Lon); // Bottom-Left
    const geo_br = calculateAndRotatePoint(2, 1, config, a1Lat, a1Lon); // Bottom-Right
    const geo_tl = calculateAndRotatePoint(1, 2, config, a1Lat, a1Lon); // Top-Left
    const geo_tr = calculateAndRotatePoint(2, 2, config, a1Lat, a1Lon); // Top-Right

    // Convertir ces 4 points en pixels sur le canevas
    const px_bl = latLonToPixels(geo_bl[1], geo_bl[0]);
    const px_tl = latLonToPixels(geo_tl[1], geo_tl[0]);
    const px_tr = latLonToPixels(geo_tr[1], geo_tr[0]);
    const px_br = latLonToPixels(geo_br[1], geo_br[0]);

    // Calculer le point central de la cellule A1 en pixels
    const midX = (px_tl.x + px_tr.x + px_bl.x + px_br.x) / 4;
    const midY = (px_tl.y + px_tr.y + px_bl.y + px_br.y) / 4;

    // Dessiner les 4 quarts de couleur
    // Haut-gauche (Jaune)
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    ctx.lineTo(px_tl.x, px_tl.y);
    ctx.lineTo(px_bl.x, px_bl.y); // Changé pour dessiner un triangle correct
    ctx.closePath();
    ctx.fillStyle = '#FFFF00'; // Jaune
    ctx.fill();

    // Haut-droit (Bleu)
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    ctx.lineTo(px_tr.x, px_tr.y);
    ctx.lineTo(px_tl.x, px_tl.y); // Changé
    ctx.closePath();
    ctx.fillStyle = '#0000FF'; // Bleu
    ctx.fill();

    // Bas-gauche (Vert)
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    ctx.lineTo(px_bl.x, px_bl.y);
    ctx.lineTo(px_br.x, px_br.y); // Changé
    ctx.closePath();
    ctx.fillStyle = '#008000'; // Vert
    ctx.fill();
    
    // Bas-droit (Rouge)
    ctx.beginPath();
    ctx.moveTo(midX, midY);
    ctx.lineTo(px_br.x, px_br.y);
    ctx.lineTo(px_tr.x, px_tr.y); // Changé
    ctx.closePath();
    ctx.fillStyle = '#FF0000'; // Rouge
    ctx.fill();

    // Dessiner le contour de la cellule A1 par-dessus pour délimiter
    ctx.beginPath();
    ctx.moveTo(px_tl.x, px_tl.y);
    ctx.lineTo(px_tr.x, px_tr.y);
    ctx.lineTo(px_br.x, px_br.y);
    ctx.lineTo(px_bl.x, px_bl.y);
    ctx.closePath();
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.stroke();
}
