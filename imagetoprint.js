// imagetoprint.js

const TILE_SIZE = 256;
const MAX_ZOOM = 19;

/**
 * Fonction de conversion des coordonnées de tuile (x, y, z) en QuadKey pour Bing Maps.
 */
function coordsToQuadKey(x, y, zoom) {
    let quadKey = '';
    for (let i = zoom; i > 0; i--) {
        let digit = 0;
        const mask = 1 << (i - 1);
        if ((y & mask) !== 0) {
            digit += 2;
        }
        if ((x & mask) !== 0) {
            digit += 1;
        }
        quadKey += digit.toString();
    }
    return quadKey;
}


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

        // On récupère le nom de base avant qu'il ne soit modifié pour l'export KMZ.
        const config = getGridConfiguration(
            parseFloat(coordsStr.split(',')[0]),
            parseFloat(coordsStr.split(',')[1])
        );
        const gridNameBase = document.getElementById('grid-name-base').value || 'CADO Grid';
        const selectedMapId = document.getElementById('map-tile-provider').value;
        const mapConfig = MAP_LAYERS.find(m => m.id === selectedMapId);
        if (!mapConfig) {
            throw new Error("Configuration de la carte non trouvée !");
        }
        config.gridNameBase = gridNameBase; // Ajout du nom de base à la config pour le cartouche.
        config.includeGrid = true;
        config.includePoints = false;
        // Ajout de la nouvelle option d'épaisseur de trait
        config.lineWidth = parseInt(document.getElementById('line-thickness').value, 10) || 1;


        const a1CornerCoords = getA1CornerCoordsForPrint(config);
        const boundingBox = getBoundingBoxForPrint(config, a1CornerCoords);
        const zoomLevel = calculateOptimalZoom(boundingBox);

        console.log(`Zoom optimal calculé pour grille ${config.endCol}${config.endRow}: ${zoomLevel}`);

        loadingMessage.textContent = "Téléchargement des fonds de carte (0%)...";
        const { finalCanvas, canvasInfo } = await createFinalCanvasWithLayers(boundingBox, zoomLevel, mapConfig, (progress) => {
            loadingMessage.textContent = `Téléchargement des fonds de carte (${progress.toFixed(0)}%)...`;
        });

        loadingMessage.textContent = "Dessin du carroyage...";
        const finalCtx = finalCanvas.getContext('2d');
        drawGridAndElements(finalCtx, canvasInfo, zoomLevel, config, a1CornerCoords);

        const originString = `_origine=${a1CornerCoords[1].toFixed(6)},${a1CornerCoords[0].toFixed(6)}`;
        const finalGridName = config.gridName + originString;
        const fileName = `${finalGridName}.png`;

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

    const startColNum = letterToNumber(config.startCol);
    const endColNum = letterToNumber(config.endCol);
    const startRowNum = config.startRow;
    const endRowNum = config.endRow;

    const contentBounds = {
        minCol: startColNum - 0.5,
        maxCol: endColNum + 1,
        minRow: startRowNum - 0.5,
        maxRow: endRowNum + 1
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
async function createFinalCanvasWithLayers(boundingBox, zoom, mapConfig, onProgress) {
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

    let totalTilesToDownload = 0;
    let downloadedCount = 0;
    const allTilePromises = [];

    // Boucle sur chaque couche définie dans la configuration (ex: satellite, puis routes)
    for (const layer of mapConfig.layers) {
        const tileProviderUrl = layer.url;

        for (let x = nwTile.x; x <= seTile.x; x++) {
            for (let y = nwTile.y; y <= seTile.y; y++) {
                totalTilesToDownload++;
                let tileUrl;

                // Gérer les différents types de format d'URL
                if (layer.type === 'quadkey') {
                    const quadKey = coordsToQuadKey(x, y, zoom);
                    const subdomain = (x + y) % 4;
                    tileUrl = tileProviderUrl.replace('{q}', quadKey).replace('{s}', subdomain);
                } else if (layer.type === 'xyz_y_inverted') { // Pour Esri
                     tileUrl = tileProviderUrl.replace('{z}', zoom).replace('{y}', y).replace('{x}', x);
                } else { // 'xyz' standard
                    tileUrl = tileProviderUrl.replace('{z}', zoom).replace('{x}', x).replace('{y}', y);
                }

                const promise = new Promise((resolve) => {
                    const img = new Image();
                    img.crossOrigin = "Anonymous";
                    img.onload = () => {
                        resolve({ img, x, y, success: true });
                    };
                    img.onerror = () => {
                        console.warn(`Impossible de charger la tuile: ${tileUrl}`);
                        resolve({ success: false }); // Résoudre même en cas d'erreur pour ne pas bloquer
                    };
                    img.src = tileUrl;
                });
                allTilePromises.push(promise);
            }
        }
    }

    // Surveiller la progression de toutes les tuiles
    allTilePromises.forEach(p => {
        p.then(() => {
            downloadedCount++;
            onProgress((downloadedCount / totalTilesToDownload) * 100);
        });
    });

    // Attendre que toutes les tuiles de toutes les couches soient téléchargées
    const resolvedTiles = await Promise.all(allTilePromises);

    // Dessiner les tuiles sur le canevas
    resolvedTiles.forEach(tileResult => {
        if (tileResult.success) {
            const tileX = (tileResult.x * TILE_SIZE) - nwPixel.x;
            const tileY = (tileResult.y * TILE_SIZE) - nwPixel.y;
            ctx.drawImage(tileResult.img, tileX, tileY);
        }
    });

    const canvasInfo = { north: boundingBox.north, west: boundingBox.west };
    return { finalCanvas, canvasInfo };
}


/**
 * Fonction d'assistance pour dessiner du texte avec un contour.
 */
function drawLabelWithOutline(ctx, text, x, y, config) {
    const darkColorsForWhiteOutline = ['black', 'red', 'blue', 'green', 'violet', 'brown'];
    const outlineColor = darkColorsForWhiteOutline.includes(config.colorName) ? 'white' : 'black';

    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = 3;
    ctx.strokeText(text, x, y);

    ctx.fillStyle = config.gridColor;
    ctx.fillText(text, x, y);
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
    ctx.lineWidth = config.lineWidth || 1; // Utilisation de la nouvelle épaisseur de trait

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
    
    // Calcul de la taille d'une cellule pour la proportionnalité des polices
    const geo_A1_center = calculateAndRotatePoint(startColNum + 0.5, startRowNum + 0.5, config, a1Lat, a1Lon);
    const geo_B1_center = calculateAndRotatePoint(startColNum + 1.5, startRowNum + 0.5, config, a1Lat, a1Lon);
    const px_A1_center = latLonToPixels(geo_A1_center[1], geo_A1_center[0]);
    const px_B1_center = latLonToPixels(geo_B1_center[1], geo_B1_center[0]);
    const cellWidthInPixels = Math.hypot(px_B1_center.x - px_A1_center.x, px_B1_center.y - px_A1_center.y);

    // Définition de la police pour les étiquettes de la grille
    const labelFontSize = cellWidthInPixels * 0.75;
    ctx.font = `bold ${labelFontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Étiquettes Lettres
    for (let i = startColNum; i <= endColNum; i++) {
        const labelPoint = calculateAndRotatePoint(i + 0.5, startRowNum - 0.5, config, a1Lat, a1Lon);
        const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
        drawLabelWithOutline(ctx, numberToLetter(i), labelPixels.x, labelPixels.y, config);
    }

    // Étiquettes Chiffres
    for (let i = startRowNum; i <= endRowNum; i++) {
        const labelPoint = calculateAndRotatePoint(startColNum - 0.5, i + 0.5, config, a1Lat, a1Lon);
        const labelPixels = latLonToPixels(labelPoint[1], labelPoint[0]);
        drawLabelWithOutline(ctx, i.toString(), labelPixels.x, labelPixels.y, config);
    }

    drawCartouche(ctx, latLonToPixels, config, a1CornerCoords, cellWidthInPixels);
    drawCompass(ctx, latLonToPixels, config, a1CornerCoords, cellWidthInPixels);
    drawSubdivisionKey(ctx, latLonToPixels, config, a1CornerCoords);
    drawReferenceCross(ctx, latLonToPixels, config);
}

/**
 * Dessine le cartouche d'information avec une taille et une police robustes.
 */
function drawCartouche(ctx, latLonToPixels, config, a1CornerCoords, cellWidthInPixels) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    const startColNum = letterToNumber(config.startCol);

    // 1. Déterminer la rangée la plus "haute" visuellement sur la carte.
    const topRowNum = (config.letteringDirection === 'ascending') 
        ? Math.max(config.startRow, config.endRow)+1 
        : Math.min(config.startRow, config.endRow);
        
    // 2. Le point d'ancrage est le coin HAUT-GAUCHE de la cellule la plus en haut à gauche.
    // La ligne "haute" de cette cellule est `topRowNum + 1`.
    const anchorGeoPoint = calculateAndRotatePoint(startColNum, topRowNum, config, a1Lat, a1Lon);
    const anchorPixels = latLonToPixels(anchorGeoPoint[1], anchorGeoPoint[0]);

    const FONT_SIZE_RATIO = 0.15;
    const FONT_SIZE_PX = Math.max(12, cellWidthInPixels * FONT_SIZE_RATIO);
    const PADDING_RATIO = 0.5;
    const padding = FONT_SIZE_PX * PADDING_RATIO;
    const lineSpacing = FONT_SIZE_PX * 1.3;
    
    const gridNameText = config.gridNameBase;
    const refText = (config.referencePointChoice === 'center') ? `Pt. Réf: ${config.latitude.toFixed(5)}, ${config.longitude.toFixed(5)}` : '';
    const originText = `Origine A1: ${a1Lat.toFixed(5)}, ${a1Lon.toFixed(5)}`;
    const scaleText = `Échelle: 1 case = ${config.scale}m`;
    const texts = [gridNameText, originText, scaleText];
    if (refText) texts.splice(1, 0, refText);

    ctx.font = `${FONT_SIZE_PX}px Arial`;
    const maxTextWidth = Math.max(...texts.map(text => ctx.measureText(text).width));
    const cartoucheWidth = maxTextWidth + (padding * 2) + (refText ? (FONT_SIZE_PX * 0.8 + padding / 2) : 0);
    const cartoucheHeight = (lineSpacing * texts.length) + (padding * 2);

    // 3. On positionne le coin HAUT-GAUCHE du cartouche (cartoucheX, cartoucheY)
    // juste à l'intérieur du coin de la cellule d'ancrage.
    const cartoucheX = anchorPixels.x + padding;
    const cartoucheY = anchorPixels.y + padding;

    // Le reste de la fonction dessine le cartouche à cette position calculée.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.fillRect(cartoucheX, cartoucheY, cartoucheWidth, cartoucheHeight);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.strokeRect(cartoucheX, cartoucheY, cartoucheWidth, cartoucheHeight);
    
    ctx.fillStyle = 'black';
    ctx.font = `${FONT_SIZE_PX}px Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    let textY = cartoucheY + padding + (lineSpacing / 2);
    ctx.fillText(gridNameText, cartoucheX + padding, textY);
    textY += lineSpacing;

    if (refText) {
        const crossSize = FONT_SIZE_PX * 0.4;
        const crossX = cartoucheX + padding + crossSize;
        ctx.strokeStyle = '#FF0000'; ctx.lineWidth = 2; ctx.beginPath();
        ctx.moveTo(crossX - crossSize, textY); ctx.lineTo(crossX + crossSize, textY);
        ctx.moveTo(crossX, textY - crossSize); ctx.lineTo(crossX, textY + crossSize);
        ctx.stroke();
        ctx.fillStyle = 'black';
        ctx.fillText(refText, crossX + crossSize + (padding / 2), textY);
        textY += lineSpacing;
    }

    ctx.fillText(originText, cartoucheX + padding, textY);
    textY += lineSpacing;
    ctx.fillText(scaleText, cartoucheX + padding, textY);
}


/**
 * Dessine la boussole de manière dynamique.
 */
function drawCompass(ctx, latLonToPixels, config, a1CornerCoords, cellWidthInPixels) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    
    const endColNum = letterToNumber(config.endCol);
    const topRowNum = (config.letteringDirection === 'ascending') 
        ? Math.max(config.startRow, config.endRow) 
        : Math.min(config.startRow, config.endRow);
    
    // Le point central est le centre de la case en haut à droite
    const centerPoint = calculateAndRotatePoint(endColNum + 0.5, topRowNum + 0.5, config, a1Lat, a1Lon);
    const center = latLonToPixels(centerPoint[1], centerPoint[0]);
    
    const arrowLengthInMeters = config.scale * 0.35; 
    const northGeoPoint = { lat: centerPoint[1] + (arrowLengthInMeters / 111320), lon: centerPoint[0] };
    const northPixel = latLonToPixels(northGeoPoint.lat, northGeoPoint.lon);

    const arrowLengthInPixels = Math.hypot(northPixel.x - center.x, northPixel.y - center.y);
    const radius = arrowLengthInPixels * 1.2;

    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = 'rgba(200, 200, 200, 0.7)';
    ctx.fill();
    
    // Calcul de la rotation de la flèche Nord
    const angle = Math.atan2(northPixel.y - center.y, northPixel.x - center.x);
    const N_point = { x: center.x + arrowLengthInPixels * Math.cos(angle), y: center.y + arrowLengthInPixels * Math.sin(angle) };
    const base_point = { x: center.x - (arrowLengthInPixels * 0.3) * Math.cos(angle), y: center.y - (arrowLengthInPixels * 0.3) * Math.sin(angle) };
    
    ctx.beginPath();
    ctx.moveTo(base_point.x, base_point.y);
    ctx.lineTo(N_point.x, N_point.y);
    ctx.strokeStyle = 'red'; ctx.lineWidth = 3; ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(N_point.x, N_point.y);
    ctx.lineTo(N_point.x - 10 * Math.cos(angle + 0.3), N_point.y - 10 * Math.sin(angle + 0.3));
    ctx.lineTo(N_point.x - 10 * Math.cos(angle - 0.3), N_point.y - 10 * Math.sin(angle - 0.3));
    ctx.closePath();
    ctx.fillStyle = 'red'; ctx.fill();

    const compassNFontSize = cellWidthInPixels * 0.25;
    ctx.font = `bold ${compassNFontSize}px Arial`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.strokeStyle = 'white'; ctx.lineWidth = 3;
    ctx.strokeText('N', N_point.x, N_point.y + 2);
    ctx.fillStyle = 'black';
    ctx.fillText('N', N_point.x, N_point.y + 2);
}

