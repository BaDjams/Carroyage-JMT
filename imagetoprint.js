// imagetoprint.js

function coordsToQuadKey(x, y, zoom) {
    const digits = [];
    for (let i = zoom; i > 0; i--) {
        let digit = 0;
        const mask = 1 << (i - 1);
        if ((y & mask) !== 0) { digit += 2; }
        if ((x & mask) !== 0) { digit += 1; }
        digits.push(digit);
    }
    return digits.join('');
}

function itpLatLonToWorldPixels(lat, lon, zoom) {
    const siny = Math.sin(lat * Math.PI / 180);
    const yClamped = Math.max(Math.min(siny, 0.9999), -0.9999);
    const y = 0.5 - Math.log((1 + yClamped) / (1 - yClamped)) / (4 * Math.PI);
    const x = (lon + 180) / 360;
    const mapSize = 256 * Math.pow(2, zoom);
    return { x: x * mapSize, y: y * mapSize };
}

// Counts total cells in a range, skipping 0
function getCadoCount(start, end) {
    const min = Math.min(start, end);
    const max = Math.max(start, end);
    let count = max - min + 1;
    if (min < 0 && max > 0) {
        count--; // Skip 0
    }
    return count;
}

// Calculates distance in cells from origin (0)
// Ex: A(1) -> 0 offset from origin line. -A(-1) -> -1 offset.
function getCellOffsetFromOrigin(n) {
    if (n > 0) return n - 1;
    return n; 
}

// Shared unit-conversion helpers (module-level, not re-created on each call)
const metersToLatDegrees = (meters) => meters / 111320;
const metersToLonDegrees = (meters, lat) => meters / (111320 * Math.cos(lat * Math.PI / 180));

// --- GEOMETRIC CALCULATION ---
// Calculates a geo point based on cell offsets relative to A1
// colOffset: number of cells right (+)/left (-) of A1
function calculateLocalGeoPoint(colOffset, rowOffset, config, a1Lat, a1Lon) {

    const xOffsetMeters = colOffset * config.scale;
    const yOffsetMeters = rowOffset * config.scale;

    // Y direction adjustment based on Ascending/Descending
    let finalYOffset;
    if (config.letteringDirection === 'ascending') {
        // Ascendant: Lignes augmentent vers le Nord (Haut). 
        // offset positif = vers le Nord = Lat augmente.
        finalYOffset = yOffsetMeters; 
    } else {
        // Descendant: Lignes augmentent vers le Sud (Bas).
        // offset positif = vers le Sud = Lat diminue.
        finalYOffset = -yOffsetMeters;
    }

    const unrotatedLon = a1Lon + metersToLonDegrees(xOffsetMeters, a1Lat);
    const unrotatedLat = a1Lat + metersToLatDegrees(finalYOffset);

    if (!config.deviation) {
        return [unrotatedLon, unrotatedLat];
    }

    const pivotLon = config.longitude;
    const pivotLat = config.latitude;
    const deviationRad = -(config.deviation * Math.PI / 180);

    const cartesianX = (unrotatedLon - pivotLon) * 111320 * Math.cos(pivotLat * Math.PI / 180);
    const cartesianY = (unrotatedLat - pivotLat) * 111320;

    const rotatedX = cartesianX * Math.cos(deviationRad) - cartesianY * Math.sin(deviationRad);
    const rotatedY = cartesianX * Math.sin(deviationRad) + cartesianY * Math.cos(deviationRad);

    const finalLon = pivotLon + metersToLonDegrees(rotatedX, pivotLat);
    const finalLat = pivotLat + metersToLatDegrees(rotatedY);

    return [finalLon, finalLat];
}

