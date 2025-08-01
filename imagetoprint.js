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
// CORRECTION 1: Fonction réécrite pour plus de clarté et de robustesse.
function getBoundingBoxForPrint(config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;

    // Définition des marges en nombre de "cases".
    // Ces marges sont appliquées par rapport aux limites extérieures des étiquettes.
    const margeHaute = 0.5;  // 0.5 case au-dessus des étiquettes des colonnes
    const margeBasse = 0.5;  // 0.5 case en-dessous de la dernière ligne de grille
    const margeGauche = 0.5; // 0.5 case à gauche des étiquettes des lignes
    const margeDroite = 0.5; // 0.5 case à droite de la dernière ligne de grille

    // Définir les limites du contenu (grille + étiquettes) en indices de la grille
    const contentBounds = {
        minCol: 0.5, // Centre de l'étiquette de ligne la plus à gauche
        maxCol: 27,  // Ligne de grille la plus à droite
        minRow: 0.5, // Centre de l'étiquette de colonne la plus haute
        maxRow: 19   // Ligne de grille la plus basse
    };

    // Calculer les 4 coins extrêmes du contenu
    const contentCorners = [
        calculateAndRotatePoint(contentBounds.minCol, contentBounds.minRow, config, a1Lat, a1Lon), // Top-Left of content
        calculateAndRotatePoint(contentBounds.maxCol, contentBounds.minRow, config, a1Lat, a1Lon), // Top-Right
        calculateAndRotatePoint(contentBounds.minCol, contentBounds.maxRow, config, a1Lat, a1Lon), // Bottom-Left
        calculateAndRotatePoint(contentBounds.maxCol, contentBounds.maxRow, config, a1Lat, a1Lon)  // Bottom-Right
    ].map(p => ({ lon: p[0], lat: p[1] }));

    // Trouver la bounding box du contenu seul
    let minLat = Math.min(...contentCorners.map(c => c.lat));
    let maxLat = Math.max(...contentCorners.map(c => c.lat));
    let minLon = Math.min(...contentCorners.map(c => c.lon));
    let maxLon = Math.max(...contentCorners.map(c => c.lon));

    // Ajouter les marges en mètres
    const metersToLat = (meters) => meters / 111320;
    const metersToLon = (meters, lat) => meters / (111320 * Math.cos(toRad(lat)));

    minLat -= metersToLat(margeBasse * config.scale);
    maxLat += metersToLat(margeHaute * config.scale);
    minLon -= metersToLon(margeGauche * config.scale, (minLat + maxLat) / 2);
    maxLon += metersToLon(margeDroite * config.scale, (minLat + maxLat) / 2);

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

// ... (Le reste des fonctions utilitaires ne change pas)

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

    // ... (Le dessin des lignes et étiquettes ne change pas) ...
    for (let i = 1; i <= 27; i++) {
        const startPoint = calculateAndRotatePoint(i, 1, config, a1Lat, a1Lon);
        const endPoint = calculateAndRotatePoint(i, 19, config, a1Lat, a1Lon);
        const startPixels = latLonToPixels(startPoint[1], startPoint[0]);
        const endPixels = latLonToPixels(endPoint[1], endPoint[0]);
        ctx.beginPath(); ctx.moveTo(startPixels.x, startPixels.y); ctx.lineTo(endPixels.x, endPixels.y); ctx.stroke();
    }
    for (let i = 1; i <= 19; i++) {
        const startPoint = calculateAndRotatePoint(1, i, config, a1Lat, a1Lon);
        const endPoint = calculateAndRotatePoint(27, i, config, a1Lat, a1Lon);
        const startPixels = latLonToPixels(startPoint[1], startPoint[0]);
        const endPixels = latLonToPixels(endPoint[1], endPoint[0]);
        ctx.beginPath(); ctx.moveTo(startPixels.x, startPixels.y); ctx.lineTo(endPixels.x, endPixels.y); ctx.stroke();
    }
    for (let i = 1; i <= 26; i++) {
        const labelPoint = calculateAndRotatePoint(i + 0.5, 0.5, config, a1Lat, a1Lon);
        const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
        ctx.fillText(numberToLetter(i), labelPixels.x, labelPixels.y);
    }
    for (let i = 1; i <= 18; i++) {
        const labelPoint = calculateAndRotatePoint(0.5, i + 0.5, config, a1Lat, a1Lon);
        const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
        ctx.fillText(i.toString(), labelPixels.x, labelPixels.y);
    }
    
    drawCartouche(ctx, latLonToPixels, config, a1CornerCoords);
    drawCompass(ctx, latLonToPixels, config, a1CornerCoords);
    drawSubdivisionKey(ctx, latLonToPixels, config, a1CornerCoords);
    
    // CORRECTION 4: Appel de la nouvelle fonction pour dessiner la croix
    drawReferenceCross(ctx, latLonToPixels, config);
}

/**
 * Dessine le cartouche d'information.
 */