/**
 * Dessine la clé de subdivision en 4 couleurs.
 */
function drawSubdivisionKey(ctx, latLonToPixels, config, a1CornerCoords) {
    const [a1Lon, a1Lat] = a1CornerCoords;

    const startColNum = letterToNumber(config.startCol);
    // Détermine la rangée la plus "basse" visuellement
    const bottomRowNum = (config.letteringDirection === 'ascending') 
        ? Math.min(config.startRow, config.endRow) 
        : Math.max(config.startRow, config.endRow);

    // Points de la cellule en bas à gauche
    const geo_bl = calculateAndRotatePoint(startColNum, bottomRowNum, config, a1Lat, a1Lon);
    const geo_br = calculateAndRotatePoint(startColNum + 1, bottomRowNum, config, a1Lat, a1Lon);
    const geo_tl = calculateAndRotatePoint(startColNum, bottomRowNum + 1, config, a1Lat, a1Lon);
    const geo_tr = calculateAndRotatePoint(startColNum + 1, bottomRowNum + 1, config, a1Lat, a1Lon);
    const geo_center = calculateAndRotatePoint(startColNum + 0.5, bottomRowNum + 0.5, config, a1Lat, a1Lon);

    const px_tl = latLonToPixels(geo_tl[1], geo_tl[0]);
    const px_tr = latLonToPixels(geo_tr[1], geo_tr[0]);
    const px_bl = latLonToPixels(geo_bl[1], geo_bl[0]);
    const px_br = latLonToPixels(geo_br[1], geo_br[0]);
    const px_center = latLonToPixels(geo_center[1], geo_center[0]);
    
    const opacity = '0.7';
    
    // La subdivision est dessinée dans un repère local non-rotaté puis appliquée
    const drawSubdivision = (color, p1, p2, p3, p4) => {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.closePath(); ctx.fill();
    };

    drawSubdivision(`rgba(255, 255, 0, ${opacity})`, px_tl, {x: (px_tl.x + px_tr.x)/2, y: (px_tl.y + px_tr.y)/2}, px_center, {x: (px_tl.x + px_bl.x)/2, y: (px_tl.y + px_bl.y)/2});
    drawSubdivision(`rgba(0, 0, 255, ${opacity})`, {x: (px_tl.x + px_tr.x)/2, y: (px_tl.y + px_tr.y)/2}, px_tr, {x: (px_tr.x + px_br.x)/2, y: (px_tr.y + px_br.y)/2}, px_center);
    drawSubdivision(`rgba(0, 128, 0, ${opacity})`, {x: (px_tl.x + px_bl.x)/2, y: (px_tl.y + px_bl.y)/2}, px_center, {x: (px_bl.x + px_br.x)/2, y: (px_bl.y + px_br.y)/2}, px_bl);
    drawSubdivision(`rgba(255, 0, 0, ${opacity})`, px_center, {x: (px_tr.x + px_br.x)/2, y: (px_tr.y + px_br.y)/2}, px_br, {x: (px_bl.x + px_br.x)/2, y: (px_bl.y + px_br.y)/2});

    ctx.strokeStyle = 'black'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px_tl.x, px_tl.y); ctx.lineTo(px_tr.x, px_tr.y); ctx.lineTo(px_br.x, px_br.y); ctx.lineTo(px_bl.x, px_bl.y); ctx.closePath();
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