async function generateImageToPrint() {
    const loadingIndicator = document.getElementById("loading-indicator");
    const loadingMessage = document.getElementById("loading-message");
    const upscaleEnabled = document.getElementById('cado-enable-upscale').checked;
    loadingMessage.textContent = "Calcul de la géométrie...";
    loadingIndicator.classList.remove("hidden");
    hideError();

    try {
        const coordsStr = document.getElementById("decimal-coords").value;
        if (!coordsStr) throw new Error("Veuillez définir des coordonnées.");

        const [refLat, refLon] = coordsStr.split(',').map(c => parseFloat(c.trim()));
        
        const config = getGridConfiguration(refLat, refLon);
        const usingMbtiles = typeof tileSourceIsActive === 'function' && tileSourceIsActive();
        let mapConfig;
        if (usingMbtiles) {
            mapConfig = { layers: [], maxZoom: Math.max(...tileSourceGetZooms()), name: tileSourceGetName() };
        } else {
            const selectedMapId = document.getElementById('map-tile-provider').value;
            mapConfig = MAP_LAYERS.find(m => m.id === selectedMapId);
            if (!mapConfig) throw new Error("Carte non trouvée !");
        }

        const addressValue = document.getElementById('address-search-input').value.trim();
        config.lineWidth = parseInt(document.getElementById('line-thickness').value, 10) || 1;

        // Format de sortie lu en amont : le géoréférencement GeoTIFF (nord-haut
        // axis-aligned) n'est exact que sans déviation → on bloque avant de
        // télécharger les tuiles si une rotation du carroyage est appliquée.
        const format = document.querySelector('input[name="image-format-cado"]:checked').value;
        if (format === 'geotiff' && Number(config.deviation) !== 0) {
            throw new Error("Export GeoTIFF indisponible avec une déviation du carroyage (≠ 0°). Mettez la déviation à 0° ou exportez en PNG/JPEG.");
        }

        // --- 1. CALCUL CORRECT DE LA ZONE DE TÉLÉCHARGEMENT ---
        const startColNum = letterToNumber(config.startCol);
        const endColNum = letterToNumber(config.endCol);
        const startRowNum = config.startRow;
        const endRowNum = config.endRow;

        // On calcule les offsets réels par rapport à A1 pour le début et la fin
        // Cela gère correctement les nombres négatifs (-Z à Z)
        const colOffsetStart = getCellOffsetFromOrigin(startColNum);
        const colOffsetEnd = getCellOffsetFromOrigin(endColNum);
        const rowOffsetStart = getCellOffsetFromOrigin(startRowNum);
        const rowOffsetEnd = getCellOffsetFromOrigin(endRowNum);

        const realA1Coords = getA1CornerCoordsForPrint(config);

        // Nombre de cases de la grille (nécessaire pour le calcul de la BBox en mode centre)
        const colsCount = getCadoCount(startColNum, endColNum);
        const rowsCount = getCadoCount(startRowNum, endRowNum);

        // Buffer de sécurité en nombre de cases
        const bufferCells = 2;

        const minColOff = Math.min(colOffsetStart, colOffsetEnd);
        const maxColOff = Math.max(colOffsetStart, colOffsetEnd);
        const minRowOff = Math.min(rowOffsetStart, rowOffsetEnd);
        const maxRowOff = Math.max(rowOffsetStart, rowOffsetEnd);

        // BBox de téléchargement.
        // En mode "centre", on calcule la BBox symétriquement autour du pivot géographique (centre de la
        // grille) et non autour de A1. Sans cette correction, pour une grille avec des colonnes négatives
        // (ex : -F à G), A1 n'est pas au centre géographique et la carte téléchargée ne couvre pas la
        // partie positive de la grille (le fond de carte s'arrête à la moitié droite).
        let bboxP1, bboxP2, bboxP3, bboxP4;
        if (config.referencePointChoice === 'center') {
            const halfCols = colsCount / 2 + bufferCells;
            const halfRows = rowsCount / 2 + bufferCells;
            const cLat = config.latitude;
            const cLon = config.longitude;
            bboxP1 = calculateLocalGeoPoint(-halfCols, -halfRows, config, cLat, cLon);
            bboxP2 = calculateLocalGeoPoint( halfCols, -halfRows, config, cLat, cLon);
            bboxP3 = calculateLocalGeoPoint( halfCols,  halfRows, config, cLat, cLon);
            bboxP4 = calculateLocalGeoPoint(-halfCols,  halfRows, config, cLat, cLon);
        } else {
            bboxP1 = calculateLocalGeoPoint(minColOff - bufferCells, minRowOff - bufferCells, config, realA1Coords[1], realA1Coords[0]);
            bboxP2 = calculateLocalGeoPoint(maxColOff + bufferCells, minRowOff - bufferCells, config, realA1Coords[1], realA1Coords[0]);
            bboxP3 = calculateLocalGeoPoint(maxColOff + bufferCells, maxRowOff + bufferCells, config, realA1Coords[1], realA1Coords[0]);
            bboxP4 = calculateLocalGeoPoint(minColOff - bufferCells, maxRowOff + bufferCells, config, realA1Coords[1], realA1Coords[0]);
        }

        const lats = [bboxP1[1], bboxP2[1], bboxP3[1], bboxP4[1]];
        const lons = [bboxP1[0], bboxP2[0], bboxP3[0], bboxP4[0]];
        const downloadBoundingBox = {
            north: Math.max(...lats),
            south: Math.min(...lats),
            east: Math.max(...lons),
            west: Math.min(...lons)
        };
        
        // 2. ZOOM
        const zoomLevel = calculateOptimalZoom(downloadBoundingBox, mapConfig);

        // 3. TÉLÉCHARGEMENT
        loadingMessage.textContent = `Téléchargement de la zone étendue (0%)...`;
        const { finalCanvas: worldCanvas, scaleFactor, actualZoom } = await createFinalCanvasWithLayers(downloadBoundingBox, zoomLevel, mapConfig, (progress) => {
            loadingMessage.textContent = `Téléchargement des tuiles (${progress.toFixed(0)}%)...`;},
            upscaleEnabled
        );

        loadingMessage.textContent = "Assemblage et découpe finale...";

        // 4. DIMENSIONS FINALES & MARGES
        const metersPerPixel = (Math.cos(refLat * Math.PI / 180) * 2 * Math.PI * 6378137) / (256 * Math.pow(2, actualZoom));
        const pixelsPerMeter = (1 / metersPerPixel) * scaleFactor;
        
        const scalePx = config.scale * pixelsPerMeter;
        const marginLarge = scalePx * 1;
        const marginSmall = scalePx * 0.3;

        let marginLeft = marginLarge;
        let marginRight = marginSmall;
        let marginTop, marginBottom;

        if (config.letteringDirection === 'ascending') {
            marginTop = marginSmall;
            marginBottom = marginLarge;
        } else {
            marginTop = marginLarge;
            marginBottom = marginSmall;
        }

        // Double entrée : labels des deux côtés → agrandir aussi marginRight et le côté opposé
        if (config.doubleEntry) {
            marginRight = marginLarge;
            if (config.letteringDirection === 'ascending') marginTop = marginLarge;
            else marginBottom = marginLarge;
        }
        
        // Calcul dimensions grille en pixels
        const gridWidthPx = colsCount * scalePx;
        const gridHeightPx = rowsCount * scalePx;
        
        const finalWidth = Math.ceil(gridWidthPx + marginLeft + marginRight);
        const finalHeight = Math.ceil(gridHeightPx + marginTop + marginBottom);
        
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = finalWidth;
        finalCanvas.height = finalHeight;
        const finalCtx = finalCanvas.getContext('2d');
        
        finalCtx.fillStyle = 'white';
        finalCtx.fillRect(0, 0, finalWidth, finalHeight);

        // 5. PLACEMENT DU PIVOT
        const isCenterMode = config.referencePointChoice === 'center';
        const pivotGeoLat = isCenterMode ? config.latitude : realA1Coords[1];
        const pivotGeoLon = isCenterMode ? config.longitude : realA1Coords[0];
        const cosPivotLat = Math.cos(pivotGeoLat * Math.PI / 180);

        let pivotFinalX, pivotFinalY;

        if (isCenterMode) {
            pivotFinalX = marginLeft + (gridWidthPx / 2);
            pivotFinalY = marginTop + (gridHeightPx / 2);
        } else {
            // Mode Origine : On doit placer A1 correctement sur le papier par rapport aux marges
            // startColOffset est la distance (en nb cases) entre A1 (0) et le début de la grille (ex: -26)
            // pivotFinalX est la position de A1 sur le papier.
            // Le bord gauche du papier (début grille) est à marginLeft.
            // A1 est à droite de marginLeft de 'distance(debut, A1)'.
            // distance(debut, A1) = -startColOffset (si start est négatif).
            // Donc pivotFinalX = marginLeft + (-startColOffset * px). 
            // Soit pivotFinalX = marginLeft - (startColOffset * px).
            
            pivotFinalX = marginLeft - (colOffsetStart * scalePx);

            if (config.letteringDirection === 'ascending') {
                // Ascendant : Bas de page = Ligne Start.
                // A1 est au dessus de StartRow de 'distance(start, A1)'.
                // distance = -rowOffsetStart.
                // Y (canvas) de A1 = Y_BasPage - (distance * px).
                // Y_BasPage = finalHeight - marginBottom.
                // Y_A1 = (finalHeight - marginBottom) - (-rowOffsetStart * px) = ... + (rowOffsetStart * px).
                pivotFinalY = (finalHeight - marginBottom) + (rowOffsetStart * scalePx);
            } else {
                // Descendant : Haut de page = Ligne Start.
                // A1 est en dessous de StartRow.
                // Y_HautPage = marginTop.
                // Y_A1 = marginTop - (rowOffsetStart * scalePx).
                pivotFinalY = marginTop - (rowOffsetStart * scalePx);
            }
        }
        
        const worldOriginPx = itpLatLonToWorldPixels(downloadBoundingBox.north, downloadBoundingBox.west, zoomLevel);
        const pivotWorldGlobalPx = itpLatLonToWorldPixels(pivotGeoLat, pivotGeoLon, zoomLevel);
        const pivotOnWorldCanvasX = (pivotWorldGlobalPx.x - worldOriginPx.x) * scaleFactor;
        const pivotOnWorldCanvasY = (pivotWorldGlobalPx.y - worldOriginPx.y) * scaleFactor;

        // --- PROJECTION CARTE ---
        finalCtx.save();
        finalCtx.translate(pivotFinalX, pivotFinalY);
        finalCtx.rotate(-config.deviation * Math.PI / 180);
        finalCtx.drawImage(worldCanvas, -pivotOnWorldCanvasX, -pivotOnWorldCanvasY);
        finalCtx.restore();

        // 6. DESSIN DE LA GRILLE
        const drawConfig = { ...config, deviation: 0, realDeviation: config.deviation };
        drawConfig.lineWidth = drawConfig.lineWidth * scaleFactor;

        // KML Import
        if (typeof loadedCadoKmlFeatures !== 'undefined' && loadedCadoKmlFeatures.length > 0) {
            const localLatLonToPixelsRotated = (lat, lon) => {
                const dLat = lat - pivotGeoLat;
                const dLon = lon - pivotGeoLon;
                const dY_meters = dLat * 111320;
                const dX_meters = dLon * 111320 * cosPivotLat;
                const angleRad = -config.deviation * Math.PI / 180;
                const rotX_m = dX_meters * Math.cos(angleRad) - dY_meters * Math.sin(angleRad);
                const rotY_m = dX_meters * Math.sin(angleRad) + dY_meters * Math.cos(angleRad);
                return {
                    x: pivotFinalX + (rotX_m * pixelsPerMeter),
                    y: pivotFinalY - (rotY_m * pixelsPerMeter)
                };
            };
            const backupRes = window.kmlResources;
            window.kmlResources = cadoKmlResources;
            if (typeof drawZoneKmlFeatures === 'function') {
                drawZoneKmlFeatures(finalCtx, zoomLevel, loadedCadoKmlFeatures, localLatLonToPixelsRotated);
            }
            window.kmlResources = backupRes;
        }

        // Grille CADO
        const localLatLonToPixels = (lat, lon) => {
            const dLat = lat - pivotGeoLat;
            const dLon = lon - pivotGeoLon;
            const dY_meters = dLat * 111320;
            const dX_meters = dLon * 111320 * cosPivotLat;
            return {
                x: pivotFinalX + (dX_meters * pixelsPerMeter),
                y: pivotFinalY - (dY_meters * pixelsPerMeter)
            };
        };

        let a1GeoForDrawLat, a1GeoForDrawLon;

        if (config.referencePointChoice === 'origin') {
            a1GeoForDrawLat = pivotGeoLat;
            a1GeoForDrawLon = pivotGeoLon;
        } else {
            const mToDegLat = 1 / 111320;
            const mToDegLon = 1 / (111320 * cosPivotLat);
            
            // Pour le dessin des labels, on doit recalculer le A1 virtuel si on est en mode "Center"
            // La logique est : A1 = Centre - (Distance Centre-A1)
            
            // Distance Centre-A1 en X : 
            // CentreX (relatif à A1) = colOffsetStart + (gridWidth/2)
            const gridWidthM = colsCount * config.scale;
            const centerX_M = (colOffsetStart * config.scale) + (gridWidthM / 2);
            a1GeoForDrawLon = pivotGeoLon - (centerX_M * mToDegLon);
            
            const gridHeightM = rowsCount * config.scale;
            const centerY_M = (rowOffsetStart * config.scale) + (gridHeightM / 2);

            if (config.letteringDirection === 'ascending') {
                a1GeoForDrawLat = pivotGeoLat - (centerY_M * mToDegLat);
            } else {
                a1GeoForDrawLat = pivotGeoLat + (centerY_M * mToDegLat);
            }
        }

        drawCadoElementsOnCanvas(finalCtx, drawConfig, localLatLonToPixels, [a1GeoForDrawLon, a1GeoForDrawLat], addressValue);
        
        // 7. UPSCALING
        const TARGET_EXPORT_HEIGHT = 2160;
        let exportCanvas = finalCanvas;
        if (upscaleEnabled && finalCanvas.height < TARGET_EXPORT_HEIGHT) {
            const exportScale = TARGET_EXPORT_HEIGHT / finalCanvas.height;
            const exportWidth = Math.round(finalCanvas.width * exportScale);
            const scaledCanvas = document.createElement('canvas');
            scaledCanvas.width = exportWidth;
            scaledCanvas.height = TARGET_EXPORT_HEIGHT;
            const scaledCtx = scaledCanvas.getContext('2d');
            scaledCtx.fillStyle = 'white';
            scaledCtx.fillRect(0, 0, scaledCanvas.width, scaledCanvas.height);
            scaledCtx.imageSmoothingEnabled = true;
            scaledCtx.imageSmoothingQuality = 'high';
            scaledCtx.drawImage(finalCanvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
            exportCanvas = scaledCanvas;
        }
        
        // 8. EXPORT
        const quality = parseInt(document.getElementById('cado-jpeg-quality').value) / 100;
        const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        const fileExtension = format === 'jpeg' ? '.jpg' : (format === 'geotiff' ? '.tif' : '.png');

        updateDynamicGridName();
        const finalGridName = document.getElementById('grid-name').value;
        const originString = `_origine=${realA1Coords[1].toFixed(6)},${realA1Coords[0].toFixed(6)}`;
        const fileName = `${finalGridName}${originString}${fileExtension}`;

        if (format === 'geotiff') {
            // Géoréférencement EPSG:3857 (nord-haut, valable car déviation = 0).
            // Le coin haut-gauche du canvas final correspond au world-pixel Web
            // Mercator (zoomLevel) : pivot - (position du pivot)/scaleFactor.
            // exportCanvas peut être ré-étiré (upscale 4K) → on corrige par sX/sY.
            const canvasNwWorldPxX = pivotWorldGlobalPx.x - pivotFinalX / scaleFactor;
            const canvasNwWorldPxY = pivotWorldGlobalPx.y - pivotFinalY / scaleFactor;
            const anchor = geoAnchorFromWorldPixels(canvasNwWorldPxX, canvasNwWorldPxY, zoomLevel);
            const sX = exportCanvas.width / finalCanvas.width;
            const sY = exportCanvas.height / finalCanvas.height;
            const blob = canvasToGeoTIFF(exportCanvas, {
                originX: anchor.originX,
                originY: anchor.originY,
                pixelScaleX: anchor.metersPerPixel / (scaleFactor * sX),
                pixelScaleY: anchor.metersPerPixel / (scaleFactor * sY),
                epsg: 3857,
            });
            if (blob) { downloadFile(blob, fileName); }
            else { showError("Erreur lors de la création du fichier GeoTIFF."); }
        } else {
            exportCanvas.toBlob((blob) => {
                if (blob) { downloadFile(blob, fileName); }
                else { showError("Erreur lors de la création du fichier image."); }
            }, mimeType, quality);
        }

    } catch (error) {
        console.error("Erreur génération image:", error);
        showError(error.message);
    } finally {
        loadingIndicator.classList.add("hidden");
    }
}

function getRotatedBoundingBox(config, a1Coords) {
    const [a1Lon, a1Lat] = a1Coords;
    const startColNum = letterToNumber(config.startCol);
    const endColNum = letterToNumber(config.endCol);
    const startRowNum = config.startRow;
    const endRowNum = config.endRow;
    const p1 = calculateAndRotatePoint(startColNum, startRowNum, config, a1Lat, a1Lon);
    const p2 = calculateAndRotatePoint(endColNum + 1, startRowNum, config, a1Lat, a1Lon);
    const p3 = calculateAndRotatePoint(startColNum, endRowNum + 1, config, a1Lat, a1Lon);
    const p4 = calculateAndRotatePoint(endColNum + 1, endRowNum + 1, config, a1Lat, a1Lon);
    const lats = [p1[1], p2[1], p3[1], p4[1]];
    const lons = [p1[0], p2[0], p3[0], p4[0]];
    return { north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lons), west: Math.min(...lons) };
}

