// imagetoprint.js

const TILE_SIZE = 256;
const MAX_ZOOM = 19;

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


async function generateImageToPrint() {
    const loadingIndicator = document.getElementById("loading-indicator");
    const loadingMessage = document.getElementById("loading-message");
    
    loadingMessage.textContent = "Préparation de l'image pour impression...";
    loadingIndicator.classList.remove("hidden");
    hideError();

    try {
        const coordsStr = document.getElementById("decimal-coords").value;
        if (!coordsStr) throw new Error("Veuillez d'abord définir des coordonnées de référence.");
        
        const gridNameBase = document.getElementById('grid-name-base').value || 'CADO Grid';
        const config = getGridConfiguration(
            parseFloat(coordsStr.split(',')[0]),
            parseFloat(coordsStr.split(',')[1])
        );
        config.gridNameBase = gridNameBase;
        config.includeGrid = true;
        config.includePoints = false;

        const selectedMapId = document.getElementById('map-tile-provider').value;
        const mapConfig = MAP_LAYERS.find(m => m.id === selectedMapId);
        if (!mapConfig) {
            throw new Error("Configuration de la carte non trouvée !");
        }
        
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

function calculateOptimalZoom(boundingBox) {
    const lonDiff = Math.abs(boundingBox.east - boundingBox.west);
    if (lonDiff === 0) return MAX_ZOOM;
    const targetWidthInPixels = 3500;
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
    const allLayerPromises = [];

    for (const layer of mapConfig.layers) {
        const layerPromises = [];
        for (let x = nwTile.x; x <= seTile.x; x++) {
            for (let y = nwTile.y; y <= seTile.y; y++) {
                totalTilesToDownload++;
                let tileUrl;
                
                if (layer.type === 'quadkey') {
                    const quadKey = coordsToQuadKey(x, y, zoom);
                    const subdomain = (x + y) % 4;
                    tileUrl = layer.url.replace('{q}', quadKey).replace('{s}', subdomain);
                } else if (layer.type === 'xyz_y_inverted') {
                     tileUrl = layer.url.replace('{z}', zoom).replace('{y}', y).replace('{x}', x);
                } else {
                    tileUrl = layer.url.replace('{z}', zoom).replace('{x}', x).replace('{y}', y);
                }

                const promise = new Promise((resolve) => {
                    const img = new Image();
                    img.crossOrigin = "Anonymous";
                    img.onload = () => resolve({ img, x, y, success: true });
                    img.onerror = () => {
                        console.warn(`Impossible de charger la tuile: ${tileUrl}`);
                        resolve({ success: false });
                    };
                    img.src = tileUrl;
                });
                layerPromises.push(promise);
            }
        }
        allLayerPromises.push(Promise.all(layerPromises));
    }

    let downloadedCount = 0;
    const updateProgress = () => {
        downloadedCount++;
        onProgress((downloadedCount / totalTilesToDownload) * 100);
    };

    const resolvedLayers = await Promise.all(allLayerPromises.map(async (layerPromise) => {
        const tiles = await layerPromise;
        tiles.forEach(updateProgress);
        return tiles;
    }));

    resolvedLayers.forEach(layerTiles => {
        layerTiles.forEach(tileResult => {
            if (tileResult.success) {
                const tileX = (tileResult.x * TILE_SIZE) - nwPixel.x;
                const tileY = (tileResult.y * TILE_SIZE) - nwPixel.y;
                ctx.drawImage(tileResult.img, tileX, tileY);
            }
        });
    });
    
    const canvasInfo = { north: boundingBox.north, west: boundingBox.west };
    return { finalCanvas, canvasInfo };
}

function getPixelsForGridPoint(col, row, config, a1CornerCoords, latLonToPixels) {
    const [a1Lon, a1Lat] = a1CornerCoords;
    const geoPoint = calculateAndRotatePoint(col, row, config, a1Lat, a1Lon);
    return latLonToPixels(geoPoint[1], geoPoint[0]);
}

function drawLabelWithOutline(ctx, text, x, y, config, outlineWidth) {
    const darkColorsForWhiteOutline = ['black', 'red', 'blue', 'green', 'violet', 'brown'];
    const outlineColor = darkColorsForWhiteOutline.includes(config.colorName) ? 'white' : 'black';

    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = outlineWidth;
    ctx.strokeText(text, x, y);

    ctx.fillStyle = config.gridColor;
    ctx.fillText(text, x, y);
}

function drawGridAndElements(ctx, canvasInfo, zoom, config, a1CornerCoords) {
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

    const startColNum = letterToNumber(config.startCol);
    const endColNum = letterToNumber(config.endCol);
    const startRowNum = config.startRow;
    const endRowNum = config.endRow;

    for (let i = startColNum; i <= endColNum + 1; i++) {
        const startPixels = getPixelsForGridPoint(i, startRowNum, config, a1CornerCoords, latLonToPixels);
        const endPixels = getPixelsForGridPoint(i, endRowNum + 1, config, a1CornerCoords, latLonToPixels);
        ctx.beginPath(); ctx.moveTo(startPixels.x, startPixels.y); ctx.lineTo(endPixels.x, endPixels.y); ctx.stroke();
    }
    
    for (let i = startRowNum; i <= endRowNum + 1; i++) {
        const startPixels = getPixelsForGridPoint(startColNum, i, config, a1CornerCoords, latLonToPixels);
        const endPixels = getPixelsForGridPoint(endColNum + 1, i, config, a1CornerCoords, latLonToPixels);
        ctx.beginPath(); ctx.moveTo(startPixels.x, startPixels.y); ctx.lineTo(endPixels.x, endPixels.y); ctx.stroke();
    }
    
    // CORRECTION: La taille de police est maintenant proportionnelle à la taille du canevas
    const baseFontSize = ctx.canvas.width / 150; // Ratio basé sur la largeur totale de l'image
    const outlineWidth = baseFontSize * 0.1;

    ctx.font = `bold ${baseFontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = startColNum; i <= endColNum; i++) {
        const labelPixels = getPixelsForGridPoint(i + 0.5, startRowNum - 0.5, config, a1CornerCoords, latLonToPixels);
        drawLabelWithOutline(ctx, numberToLetter(i), labelPixels.x, labelPixels.y, config, outlineWidth);
    }
    
    for (let i = startRowNum; i <= endRowNum; i++) {
        const labelPixels = getPixelsForGridPoint(startColNum - 0.5, i + 0.5, config, a1CornerCoords, latLonToPixels);
        drawLabelWithOutline(ctx, i.toString(), labelPixels.x, labelPixels.y, config, outlineWidth);
    }
    
    drawCartouche(ctx, latLonToPixels, config, a1CornerCoords, baseFontSize);
    drawCompass(ctx, latLonToPixels, config, a1CornerCoords, baseFontSize);
    drawSubdivisionKey(ctx, latLonToPixels, config, a1CornerCoords);
    drawReferenceCross(ctx, latLonToPixels, config);
}

function drawCartouche(ctx, latLonToPixels, config, a1CornerCoords, baseFontSize) {
    const startColNum = letterToNumber(config.startCol);
    const topRow = config.letteringDirection === 'ascending' ? config.endRow : config.startRow;

    // --- Définir la police et les espacements ---
    const fontSize = baseFontSize * 0.8; // Le texte du cartouche est un peu plus petit que les étiquettes
    ctx.font = `${fontSize}px Arial`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    const padding = fontSize * 0.5;
    const lineSpacing = fontSize * 1.3;
    const cartoucheHeight = (lineSpacing * 4) + (padding * 2);

    // --- Calculer la largeur nécessaire ---
    const [a1Lon, a1Lat] = a1CornerCoords;
    const line1 = config.gridNameBase;
    const line2 = `Pt. Réf: ${config.latitude.toFixed(5)}, ${config.longitude.toFixed(5)}`;
    const line3 = `Origine A1: ${a1Lat.toFixed(5)}, ${a1Lon.toFixed(5)}`;
    const line4 = `Échelle: 1 case = ${config.scale}m`;
    
    const metrics1 = ctx.measureText(line1);
    const metrics2 = ctx.measureText(line2);
    const metrics3 = ctx.measureText(line3);
    const metrics4 = ctx.measureText(line4);

    const maxWidth = Math.max(metrics1.width, metrics2.width, metrics3.width, metrics4.width);
    const cartoucheWidth = maxWidth + (padding * 3); // Ajouter du padding et de l'espace pour la croix

    // --- Positionner le cartouche ---
    const topLeft = getPixelsForGridPoint(startColNum + 0.1, topRow + 0.9, config, a1CornerCoords, latLonToPixels);
    
    // --- Dessiner le cartouche ---
    ctx.fillStyle = 'white';
    ctx.fillRect(topLeft.x, topLeft.y, cartoucheWidth, cartoucheHeight);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.strokeRect(topLeft.x, topLeft.y, cartoucheWidth, cartoucheHeight);
    
    ctx.fillStyle = 'black';
    let textY = topLeft.y + padding + (lineSpacing / 2);

    ctx.fillText(line1, topLeft.x + padding, textY);
    textY += lineSpacing;

    if (config.referencePointChoice === 'center') {
        const crossSize = fontSize * 0.4;
        const crossX = topLeft.x + padding + crossSize;
        const crossY = textY;

        ctx.strokeStyle = '#FF0000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(crossX - crossSize, crossY);
        ctx.lineTo(crossX + crossSize, crossY);
        ctx.moveTo(crossX, crossY - crossSize);
        ctx.lineTo(crossX, crossY + crossSize);
        ctx.stroke();

        ctx.fillStyle = 'black';
        ctx.fillText(line2, crossX + crossSize + (padding / 2), textY);
        textY += lineSpacing;
    }

    ctx.fillText(line3, topLeft.x + padding, textY);
    textY += lineSpacing;
    
    ctx.fillText(line4, topLeft.x + padding, textY);
}


function drawCompass(ctx, latLonToPixels, config, a1CornerCoords, baseFontSize) {
    const endColNum = letterToNumber(config.endCol);
    const topRow = config.letteringDirection === 'ascending' ? config.endRow : config.startRow;

    const center = getPixelsForGridPoint(endColNum + 0.5, topRow + 0.5, config, a1CornerCoords, latLonToPixels);
    
    const arrowLengthInMeters = config.scale * 0.35; 
    const centerGeo = calculateAndRotatePoint(endColNum + 0.5, topRow + 0.5, config, a1CornerCoords.reverse()[0], a1CornerCoords.reverse()[1]);
    const northGeoPoint = { 
        lat: centerGeo[1] + (arrowLengthInMeters / 111320), 
        lon: centerGeo[0] 
    };
    const northPixel = latLonToPixels(northGeoPoint.lat, northGeoPoint.lon);

    const arrowLengthInPixels = Math.hypot(northPixel.x - center.x, northPixel.y - center.y);
    const radius = arrowLengthInPixels * 1.2;

    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI, false);
    ctx.fillStyle = 'rgba(200, 200, 200, 0.7)';
    ctx.fill();
    
    const N_point = { x: center.x, y: center.y - arrowLengthInPixels };

    ctx.beginPath();
    ctx.moveTo(center.x, center.y + (arrowLengthInPixels * 0.3));
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

    const fontSize = baseFontSize * 0.75;
    
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.strokeStyle = 'white';
    ctx.lineWidth = fontSize * 0.15;
    ctx.strokeText('N', N_point.x, N_point.y + 2);
    ctx.fillStyle = 'black';
    ctx.fillText('N', N_point.x, N_point.y + 2);
}

function drawSubdivisionKey(ctx, latLonToPixels, config, a1CornerCoords) {
    const startColNum = letterToNumber(config.startCol);
    const bottomRow = config.letteringDirection === 'ascending' ? config.startRow : config.endRow;

    const px_tl = getPixelsForGridPoint(startColNum, bottomRow + 1, config, a1CornerCoords, latLonToPixels);
    const px_tr = getPixelsForGridPoint(startColNum + 1, bottomRow + 1, config, a1CornerCoords, latLonToPixels);
    const px_bl = getPixelsForGridPoint(startColNum, bottomRow, config, a1CornerCoords, latLonToPixels);
    const px_br = getPixelsForGridPoint(startColNum + 1, bottomRow, config, a1CornerCoords, latLonToPixels);
    const px_center = getPixelsForGridPoint(startColNum + 0.5, bottomRow + 0.5, config, a1CornerCoords, latLonToPixels);
    
    const opacity = '0.7';
    
    ctx.fillStyle = `rgba(255, 255, 0, ${opacity})`;
    ctx.beginPath(); ctx.moveTo(px_tl.x, px_tl.y); ctx.lineTo(px_center.x, px_tl.y); ctx.lineTo(px_center.x, px_center.y); ctx.lineTo(px_tl.x, px_center.y); ctx.closePath(); ctx.fill();
    
    ctx.fillStyle = `rgba(0, 0, 255, ${opacity})`;
    ctx.beginPath(); ctx.moveTo(px_center.x, px_tr.y); ctx.lineTo(px_tr.x, px_tr.y); ctx.lineTo(px_tr.x, px_center.y); ctx.lineTo(px_center.x, px_center.y); ctx.closePath(); ctx.fill();
    
    ctx.fillStyle = `rgba(0, 128, 0, ${opacity})`;
    ctx.beginPath(); ctx.moveTo(px_bl.x, px_center.y); ctx.lineTo(px_center.x, px_center.y); ctx.lineTo(px_center.x, px_bl.y); ctx.lineTo(px_bl.x, px_bl.y); ctx.closePath(); ctx.fill();
    
    ctx.fillStyle = `rgba(255, 0, 0, ${opacity})`;
    ctx.beginPath(); ctx.moveTo(px_center.x, px_center.y); ctx.lineTo(px_br.x, px_center.y); ctx.lineTo(px_br.x, px_br.y); ctx.lineTo(px_center.x, px_br.y); ctx.closePath(); ctx.fill();

    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px_tl.x, px_tl.y); ctx.lineTo(px_tr.x, px_tr.y); ctx.lineTo(px_br.x, px_br.y); ctx.lineTo(px_bl.x, px_bl.y); ctx.closePath();
    ctx.stroke();
}

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