function drawCartouche(ctx, latLonToPixels, config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    
    const geo_tl = calculateAndRotatePoint(1.1, 18.9, config, a1Lat, a1Lon);
    const geo_br = calculateAndRotatePoint(4.5, 17.5, config, a1Lat, a1Lon);
    
    const topLeft = latLonToPixels(geo_tl[1], geo_tl[0]);
    const bottomRight = latLonToPixels(geo_br[1], geo_br[0]);
    const width = bottomRight.x - topLeft.x;
    const height = bottomRight.y - topLeft.y;

    ctx.fillStyle = 'white';
    ctx.fillRect(topLeft.x, topLeft.y, width, height);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.strokeRect(topLeft.x, topLeft.y, width, height);

    ctx.fillStyle = 'black';
    ctx.font = '22px Arial';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    
    let textY = topLeft.y + 8;
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
    const radius = arrowLengthInPixels * 0.9;

    // CORRECTION 3: Dessiner le fond gris semi-transparent
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = 'rgba(200, 200, 200, 0.7)';
    ctx.fill();
    
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
// CORRECTION 2: Fonction réécrite pour dessiner 4 carrés avec transparence.
function drawSubdivisionKey(ctx, latLonToPixels, config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;

    // Définir les 5 points géographiques clés de la cellule A1 (les 4 coins et le centre)
    const geo_bl = calculateAndRotatePoint(1, 1, config, a1Lat, a1Lon);
    const geo_br = calculateAndRotatePoint(2, 1, config, a1Lat, a1Lon);
    const geo_tl = calculateAndRotatePoint(1, 2, config, a1Lat, a1Lon);
    const geo_tr = calculateAndRotatePoint(2, 2, config, a1Lat, a1Lon);
    const geo_center = calculateAndRotatePoint(1.5, 1.5, config, a1Lat, a1Lon);

    // Convertir les points en pixels
    const px_tl = latLonToPixels(geo_tl[1], geo_tl[0]);
    const px_tr = latLonToPixels(geo_tr[1], geo_tr[0]);
    const px_bl = latLonToPixels(geo_bl[1], geo_bl[0]);
    const px_br = latLonToPixels(geo_br[1], geo_br[0]);
    const px_center = latLonToPixels(geo_center[1], geo_center[0]);
    
    // Appliquer la transparence globale pour cette partie du dessin
    ctx.save(); // Sauvegarde l'état actuel du contexte
    ctx.globalAlpha = 0.7;

    // Calculer les largeurs et hauteurs pour dessiner les rectangles
    const width_tl = px_center.x - px_tl.x;
    const height_tl = px_center.y - px_tl.y;
    const width_tr = px_tr.x - px_center.x;
    const height_tr = px_center.y - px_tr.y;
    const width_bl = px_center.x - px_bl.x;
    const height_bl = px_bl.y - px_center.y;
    const width_br = px_br.x - px_center.x;
    const height_br = px_br.y - px_center.y;
    
    // Dessiner les 4 petits carrés (rectangles)
    ctx.fillStyle = '#FFFF00'; // Jaune
    ctx.fillRect(px_tl.x, px_tl.y, width_tl, height_tl);
    
    ctx.fillStyle = '#0000FF'; // Bleu
    ctx.fillRect(px_center.x, px_tr.y, width_tr, height_tr);

    ctx.fillStyle = '#008000'; // Vert
    ctx.fillRect(px_bl.x, px_center.y, width_bl, height_bl);
    
    ctx.fillStyle = '#FF0000'; // Rouge
    ctx.fillRect(px_center.x, px_center.y, width_br, height_br);
    
    ctx.restore(); // Restaure l'état du contexte (enlève la transparence globale)

    // Redessiner le contour complet de la cellule A1 en noir
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px_tl.x, px_tl.y);
    ctx.lineTo(px_tr.x, px_tr.y);
    ctx.lineTo(px_br.x, px_br.y);
    ctx.lineTo(px_bl.x, px_bl.y);
    ctx.closePath();
    ctx.stroke();
}

// CORRECTION 4: Nouvelle fonction pour dessiner la croix du point de référence.
function drawReferenceCross(ctx, latLonToPixels, config) {
    // Récupérer les coordonnées du point de référence depuis la configuration
    const refPointCoords = { lat: config.latitude, lon: config.longitude };
    
    // Convertir en pixels sur le canevas
    const center = latLonToPixels(refPointCoords.lat, refPointCoords.lon);
    
    const crossSize = 15; // Taille de la croix (15 pixels du centre à chaque extrémité)
    
    ctx.strokeStyle = '#FF0000'; // Couleur rouge
    ctx.lineWidth = 3;
    
    // Dessiner la ligne verticale de la croix
    ctx.beginPath();
    ctx.moveTo(center.x, center.y - crossSize);
    ctx.lineTo(center.x, center.y + crossSize);
    ctx.stroke();
    
    // Dessiner la ligne horizontale de la croix
    ctx.beginPath();
    ctx.moveTo(center.x - crossSize, center.y);
    ctx.lineTo(center.x + crossSize, center.y);
    ctx.stroke();
}