function getA1CornerCoordsForPrint(config) {
    const refLat = config.latitude;
    const refLon = config.longitude;
    
    if (config.referencePointChoice === 'origin') {
        return [refLon, refLat];
    } else {
        const startColNum = letterToNumber(config.startCol);
        const endColNum = letterToNumber(config.endCol);
        const startRowNum = config.startRow;
        const endRowNum = config.endRow;
        
        const cols = getCadoCount(startColNum, endColNum);
        const rows = getCadoCount(startRowNum, endRowNum);
        
        const xOffsetMeters = (cols * config.scale) / 2;
        const yOffsetMeters = (rows * config.scale) / 2;
        
        const a1Lon = refLon - metersToLonDegrees(xOffsetMeters, refLat);
        let a1Lat;
        
        if (config.letteringDirection === 'ascending') {
            a1Lat = refLat - metersToLatDegrees(yOffsetMeters);
        } else {
            a1Lat = refLat + metersToLatDegrees(yOffsetMeters);
        }
        return [a1Lon, a1Lat];
    }
}

function calculateOptimalZoom(boundingBox, mapConfig) {
    const lonDiff = Math.abs(boundingBox.east - boundingBox.west);
    const maxLayerZoom = mapConfig.maxZoom || 20;
    if (lonDiff === 0) return maxLayerZoom;
    const targetWidthInPixels = 4000; 
    const zoomApproximation = Math.log2(360 * targetWidthInPixels / (lonDiff * 256));
    return Math.min(Math.floor(zoomApproximation), maxLayerZoom);
}

async function createFinalCanvasWithLayers(boundingBox, zoom, mapConfig, onProgress, upscaleEnabled = true) {
    const actualZoom = (typeof tileSourceIsActive === 'function' && tileSourceIsActive())
        ? tileSourceGetBestZoom(zoom)
        : zoom;

    const nwPixel = itpLatLonToWorldPixels(boundingBox.north, boundingBox.west, actualZoom);
    const sePixel = itpLatLonToWorldPixels(boundingBox.south, boundingBox.east, actualZoom);
    
    const naturalWidth = Math.abs(sePixel.x - nwPixel.x);
    const naturalHeight = Math.abs(sePixel.y - nwPixel.y);

    const TARGET_HEIGHT = 2160;
    let scaleFactor = 1;

    if (upscaleEnabled && naturalHeight < TARGET_HEIGHT) {
        scaleFactor = TARGET_HEIGHT / naturalHeight;
        scaleFactor = Math.min(scaleFactor, 16);
    }

    const TILE_SIZE = 256;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = naturalWidth;
    tempCanvas.height = naturalHeight;
    const tempCtx = tempCanvas.getContext('2d');

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = Math.round(naturalWidth * scaleFactor);
    finalCanvas.height = Math.round(naturalHeight * scaleFactor);
    const ctx = finalCanvas.getContext('2d');
    
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const nwTile = { x: Math.floor(nwPixel.x / TILE_SIZE), y: Math.floor(nwPixel.y / TILE_SIZE) };
    const seTile = { x: Math.floor(sePixel.x / TILE_SIZE), y: Math.floor(sePixel.y / TILE_SIZE) };
    const tileCountXY = (seTile.x - nwTile.x + 1) * (seTile.y - nwTile.y + 1);

    if (typeof tileSourceIsActive === 'function' && tileSourceIsActive()) {
        // --- Mode MBTiles local ---
        const progressFactor = 100 / tileCountXY;
        let downloadedCount = 0;
        for (let x = nwTile.x; x <= seTile.x; x++) {
            for (let y = nwTile.y; y <= seTile.y; y++) {
                const blobUrl = await tileSourceReadTile(x, y, actualZoom);
                if (blobUrl) {
                    await new Promise(resolve => {
                        const img = new Image();
                        img.onload = () => {
                            const tileX = (x * TILE_SIZE) - nwPixel.x;
                            const tileY = (y * TILE_SIZE) - nwPixel.y;
                            tempCtx.drawImage(img, Math.round(tileX), Math.round(tileY));
                            URL.revokeObjectURL(blobUrl);
                            resolve();
                        };
                        img.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(); };
                        img.src = blobUrl;
                    });
                }
                downloadedCount++;
                if (onProgress) onProgress(downloadedCount * progressFactor);
            }
        }
    } else {
        // --- Mode en ligne ---
        const totalTilesToDownload = tileCountXY * mapConfig.layers.length;
        const progressFactor = 100 / totalTilesToDownload;
        const cacheBust = 't=' + Date.now();
        let downloadedCount = 0;

        for (const layer of mapConfig.layers) {
            const tileJobs = [];
            if (layer.type === 'yandex') {
                // Tuiles Yandex (EPSG:3395) : même algo que zoneDownloader
                const nwLL = _worldPixels3857ToLatLon(nwPixel, actualZoom);
                const seLL = _worldPixels3857ToLatLon(sePixel, actualZoom);
                const nwT3395 = _latLonToTile3395(nwLL.lat, nwLL.lon, actualZoom);
                const seT3395 = _latLonToTile3395(seLL.lat, seLL.lon, actualZoom);
                const n3395 = Math.pow(2, actualZoom);
                for (let tx = nwT3395.x; tx <= seT3395.x; tx++) {
                    for (let ty = nwT3395.y; ty <= seT3395.y; ty++) {
                        const tileUrl = layer.url.replace('{z}', actualZoom).replace('{x}', tx).replace('{y}', ty);
                        const safeUrl = tileUrl + (tileUrl.includes('?') ? '&' : '?') + cacheBust;
                        tileJobs.push({ safeUrl, tx, ty });
                    }
                }
                (await mapWithConcurrency(tileJobs, 8, job => new Promise((resolve) => {
                    const img = new Image();
                    img.crossOrigin = "Anonymous";
                    img.onload = () => { downloadedCount++; if (onProgress) onProgress(downloadedCount * progressFactor); resolve({ img, tx: job.tx, ty: job.ty, success: true }); };
                    img.onerror = () => { downloadedCount++; if (onProgress) onProgress(downloadedCount * progressFactor); resolve({ success: false }); };
                    img.src = job.safeUrl;
                }))).forEach(tileResult => {
                    if (tileResult.success) {
                        const northLat = _tile3395NorthLatDeg(tileResult.ty, actualZoom);
                        const southLat = _tile3395NorthLatDeg(tileResult.ty + 1, actualZoom);
                        const westLon  = tileResult.tx / n3395 * 360 - 180;
                        const northPx  = itpLatLonToWorldPixels(northLat, westLon, actualZoom);
                        const southPx  = itpLatLonToWorldPixels(southLat, westLon, actualZoom);
                        const destX = Math.floor(northPx.x - nwPixel.x);
                        const destY = Math.floor(northPx.y - nwPixel.y);
                        const destH = Math.ceil(southPx.y - northPx.y) + 1;
                        tempCtx.drawImage(tileResult.img, destX, destY, TILE_SIZE + 1, destH);
                    }
                });
            } else {
                for (let x = nwTile.x; x <= seTile.x; x++) {
                    for (let y = nwTile.y; y <= seTile.y; y++) {
                        let tileUrl;
                        if (layer.type === 'quadkey') {
                            const q = coordsToQuadKey(x, y, actualZoom);
                            const subdomain = (x + y) % 4;
                            tileUrl = layer.url.replace('{q}', q).replace('{s}', subdomain);
                        } else {
                            tileUrl = layer.url.replace('{z}', actualZoom).replace('{x}', x).replace('{y}', y);
                        }
                        const safeUrl = tileUrl + (tileUrl.includes('?') ? '&' : '?') + cacheBust;
                        tileJobs.push({ safeUrl, x, y });
                    }
                }
                (await mapWithConcurrency(tileJobs, 8, job => new Promise((resolve) => {
                    const img = new Image();
                    img.crossOrigin = "Anonymous";
                    img.onload = () => { downloadedCount++; if (onProgress) onProgress(downloadedCount * progressFactor); resolve({ img, x: job.x, y: job.y, success: true }); };
                    img.onerror = () => { downloadedCount++; if (onProgress) onProgress(downloadedCount * progressFactor); resolve({ success: false }); };
                    img.src = job.safeUrl;
                }))).forEach(tileResult => {
                    if (tileResult.success) {
                        const tileX = (tileResult.x * TILE_SIZE) - nwPixel.x;
                        const tileY = (tileResult.y * TILE_SIZE) - nwPixel.y;
                        tempCtx.drawImage(tileResult.img, Math.round(tileX), Math.round(tileY));
                    }
                });
            }
        }
    }

    ctx.drawImage(tempCanvas, 0, 0, finalCanvas.width, finalCanvas.height);
    return { finalCanvas, scaleFactor, actualZoom };
}
